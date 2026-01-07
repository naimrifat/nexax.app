import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
  maxDuration: 60,
};

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
  if (!secret) return; // If you don't set it, it won't block. Recommended to set.
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
  // eBay often requires scope again on refresh:
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

  // Expect: access_token, expires_in, token_type, maybe refresh_token
  return json as {
    access_token: string;
    expires_in: number;
    token_type: string;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };
}

/**
 * Find a connection row. We try:
 * 1) user_id = provided job user_id (if present)
 * 2) if not found and you have internal users table, try mapping:
 *    - users.id <-> users.auth_user_id
 *
 * This avoids guessing whether your user_id is auth uid or internal id.
 */
async function findMarketplaceConnection(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  workspaceId: string;
  userId: string;
  env: string;
}) {
  const { supabaseAdmin, workspaceId, userId, env } = params;

  // First try with the userId as-is (works if job.user_id matches marketplace_connections.user_id)
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

  // Fallback mapping via users table (auth_user_id <-> id)
  // Try: userId is auth uid -> map to internal id
  const m1 = await supabaseAdmin.from("users").select("id").eq("auth_user_id", userId).maybeSingle();
  if (!m1.error && m1.data?.id) {
    q = await supabaseAdmin
      .from("marketplace_connections")
      .select("id,workspace_id,user_id,marketplace,environment,access_token,refresh_token,expires_at,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", m1.data.id)
      .eq("marketplace", "ebay")
      .eq("environment", env)
      .maybeSingle();
    if (q.error) throw q.error;
    if (q.data) return q.data as MarketplaceConnectionRow;
  }

  // Try: userId is internal id -> map to auth uid
  const m2 = await supabaseAdmin.from("users").select("auth_user_id").eq("id", userId).maybeSingle();
  if (!m2.error && m2.data?.auth_user_id) {
    q = await supabaseAdmin
      .from("marketplace_connections")
      .select("id,workspace_id,user_id,marketplace,environment,access_token,refresh_token,expires_at,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", m2.data.auth_user_id)
      .eq("marketplace", "ebay")
      .eq("environment", env)
      .maybeSingle();
    if (q.error) throw q.error;
    if (q.data) return q.data as MarketplaceConnectionRow;
  }

  return null;
}

/**
 * Returns a valid eBay access token; refreshes it if expired/near expiry,
 * and persists the new token + expires_at into marketplace_connections.
 */
async function getValidEbayAccessTokenOrThrow(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
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

  if (!conn) {
    throw new Error("No eBay account connected for this user/workspace.");
  }
  if (!conn.refresh_token) {
    throw new Error("eBay connection is missing refresh_token. Reconnect eBay.");
  }

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

  // If eBay rotates refresh_token and returns one, store it.
  if (refreshed.refresh_token) patch.refresh_token = refreshed.refresh_token;

  const up = await params.supabaseAdmin.from("marketplace_connections").update(patch).eq("id", conn.id);
  if (up.error) throw up.error;

  return { accessToken: refreshed.access_token, refreshed: true, connectionId: conn.id };
}

/**
 * Resolve the job user id.
 * If job.user_id is null, we fall back to listings.created_by (if exists).
 */
async function resolveJobUserId(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  job: JobRow;
}) {
  if (params.job.user_id) return params.job.user_id;

  // Try to infer from listing row if your listings table has created_by
  const { data, error } = await params.supabaseAdmin
    .from("listings")
    .select("created_by")
    .eq("id", params.job.listing_id)
    .maybeSingle();

  if (error) throw error;

  const createdBy = (data as any)?.created_by;
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const EBAY_ENV = ((process.env.EBAY_ENV || "production").toLowerCase() === "sandbox" ? "sandbox" : "production") as
      | "production"
      | "sandbox";

    // Batch size controls how many jobs are processed per call
    const limitRaw = (req.query.limit || (req.body as any)?.limit || "10").toString();
    const limit = Math.max(1, Math.min(50, Number(limitRaw) || 10));

    // 1) Fetch candidate queued jobs (FIFO)
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
    }> = [];

    let processed = 0;

    // 2) Process sequentially
    for (const job of jobs) {
      const startedAt = new Date().toISOString();

      // a) Claim job
      const { data: claimed, error: claimErr } = await supabase
        .from("listing_jobs")
        .update({
          status: "running",
          started_at: startedAt,
          attempts: (job.attempts ?? 0) + 1,
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
        // b) Ensure we can access eBay for this job (connect once forever = refresh automatically)
        const jobUserId = await resolveJobUserId({ supabaseAdmin: supabase, job });

        const { accessToken, refreshed } = await getValidEbayAccessTokenOrThrow({
          supabaseAdmin: supabase,
          workspaceId: job.workspace_id,
          userId: jobUserId,
          env: EBAY_ENV,
        });

        // NOTE: We don't use accessToken yet (stub publish), but this proves the refresh flow works.
        // DO NOT log accessToken.

        // c) Stub publish (replace later with real eBay calls using accessToken)
        const stubItemId = `STUB-${job.listing_id}`;
        const stubUrl = `https://www.ebay.com/itm/${stubItemId}`;

        // Update listing -> published
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

        // Mark job succeeded
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
        });
        processed++;
      } catch (e: any) {
        const errMsg = e?.message || "Unknown error";
        const finishedFailAt = new Date().toISOString();

        // Mark job failed
        await supabase
          .from("listing_jobs")
          .update({
            status: "failed",
            finished_at: finishedFailAt,
            error_message: errMsg,
            error_json: { stage: "publish", message: errMsg },
          })
          .eq("id", job.id);

        // Keep listing in draft and record error (per your requirement)
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
