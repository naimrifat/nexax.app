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

function normalizeEnv(v: any): "production" | "sandbox" {
  const s = String(v || "production").trim().toLowerCase();
  return s === "sandbox" ? "sandbox" : "production";
}

function normalizeMarketplaceId(v: any): string {
  return String(v || "EBAY_US").trim().toUpperCase();
}

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
    (err as any).details = json;
    throw err;
  }

  return json;
}

function isEbayBusinessPolicyIneligible(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("not eligible for business policy");
}

/**
 * --- Token refresh helpers (copied from your process-jobs.ts pattern) ---
 */

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

type MarketplaceConnectionRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  marketplace: string;
  environment: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
};

async function getValidEbayAccessTokenOrThrow(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  workspaceId: string;
  authUserId: string; // Supabase auth user id
  env: "production" | "sandbox";
}) {
  const scopes = getEnv("EBAY_OAUTH_SCOPES");

  // Your schema: marketplace_connections.user_id is the auth user id (based on your screenshots)
  const { data: conn, error } = await params.supabaseAdmin
    .from("marketplace_connections")
    .select("id,workspace_id,user_id,marketplace,environment,access_token,refresh_token,expires_at")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.authUserId)
    .eq("marketplace", "ebay")
    .eq("environment", params.env)
    .maybeSingle();

  if (error) throw error;
  if (!conn) throw new Error("No eBay account connected for this user/workspace.");
  const c = conn as MarketplaceConnectionRow;

  if (!c.refresh_token) throw new Error("eBay connection is missing refresh_token. Reconnect eBay.");

  const expiresAtMs = parseExpiresAtMs(c.expires_at);
  const needsRefresh = isExpiredOrNear(expiresAtMs, 120);

  if (!needsRefresh && c.access_token) {
    return { accessToken: c.access_token, refreshed: false };
  }

  const refreshed = await refreshEbayAccessTokenOrThrow({
    env: params.env,
    refreshToken: c.refresh_token,
    scopes,
  });

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  const patch: any = {
    access_token: refreshed.access_token,
    expires_at: newExpiresAt,
  };
  if (refreshed.refresh_token) patch.refresh_token = refreshed.refresh_token;

  const up = await params.supabaseAdmin.from("marketplace_connections").update(patch).eq("id", c.id);
  if (up.error) throw up.error;

  return { accessToken: refreshed.access_token, refreshed: true };
}

/**
 * Fetch policy lists from eBay Account API.
 */
async function fetchEbayBusinessPolicyLists(params: {
  accessToken: string;
  env: "production" | "sandbox";
  marketplaceId: string;
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

  const paymentPolicies = Array.isArray(payment?.paymentPolicies) ? payment.paymentPolicies : [];
  const fulfillmentPolicies = Array.isArray(fulfillment?.fulfillmentPolicies) ? fulfillment.fulfillmentPolicies : [];
  const returnPolicies = Array.isArray(returns?.returnPolicies) ? returns.returnPolicies : [];

  // Normalize to {id,name}
  return {
    paymentPolicies: paymentPolicies.map((p: any) => ({
      id: String(p?.paymentPolicyId || ""),
      name: String(p?.name || ""),
    })).filter((x: any) => x.id),
    fulfillmentPolicies: fulfillmentPolicies.map((p: any) => ({
      id: String(p?.fulfillmentPolicyId || ""),
      name: String(p?.name || ""),
    })).filter((x: any) => x.id),
    returnPolicies: returnPolicies.map((p: any) => ({
      id: String(p?.returnPolicyId || ""),
      name: String(p?.name || ""),
    })).filter((x: any) => x.id),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed", requestId });
  }

  try {
    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const authHeader = req.headers.authorization || "";

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
      auth: { persistSession: false },
    });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Auth user
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return res.status(401).json({ error: "Unauthorized", requestId });
    }

    // Inputs
    const workspaceId = String(req.query.workspace_id || "").trim();
    if (!workspaceId) return res.status(400).json({ error: "Missing workspace_id", requestId });

    const env = normalizeEnv(req.query.env);
    const marketplaceId = normalizeMarketplaceId(req.query.marketplace_id);

    // Verify workspace ownership (your schema)
    const u = await admin
      .from("users")
      .select("workspace_id")
      .eq("auth_provider_user_id", user.id)
      .maybeSingle();

    if (u.error) {
      return res.status(500).json({ error: "Failed to resolve user workspace", requestId, details: u.error.message });
    }
    if (!u.data || u.data.workspace_id !== workspaceId) {
      return res.status(403).json({ error: "Forbidden", requestId });
    }

    // Get eBay access token (refresh if needed)
    const { accessToken, refreshed } = await getValidEbayAccessTokenOrThrow({
      supabaseAdmin: admin,
      workspaceId,
      authUserId: user.id,
      env,
    });

    // Fetch lists from eBay
    try {
      const lists = await fetchEbayBusinessPolicyLists({
        accessToken,
        env,
        marketplaceId,
      });

      return res.status(200).json({
        success: true,
        requestId,
        workspace_id: workspaceId,
        environment: env,
        marketplace_id: marketplaceId,
        token_refreshed: refreshed,
        source: "ebay",
        ...lists,
      });
    } catch (e: any) {
      // If ineligible, don't hard fail — return a usable response for UI
      if (isEbayBusinessPolicyIneligible(e)) {
        return res.status(200).json({
          success: true,
          requestId,
          workspace_id: workspaceId,
          environment: env,
          marketplace_id: marketplaceId,
          token_refreshed: refreshed,
          source: "ineligible",
          paymentPolicies: [],
          returnPolicies: [],
          fulfillmentPolicies: [],
          message:
            "This eBay account is not eligible for Business Policies API, so policy lists cannot be fetched. Use workspace overrides or manual IDs.",
        });
      }

      const status = e?.statusCode || 500;
      return res.status(status).json({
        error: e?.message || "Failed to fetch eBay policy lists",
        requestId,
        details: e?.details || null,
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Internal server error", requestId });
  }
}
