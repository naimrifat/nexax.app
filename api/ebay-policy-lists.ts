import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { getValidEbayToken } from "../lib/ebay/ebay-token-manager.js";
import { sentryCaptureException } from "../lib/sentry.js";



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

/**
 * Keep this broad and defensive. eBay wording can vary.
 */
function isEbayBusinessPolicyIneligible(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  const e0 = err?.details?.errors?.[0];
  const longMsg = String(e0?.longMessage || "").toLowerCase();
  const shortMsg = String(e0?.message || "").toLowerCase();
  const errorId = Number(e0?.errorId ?? NaN);

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
  const fulfillmentPolicies = Array.isArray(fulfillment?.fulfillmentPolicies)
    ? fulfillment.fulfillmentPolicies
    : [];
  const returnPolicies = Array.isArray(returns?.returnPolicies) ? returns.returnPolicies : [];

  return {
    paymentPolicies: paymentPolicies
      .map((p: any) => ({
        id: String(p?.paymentPolicyId || ""),
        name: String(p?.name || ""),
      }))
      .filter((x: any) => x.id),
    fulfillmentPolicies: fulfillmentPolicies
      .map((p: any) => ({
        id: String(p?.fulfillmentPolicyId || ""),
        name: String(p?.name || ""),
      }))
      .filter((x: any) => x.id),
    returnPolicies: returnPolicies
      .map((p: any) => ({
        id: String(p?.returnPolicyId || ""),
        name: String(p?.name || ""),
      }))
      .filter((x: any) => x.id),
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

    const userClient: any = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
      auth: { persistSession: false },
    });

    const admin: SupabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Auth user
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      sentryCaptureException(new Error('Unauthorized'), {
        operation: 'ebay_policy_lists',
        requestId,
        extras: { code: 'UNAUTHORIZED', status: 401, message: 'Unauthorized' },
      });
      return res.status(401).json({ error: "Unauthorized", requestId });
    }


    // Inputs
    const workspaceId = String(req.query.workspace_id || "").trim();
    if (!workspaceId) {
      sentryCaptureException(new Error('Missing workspace_id'), {
        operation: 'ebay_policy_lists',
        requestId,
        extras: { code: 'VALIDATION_ERROR', status: 400, message: 'Missing workspace_id' },
      });
      return res.status(400).json({ error: "Missing workspace_id", requestId });
    }


    const env = normalizeEnv(req.query.env);
    const marketplaceId = normalizeMarketplaceId(req.query.marketplace_id);

    // Verify workspace ownership (your schema)
    const u = await admin
      .from("users")
      .select("workspace_id")
      .eq("auth_provider_user_id", user.id)
      .maybeSingle();

    if (u.error) {
      return res.status(500).json({
        error: "Failed to resolve user workspace",
        requestId,
        details: u.error.message,
      });
    }

    const uRow = (u.data as any) || null;
    if (!uRow || uRow.workspace_id !== workspaceId) {
      sentryCaptureException(new Error('Forbidden'), {
        operation: 'ebay_policy_lists',
        requestId,
        workspace_id: workspaceId,
        extras: { code: 'FORBIDDEN', status: 403, message: 'Forbidden' },
      });
      return res.status(403).json({ error: "Forbidden", requestId });
    }


    // Get eBay access token (centralized)
    const accessToken = await getValidEbayToken(workspaceId, env);

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
        token_refreshed: null, // token manager doesn't expose metadata
        source: "ebay",
        ...lists,
      });
    } catch (e: any) {
      if (isEbayBusinessPolicyIneligible(e)) {
        sentryCaptureException(e, {
          operation: 'ebay_policy_lists',
          requestId,
          workspace_id: workspaceId,
          extras: { code: 'INELIGIBLE', status: 200, message: String(e?.message || '') },
        });
        return res.status(200).json({

          success: true,
          requestId,
          workspace_id: workspaceId,
          environment: env,
          marketplace_id: marketplaceId,
          token_refreshed: null,
          source: "ineligible",
          paymentPolicies: [],
          returnPolicies: [],
          fulfillmentPolicies: [],
          message:
            "This eBay account is not eligible for Business Policies API, so policy lists cannot be fetched. Use workspace overrides or manual IDs.",
        });
      }

      const status = e?.statusCode || 500;
      sentryCaptureException(e, {
        operation: 'ebay_policy_lists',
        requestId,
        workspace_id: workspaceId,
        extras: { status, code: String(e?.code || ''), message: String(e?.message || '') },
      });
      return res.status(status).json({
        error: e?.message || "Failed to fetch eBay policy lists",
        requestId,
        details: e?.details || null,
      });

    }
  } catch (err: any) {
    const statusCode = Number(err?.statusCode || 500);
    sentryCaptureException(err, {
      operation: 'ebay_policy_lists',
      requestId,
      extras: { status: statusCode, code: String(err?.code || ''), message: String(err?.message || '') },
    });

    return res.status(statusCode).json({
      error: err?.message || "Internal server error",
      requestId,
      code: err?.code || null,
      details: err?.details || null,
    });
  }

}
