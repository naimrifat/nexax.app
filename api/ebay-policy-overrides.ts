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

function normalizePolicyId(v: any): string {
  return String(v || "").trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== "GET" && req.method !== "POST") {
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

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) Authenticate user
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return res.status(401).json({ error: "Unauthorized", requestId });
    }

    // 2) Determine workspace_id (securely)
    // Your app is multi-tenant; simplest safe approach:
    // - Require workspace_id in the request
    // - Verify the user is a member of that workspace
    //
    // If you already have a "workspaces_users" (or similar) membership table, enforce it here.
    //
    // For now, we will require workspace_id and check membership via a conservative lookup:
    // - Try "workspace_members" table
    // - If your table is named differently, we'll adjust after you confirm.
    const body: any = req.method === "POST" ? req.body || {} : {};
    const workspaceId = String((req.query.workspace_id as any) || body.workspace_id || "").trim();

    if (!workspaceId) {
      return res.status(400).json({ error: "Missing workspace_id", requestId });
    }

const u = await serviceClient
  .from("users")
  .select("workspace_id")
  .eq("auth_provider_user_id", user.id) // <-- correct mapping column
  .maybeSingle();

if (u.error) {
  return res.status(500).json({
    error: "Failed to resolve user workspace",
    requestId,
    details: u.error.message,
  });
}

if (!u.data || u.data.workspace_id !== workspaceId) {
  return res.status(403).json({ error: "Forbidden", requestId });
}

    // 3) Read current overrides
    const env = normalizeEnv((req.query.env as any) || body.env || "production");
    const marketplaceId = normalizeMarketplaceId((req.query.marketplace_id as any) || body.marketplace_id || "EBAY_US");

    if (req.method === "GET") {
      const q = await serviceClient
        .from("marketplace_policy_overrides")
        .select("payment_policy_id,fulfillment_policy_id,return_policy_id,updated_at")
        .eq("workspace_id", workspaceId)
        .eq("marketplace", "ebay")
        .eq("environment", env)
        .eq("marketplace_id", marketplaceId)
        .maybeSingle();

      if (q.error) {
        return res.status(500).json({ error: "Failed to fetch overrides", requestId, details: q.error.message });
      }

      return res.status(200).json({
        success: true,
        requestId,
        workspace_id: workspaceId,
        marketplace: "ebay",
        environment: env,
        marketplace_id: marketplaceId,
        overrides: q.data || null,
      });
    }

    // 4) Upsert overrides
    const paymentPolicyId = normalizePolicyId(body.payment_policy_id ?? body.paymentPolicyId);
    const fulfillmentPolicyId = normalizePolicyId(body.fulfillment_policy_id ?? body.fulfillmentPolicyId);
    const returnPolicyId = normalizePolicyId(body.return_policy_id ?? body.returnPolicyId);

    const errors: string[] = [];
    if (!paymentPolicyId) errors.push("payment_policy_id is required");
    if (!fulfillmentPolicyId) errors.push("fulfillment_policy_id is required");
    if (!returnPolicyId) errors.push("return_policy_id is required");

    if (errors.length) {
      return res.status(400).json({ error: "Validation failed", requestId, details: errors });
    }

    const up = await serviceClient
      .from("marketplace_policy_overrides")
      .upsert(
        {
          workspace_id: workspaceId,
          marketplace: "ebay",
          environment: env,
          marketplace_id: marketplaceId,
          payment_policy_id: paymentPolicyId,
          fulfillment_policy_id: fulfillmentPolicyId,
          return_policy_id: returnPolicyId,
        },
        {
          onConflict: "workspace_id,marketplace,environment,marketplace_id",
        }
      )
      .select("payment_policy_id,fulfillment_policy_id,return_policy_id,updated_at")
      .single();

    if (up.error) {
      return res.status(500).json({ error: "Failed to save overrides", requestId, details: up.error.message });
    }

    return res.status(200).json({
      success: true,
      requestId,
      saved: true,
      workspace_id: workspaceId,
      marketplace: "ebay",
      environment: env,
      marketplace_id: marketplaceId,
      overrides: up.data,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || "Internal server error",
      requestId,
    });
  }
}
