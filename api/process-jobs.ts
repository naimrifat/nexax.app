import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
  maxDuration: 60,
};

type SupabaseAdmin = any;

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Simple endpoint auth:
 * - Set CRON_SECRET in env
 * - Call with header: x-cron-secret: <CRON_SECRET>
 */
function requireCronSecret(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const got = (req.headers["x-cron-secret"] || "").toString();
  if (got !== secret) {
    const err = new Error("Unauthorized");
    (err as any).statusCode = 401;
    throw err;
  }
}

type JobRow = {
  id: string;
  listing_id: string;
  workspace_id: string;
  user_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  max_attempts: number;
  job_type: "publish";
};

type MarketplaceConnectionRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  marketplace: string;
  environment: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null; // timestamptz
  updated_at?: string | null;
};

function parseExpiresAtMs(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) ? t : null;
}

function isExpiredOrNear(expiresAtMs: number | null, skewSeconds = 120): boolean {
  if (!expiresAtMs) return true;
  return expiresAtMs <= Date.now() + skewSeconds * 1000;
}

function base64BasicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

/* -----------------------------
   eBay Account API (policies)
------------------------------ */

function ebayApiHost(env: "production" | "sandbox") {
  return env === "sandbox" ? "api.sandbox.ebay.com" : "api.ebay.com";
}

async function ebayGetJsonOrThrow(url: string, accessToken: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const json = (await res.json().catch(() => ({}))) as any;

  if (!res.ok) {
    const e0 = json?.errors?.[0];

    const msg =
      e0?.longMessage ||
      e0?.message ||
      json?.error_description ||
      json?.error ||
      `eBay API failed: ${res.status}`;

    const err = new Error(msg);
    (err as any).statusCode = res.status;
    (err as any).details = json; // keep full payload
    throw err;
  }

  return json;
}

function pickPolicyIdByHeuristic<T extends { name?: string }>(
  policies: T[],
  idKey: keyof T,
  preferredNameContains: string[] = ["default", "standard"]
): string | null {
  if (!Array.isArray(policies) || policies.length === 0) return null;

  const lowered = policies.map((p) => ({
    p,
    n: String((p as any)?.name || "").toLowerCase(),
  }));

  for (const needle of preferredNameContains) {
    const found = lowered.find((x) => x.n.includes(needle));
    if (found && found.p && (found.p as any)[idKey]) return String((found.p as any)[idKey]);
  }

  const first = policies[0] as any;
  return first?.[idKey] ? String(first[idKey]) : null;
}

/**
 * eBay will return varying wording for accounts that can't use Business Policies API.
 * We match on message strings AND (when present) the eBay error payload (errorId).
 */
function isEbayBusinessPolicyIneligible(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  const e0 = err?.details?.errors?.[0];

  const longMsg = String(e0?.longMessage || "").toLowerCase();
  const shortMsg = String(e0?.message || "").toLowerCase();
  const errorId = Number(e0?.errorId ?? NaN);

  // Common eligibility/opt-in error id seen in Sell Account API responses
  if (errorId === 20403) return true;

  const hay = [msg, longMsg, shortMsg].join(" | ");

  return (
    hay.includes("not eligible for business policy") ||
    hay.includes("not eligible for business policy api") ||
    hay.includes("not opted in") ||
    hay.includes("not opted into business policies") ||
    hay.includes("not opted in to business policies") ||
    hay.includes("business policies are not enabled")
  );
}

async function fetchEbayBusinessPolicies(params: {
  accessToken: string;
  env: "production" | "sandbox";
  marketplaceId: string; // e.g. EBAY_US
}) {
  const host = ebayApiHost(params.env);
  const mid = encodeURIComponent(params.marketplaceId);

  const payment = await ebayGetJsonOrThrow(
    `https://${host}/sell/account/v1/payment_policy?marketplace_id=${mid}`,
    params.accessToken
  );

  const fulfillment = await ebayGetJsonOrThrow(
    `https://${host}/sell/account/v1/fulfillment_policy?marketplace_id=${mid}`,
    params.accessToken
  );

  const returns = await ebayGetJsonOrThrow(
    `https://${host}/sell/account/v1/return_policy?marketplace_id=${mid}`,
    params.accessToken
  );

  return { payment, fulfillment, returns };
}

async function getEbayPolicyOverridesOrNull(params: {
  supabaseAdmin: SupabaseAdmin;
  workspaceId: string;
  env: "production" | "sandbox";
  marketplaceId: string;
}) {
  const envNorm = (params.env || "production").trim().toLowerCase() as "production" | "sandbox";
  const marketplaceIdNorm = (params.marketplaceId || "").trim().toUpperCase();

  const { data, error } = await params.supabaseAdmin
    .from("marketplace_policy_overrides")
    .select("payment_policy_id,fulfillment_policy_id,return_policy_id")
    .eq("workspace_id", params.workspaceId)
    .eq("marketplace", "ebay")
    .eq("environment", envNorm)
    .eq("marketplace_id", marketplaceIdNorm)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as any;

  // If any are missing, treat as not configured
  if (!row.payment_policy_id || !row.fulfillment_policy_id || !row.return_policy_id) return null;

  return {
    paymentPolicyId: String(row.payment_policy_id),
    fulfillmentPolicyId: String(row.fulfillment_policy_id),
    returnPolicyId: String(row.return_policy_id),
  };
}

/**
 * Returns policy IDs using:
 * 1) cache (workspace-level first; legacy user-level fallback)
 * 2) eBay Account API (if eligible)
 * 3) overrides table (workspace-level) if Account API says "not eligible"
 */
async function getOrFetchEbayPolicyIdsOrThrow(params: {
  supabaseAdmin: SupabaseAdmin;
  workspaceId: string;
  userId: string; // kept only for legacy cache fallback
  env: "production" | "sandbox";
  marketplaceId: string;
  accessToken: string;
}) {
  const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const envNorm = (params.env || "production").trim().toLowerCase() as "production" | "sandbox";
  const marketplaceIdNorm = (params.marketplaceId || "").trim().toUpperCase();

  // -----------------------------
  // 1) CACHE: workspace-level first
  // -----------------------------
  const cachedWorkspace = await params.supabaseAdmin
    .from("marketplace_policy_cache")
    .select("payment_policy_id,fulfillment_policy_id,return_policy_id,fetched_at")
    .eq("workspace_id", params.workspaceId)
    .is("user_id", null)
    .eq("marketplace", "ebay")
    .eq("environment", envNorm)
    .eq("marketplace_id", marketplaceIdNorm)
    .maybeSingle();

  if (cachedWorkspace.error) throw cachedWorkspace.error;

  const wsRow = (cachedWorkspace.data as any) || null;
  const wsFetchedAtMs = wsRow?.fetched_at ? Date.parse(wsRow.fetched_at) : 0;
  const wsFresh = wsFetchedAtMs && wsFetchedAtMs > Date.now() - TTL_MS;

  if (wsFresh && wsRow?.payment_policy_id && wsRow?.fulfillment_policy_id && wsRow?.return_policy_id) {
    return {
      paymentPolicyId: String(wsRow.payment_policy_id),
      fulfillmentPolicyId: String(wsRow.fulfillment_policy_id),
      returnPolicyId: String(wsRow.return_policy_id),
      source: "cache" as const,
    };
  }

  // -----------------------------
  // 1b) CACHE: legacy user-level fallback
  // -----------------------------
  const cachedUser = await params.supabaseAdmin
    .from("marketplace_policy_cache")
    .select("payment_policy_id,fulfillment_policy_id,return_policy_id,fetched_at")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.userId)
    .eq("marketplace", "ebay")
    .eq("environment", envNorm)
    .eq("marketplace_id", marketplaceIdNorm)
    .maybeSingle();

  if (cachedUser.error) throw cachedUser.error;

  const uRow = (cachedUser.data as any) || null;
  const uFetchedAtMs = uRow?.fetched_at ? Date.parse(uRow.fetched_at) : 0;
  const uFresh = uFetchedAtMs && uFetchedAtMs > Date.now() - TTL_MS;

  if (uFresh && uRow?.payment_policy_id && uRow?.fulfillment_policy_id && uRow?.return_policy_id) {
    return {
      paymentPolicyId: String(uRow.payment_policy_id),
      fulfillmentPolicyId: String(uRow.fulfillment_policy_id),
      returnPolicyId: String(uRow.return_policy_id),
      source: "cache" as const,
    };
  }

  // -----------------------------
  // 2) Try eBay Account API
  // -----------------------------
  let raw: any;
  try {
    raw = await fetchEbayBusinessPolicies({
      accessToken: params.accessToken,
      env: envNorm,
      marketplaceId: marketplaceIdNorm,
    });
  } catch (e: any) {
    // -----------------------------
    // 3) If ineligible, use WORKSPACE-LEVEL OVERRIDES
    // -----------------------------
    if (isEbayBusinessPolicyIneligible(e)) {
      const overrides = await getEbayPolicyOverridesOrNull({
        supabaseAdmin: params.supabaseAdmin,
        workspaceId: params.workspaceId,
        env: envNorm,
        marketplaceId: marketplaceIdNorm,
      });

      if (!overrides) {
        const err = new Error(
          "eBay account is not eligible for Business Policy API (or Business Policies are not enabled). Add workspace-level policy overrides (payment/fulfillment/return policy IDs)."
        );
        (err as any).details = {
          stage: "policies",
          reason: "business_policy_ineligible",
          workspaceId: params.workspaceId,
          env: envNorm,
          marketplaceId: marketplaceIdNorm,
          ebayError: e?.details || null,
        };
        throw err;
      }

      return {
        ...overrides,
        source: "override" as const,
      };
    }

    // Any other error -> bubble up
    throw e;
  }

  // -----------------------------
  // Parse Account API response
  // -----------------------------
  const paymentPolicies = raw.payment?.paymentPolicies || [];
  const fulfillmentPolicies = raw.fulfillment?.fulfillmentPolicies || [];
  const returnPolicies = raw.returns?.returnPolicies || [];

  const paymentPolicyId = pickPolicyIdByHeuristic(paymentPolicies, "paymentPolicyId" as any);
  const fulfillmentPolicyId = pickPolicyIdByHeuristic(fulfillmentPolicies, "fulfillmentPolicyId" as any);
  const returnPolicyId = pickPolicyIdByHeuristic(returnPolicies, "returnPolicyId" as any);

  if (!paymentPolicyId || !fulfillmentPolicyId || !returnPolicyId) {
    const err = new Error(
      "Could not resolve eBay business policies. Ensure the seller account has payment/fulfillment/return policies configured for this marketplace."
    );
    (err as any).details = {
      stage: "policies",
      reason: "policies_missing_or_unresolvable",
      env: envNorm,
      marketplaceId: marketplaceIdNorm,
      got: {
        paymentPolicies: paymentPolicies.length,
        fulfillmentPolicies: fulfillmentPolicies.length,
        returnPolicies: returnPolicies.length,
      },
    };
    throw err;
  }

  return {
    paymentPolicyId,
    fulfillmentPolicyId,
    returnPolicyId,
    source: "ebay" as const,
  };
}

/* -----------------------------
   eBay OAuth refresh
------------------------------ */

function ebayTokenHost(env: string) {
  return env === "sandbox" ? "api.sandbox.ebay.com" : "api.ebay.com";
}

async function refreshEbayAccessTokenOrThrow(params: {
  env: "production" | "sandbox";
  refreshToken: string;
  scopes: string; // space-separated
}) {
  const clientId = getEnv("EBAY_CLIENT_ID");
  const clientSecret = getEnv("EBAY_CLIENT_SECRET");

  const url = `https://${ebayTokenHost(params.env)}/identity/v1/oauth2/token`;

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", params.refreshToken);
  body.set("scope", params.scopes);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${base64BasicAuth(clientId, clientSecret)}`,
    },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as any;

  if (!res.ok) {
    const msg = json?.error_description || json?.error || "Failed to refresh eBay token";
    const err = new Error(msg);
    (err as any).details = json;
    throw err;
  }

  return json as {
    access_token: string;
    expires_in: number;
    token_type: string;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };
}

async function findMarketplaceConnection(params: {
  supabaseAdmin: SupabaseAdmin;
  workspaceId: string;
  userId: string;
  env: string;
}) {
  const { supabaseAdmin, workspaceId, userId, env } = params;

  let q = await supabaseAdmin
    .from("marketplace_connections")
    .select("id,workspace_id,user_id,marketplace,environment,access_token,refresh_token,expires_at,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("marketplace", "ebay")
    .eq("environment", env)
    .maybeSingle();

  if (q.error) throw q.error;
  if (q.data) return q.data as MarketplaceConnectionRow;

  // Legacy lookups (users table can map auth ids)
  const m1 = await supabaseAdmin.from("users").select("id").eq("auth_user_id", userId).maybeSingle();
  const m1row = (m1 as any).data;
  if (!m1.error && m1row?.id) {
    q = await supabaseAdmin
      .from("marketplace_connections")
      .select("id,workspace_id,user_id,marketplace,environment,access_token,refresh_token,expires_at,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", m1row.id)
      .eq("marketplace", "ebay")
      .eq("environment", env)
      .maybeSingle();
    if (q.error) throw q.error;
    if (q.data) return q.data as MarketplaceConnectionRow;
  }

  const m2 = await supabaseAdmin.from("users").select("auth_user_id").eq("id", userId).maybeSingle();
  const m2row = (m2 as any).data;
  if (!m2.error && m2row?.auth_user_id) {
    q = await supabaseAdmin
      .from("marketplace_connections")
      .select("id,workspace_id,user_id,marketplace,environment,access_token,refresh_token,expires_at,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", m2row.auth_user_id)
      .eq("marketplace", "ebay")
      .eq("environment", env)
      .maybeSingle();
    if (q.error) throw q.error;
    if (q.data) return q.data as MarketplaceConnectionRow;
  }

  return null;
}

async function getValidEbayAccessTokenOrThrow(params: {
  supabaseAdmin: SupabaseAdmin;
  workspaceId: string;
  userId: string;
  env: "production" | "sandbox";
}) {
  const scopes = getEnv("EBAY_OAUTH_SCOPES");

  const conn = await findMarketplaceConnection({
    supabaseAdmin: params.supabaseAdmin,
    workspaceId: params.workspaceId,
    userId: params.userId,
    env: params.env,
  });

  if (!conn) throw new Error("No eBay account connected for this user/workspace.");
  if (!conn.refresh_token) throw new Error("eBay connection is missing refresh_token. Reconnect eBay.");

  const expiresAtMs = parseExpiresAtMs(conn.expires_at);
  const needsRefresh = isExpiredOrNear(expiresAtMs, 120);

  if (!needsRefresh && conn.access_token) {
    return { accessToken: conn.access_token, refreshed: false, connectionId: conn.id };
  }

  const refreshed = await refreshEbayAccessTokenOrThrow({
    env: params.env,
    refreshToken: conn.refresh_token,
    scopes,
  });

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  const patch: any = {
    access_token: refreshed.access_token,
    expires_at: newExpiresAt,
  };
  if (refreshed.refresh_token) patch.refresh_token = refreshed.refresh_token;

  const up = await params.supabaseAdmin.from("marketplace_connections").update(patch).eq("id", conn.id);
  if (up.error) throw up.error;

  return { accessToken: refreshed.access_token, refreshed: true, connectionId: conn.id };
}

async function resolveJobUserId(params: { supabaseAdmin: SupabaseAdmin; job: JobRow }) {
  if (params.job.user_id) return params.job.user_id;

  const { data, error } = await params.supabaseAdmin
    .from("listings")
    .select("created_by")
    .eq("id", params.job.listing_id)
    .maybeSingle();

  if (error) throw error;

  const row = (data as any) || null;
  const createdBy = row?.created_by;
  if (createdBy) return String(createdBy);

  throw new Error("Job is missing user_id and listing.created_by could not be resolved.");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", requestId });
  }

  try {
    requireCronSecret(req);

    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase: SupabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const EBAY_ENV = ((process.env.EBAY_ENV || "production").trim().toLowerCase() === "sandbox"
      ? "sandbox"
      : "production") as "production" | "sandbox";

    const EBAY_MARKETPLACE_ID = (process.env.EBAY_MARKETPLACE_ID || "EBAY_US").trim().toUpperCase();

    const limitRaw = (req.query.limit || (req.body as any)?.limit || "10").toString();
    const limit = Math.max(1, Math.min(50, Number(limitRaw) || 10));

    const { data: candidates, error: fetchErr } = await supabase
      .from("listing_jobs")
      .select("id, listing_id, workspace_id, user_id, status, attempts, max_attempts, job_type, created_at")
      .eq("job_type", "publish")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (fetchErr) {
      return res.status(500).json({ error: "Failed to fetch queued jobs", requestId, details: fetchErr.message });
    }

    const jobs: JobRow[] = (candidates || []) as any;

    const results: Array<{
      jobId: string;
      listingId: string;
      outcome: "succeeded" | "failed" | "skipped";
      message?: string;
      ebayTokenRefreshed?: boolean;
      ebayPolicySource?: "cache" | "ebay" | "override";
    }> = [];

    let processed = 0;

    for (const job of jobs) {
      const startedAt = new Date().toISOString();

      const attempts = Number((job as any).attempts ?? 0);
      const maxAttempts = Number((job as any).max_attempts ?? 0) || 3;

      if (attempts >= maxAttempts) {
        const msg = `max_attempts exceeded (${attempts}/${maxAttempts})`;
        await supabase
          .from("listing_jobs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_message: msg,
            error_json: { stage: "claim", message: msg },
          })
          .eq("id", job.id);

        results.push({ jobId: job.id, listingId: job.listing_id, outcome: "failed", message: msg });
        continue;
      }

      const { data: claimed, error: claimErr } = await supabase
        .from("listing_jobs")
        .update({
          status: "running",
          started_at: startedAt,
          attempts: attempts + 1,
        })
        .eq("id", job.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();

      if (claimErr) {
        results.push({ jobId: job.id, listingId: job.listing_id, outcome: "failed", message: "claim failed" });
        continue;
      }

      if (!claimed) {
        results.push({ jobId: job.id, listingId: job.listing_id, outcome: "skipped", message: "already claimed" });
        continue;
      }

      const finishedAt = new Date().toISOString();

      try {
        const jobUserId = await resolveJobUserId({ supabaseAdmin: supabase, job });

        const { accessToken, refreshed } = await getValidEbayAccessTokenOrThrow({
          supabaseAdmin: supabase,
          workspaceId: job.workspace_id,
          userId: jobUserId,
          env: EBAY_ENV,
        });

        const policies = await getOrFetchEbayPolicyIdsOrThrow({
          supabaseAdmin: supabase,
          workspaceId: job.workspace_id,
          userId: jobUserId,
          env: EBAY_ENV,
          marketplaceId: EBAY_MARKETPLACE_ID,
          accessToken,
        });

        // Stub publish for now
        const stubItemId = `STUB-${job.listing_id}`;
        const stubUrl = `https://www.ebay.com/itm/${stubItemId}`;

        const { error: listingUpdErr } = await supabase
          .from("listings")
          .update({
            status: "published",
            published_at: finishedAt,
            ebay_item_id: stubItemId,
            ebay_listing_url: stubUrl,
            last_publish_error: null,
            last_publish_error_details: null,
          })
          .eq("id", job.listing_id);

        if (listingUpdErr) {
          throw new Error(`listing update failed: ${listingUpdErr.message}`);
        }

        const { error: jobDoneErr } = await supabase
          .from("listing_jobs")
          .update({
            status: "succeeded",
            finished_at: finishedAt,
            result_json: {
              stub: true,
              ebay_item_id: stubItemId,
              ebay_listing_url: stubUrl,
              ebay_token_refreshed: refreshed,
              ebay_env: EBAY_ENV,
              ebay_marketplace_id: EBAY_MARKETPLACE_ID,
              ebay_policy_source: policies.source,
              ebay_policy_ids: {
                paymentPolicyId: policies.paymentPolicyId,
                fulfillmentPolicyId: policies.fulfillmentPolicyId,
                returnPolicyId: policies.returnPolicyId,
              },
            },
            error_message: null,
            error_json: null,
          })
          .eq("id", job.id);

        if (jobDoneErr) {
          console.error("[process-jobs] job success update failed", { requestId, jobId: job.id, jobDoneErr });
        }

        results.push({
          jobId: job.id,
          listingId: job.listing_id,
          outcome: "succeeded",
          ebayTokenRefreshed: refreshed,
          ebayPolicySource: policies.source,
        });
        processed++;
      } catch (e: any) {
        const errMsg = e?.message || "Unknown error";
        const finishedFailAt = new Date().toISOString();

        await supabase
          .from("listing_jobs")
          .update({
            status: "failed",
            finished_at: finishedFailAt,
            error_message: errMsg,
            error_json: {
              stage: "publish",
              message: errMsg,
              statusCode: e?.statusCode || null,
              details: e?.details || null,
            },
          })
          .eq("id", job.id);

        await supabase
          .from("listings")
          .update({
            status: "draft",
            last_publish_error: "Publish failed",
            last_publish_error_details: { stage: "publish", message: errMsg },
          })
          .eq("id", job.listing_id);

        results.push({ jobId: job.id, listingId: job.listing_id, outcome: "failed", message: errMsg });
      }
    }

    return res.status(200).json({
      success: true,
      requestId,
      fetched: jobs.length,
      processed,
      results,
    });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    return res.status(status).json({
      error: err?.message || "Internal server error",
      requestId,
    });
  }
}
