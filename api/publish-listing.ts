import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
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

function isHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isBlobOrObjectUrl(u: string): boolean {
  const s = (u || '').trim().toLowerCase();
  return s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('file:');
}

function normalizeStringArray(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

type EbayConnectionRow = {
  id: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: string | null; // ISO
  environment?: string | null;
};

function isAccessExpired(expiresAtIso?: string | null): boolean {
  if (!expiresAtIso) return true;
  const ms = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(ms)) return true;
  // Refresh slightly early to avoid edge cases
  return ms <= Date.now() + 30_000;
}

/**
 * Refresh the eBay token if expired.
 * NOTE: This assumes you already have an existing refresh endpoint/helper somewhere.
 * If you don't, paste your existing refresh logic here (from your worker).
 */
async function refreshEbayTokenIfNeeded(args: {
  serviceClient: ReturnType<typeof createClient>;
  connection: EbayConnectionRow;
  workspaceId: string;
  userId: string;
  env: string;
  requestId: string;
}): Promise<{ accessToken: string; connectionId: string }> {
  const { serviceClient, connection, workspaceId, userId, env, requestId } = args;

  // If we have a non-expired token, use it
  if (!isAccessExpired(connection.expires_at) && connection.access_token) {
    return { accessToken: connection.access_token, connectionId: connection.id };
  }

  // If expired but no refresh token, hard fail
  if (!connection.refresh_token) {
    throw new Error('eBay connection expired (no refresh token). Reconnect eBay in Settings.');
  }

  // ---- IMPORTANT ----
  // Replace this block with YOUR real refresh implementation.
  //
  // In your codebase you said:
  // "Token refresh works correctly. Stored in marketplace_connections."
  // So you already have a working refresh function in another file.
  //
  // Here we do NOT guess endpoints. We just throw with an instruction to wire your known-good code.
  //
  // If you paste your refresh helper (or file path), I will inline it properly.
  throw new Error(
    `Token refresh required but refresh logic is not wired into /api/publish-listing.ts yet. ` +
      `Move your existing refresh implementation here. requestId=${requestId}`
  );
}

async function publishToEbayNow(args: {
  // Auth / tenancy
  userId: string;
  workspaceId: string;
  env: string;

  // Listing data
  listing: any;
  imageUrls: string[];

  // Policies
  paymentPolicyId: string;
  returnPolicyId: string;
  shippingPolicyId: string;

  // Auth token
  accessToken: string;

  // Diagnostics
  requestId: string;
}): Promise<{ marketplaceListingId?: string; raw?: any }> {
  const {
    // userId,
    // workspaceId,
    // env,
    listing,
    imageUrls,
    paymentPolicyId,
    returnPolicyId,
    shippingPolicyId,
    accessToken,
    requestId,
  } = args;

  // ---- IMPORTANT ----
  // Paste your actual eBay publish logic here (the logic currently in your worker stub).
  // Do NOT create jobs. Just do the API calls now and return IDs.
  //
  // This function should throw on failure with a meaningful message.
  //
  // For now we do a stub that "pretends" publish succeeded.
  // Replace ASAP.

  if (!accessToken) throw new Error(`Missing access token (requestId=${requestId})`);
  if (!listing?.title) throw new Error('Listing title missing');
  if (!listing?.category_id) throw new Error('Listing category missing');
  if (!imageUrls?.length) throw new Error('At least one image URL is required');

  // Example: return a fake ID to prove flow end-to-end
  return {
    marketplaceListingId: `STUB-${listing.id}`,
    raw: {
      note: 'stub publish; replace publishToEbayNow() with real eBay API calls',
      usedPolicies: { paymentPolicyId, returnPolicyId, shippingPolicyId },
      images: imageUrls.slice(0, 2),
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  const nowIso = new Date().toISOString();

  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL');
    const SUPABASE_ANON_KEY = getEnv('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const authHeader = req.headers.authorization || '';

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
      auth: { persistSession: false },
    });

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    /* -------------------------------------------------------
       1) Authenticate user
    ------------------------------------------------------- */
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    /* -------------------------------------------------------
       2) Input
    ------------------------------------------------------- */
    const body: any = req.body || {};
    const listingId = body.listing_id || body.listingId || body.id;

    if (!listingId) {
      return res.status(400).json({ error: 'Missing listing_id', requestId });
    }

    /* -------------------------------------------------------
       3) Load listing (ownership enforced)
    ------------------------------------------------------- */
    const { data: listing, error: listingErr } = await userClient
      .from('listings')
      .select(
        [
          'id',
          'workspace_id',
          'created_by',
          'status',
          'marketplace',
          'title',
          'description',
          'category_id',
          'images',
          'price',

          // per listing policies
          'ebay_payment_policy_id',
          'ebay_return_policy_id',
          'ebay_fulfillment_policy_id',

          // optional package fields (not required to publish right now)
          'package_weight_lb',
          'package_weight_oz',
          'package_length_in',
          'package_width_in',
          'package_height_in',
          'irregular_package',
        ].join(',')
      )
      .eq('id', listingId)
      .single();

    if (listingErr || !listing) {
      return res.status(404).json({ error: 'Listing not found', requestId });
    }

    if ((listing as any).created_by !== user.id) {
      return res.status(403).json({ error: 'Forbidden', requestId });
    }

    if (((listing as any).marketplace || 'ebay').toLowerCase() !== 'ebay') {
      return res.status(400).json({ error: 'Only eBay publishing is supported currently', requestId });
    }

    if ((listing as any).status === 'published') {
      return res.status(400).json({ error: 'Listing already published', requestId });
    }

    /* -------------------------------------------------------
       4) Shipping & Policies validation (UX names)
       REQUIRED: policy IDs only
    ------------------------------------------------------- */
    const paymentPolicyId = String((listing as any).ebay_payment_policy_id || '').trim();
    const returnPolicyId = String((listing as any).ebay_return_policy_id || '').trim();
    const shippingPolicyId = String((listing as any).ebay_fulfillment_policy_id || '').trim(); // UI: Shipping policy

    const missingPolicies: string[] = [];
    if (!shippingPolicyId) missingPolicies.push('Shipping policy');
    if (!returnPolicyId) missingPolicies.push('Return policy');
    if (!paymentPolicyId) missingPolicies.push('Payment policy');

    if (missingPolicies.length) {
      return res.status(400).json({
        error: 'Missing required policy IDs',
        missing: missingPolicies,
        hint: 'Complete the Shipping & Policies section, save the draft, and retry publishing.',
        requestId,
      });
    }

    /* -------------------------------------------------------
       5) Image + listing validation
    ------------------------------------------------------- */
    const rawImages = body?.images ?? body?.image_urls ?? (listing as any)?.images ?? [];
    const incomingUrls = normalizeStringArray(rawImages);

    const blobOrObjectUrls = incomingUrls.filter(isBlobOrObjectUrl);
    const nonHttpUrls = incomingUrls.filter((u) => !isBlobOrObjectUrl(u) && !isHttpUrl(u));
    const imageUrls = incomingUrls.filter((u) => !isBlobOrObjectUrl(u) && isHttpUrl(u));

    const errors: string[] = [];

    if (!(listing as any).title?.trim()) errors.push('Title is required.');
    if (!(listing as any).description?.trim()) errors.push('Description is required.');
    if (!(listing as any).category_id) errors.push('Category is required.');
    if (!imageUrls.length) errors.push('At least one hosted image URL is required.');
    if (typeof (listing as any).price !== 'number' || (listing as any).price <= 0) errors.push('Price must be greater than 0.');

    if (blobOrObjectUrls.length) errors.push('Blob/data/file image URLs are not allowed.');
    if (nonHttpUrls.length) errors.push('Image URLs must be http/https.');

    if (errors.length) {
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso,
          last_publish_error: 'Validation failed',
          last_publish_error_details: { stage: 'validation', errors },
        })
        .eq('id', (listing as any).id);

      return res.status(400).json({
        error: 'Validation failed',
        requestId,
        details: errors,
      });
    }

    /* -------------------------------------------------------
       6) Verify eBay connection exists
    ------------------------------------------------------- */
    const env = String(process.env.EBAY_ENV || 'production').toLowerCase();

    const { data: connection, error: connErr } = await serviceClient
      .from('marketplace_connections')
      .select('id, access_token, expires_at, refresh_token, environment')
      .eq('workspace_id', (listing as any).workspace_id)
      .eq('user_id', user.id)
      .eq('marketplace', 'ebay')
      .eq('environment', env)
      .maybeSingle();

    if (connErr) {
      console.error('[publish-listing] connection lookup failed', { requestId, connErr });
      return res.status(500).json({ error: 'Failed to check eBay connection', requestId });
    }

    if (!connection?.id) {
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso,
          last_publish_error: 'No eBay connection found',
          last_publish_error_details: { stage: 'connection', env },
        })
        .eq('id', (listing as any).id);

      return res.status(400).json({
        error: 'No eBay account connected. Connect eBay in Settings.',
        requestId,
      });
    }

    /* -------------------------------------------------------
       7) Refresh token if needed (synchronous flow)
    ------------------------------------------------------- */
    let accessToken = String((connection as any).access_token || '').trim();

    if (isAccessExpired((connection as any).expires_at) || !accessToken) {
      // If token refresh is required, run it here (synchronously)
      const refreshed = await refreshEbayTokenIfNeeded({
        serviceClient,
        connection: connection as any,
        workspaceId: (listing as any).workspace_id,
        userId: user.id,
        env,
        requestId,
      });
      accessToken = refreshed.accessToken;
    }

    if (!accessToken) {
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso,
          last_publish_error: 'Missing eBay access token',
          last_publish_error_details: { stage: 'connection', env },
        })
        .eq('id', (listing as any).id);

      return res.status(400).json({
        error: 'eBay connection invalid. Please reconnect eBay in Settings.',
        requestId,
      });
    }

    /* -------------------------------------------------------
       8) Publish to eBay NOW (no jobs)
    ------------------------------------------------------- */
    let publishResult: { marketplaceListingId?: string; raw?: any } | null = null;

    try {
      publishResult = await publishToEbayNow({
        userId: user.id,
        workspaceId: (listing as any).workspace_id,
        env,

        listing,
        imageUrls,

        paymentPolicyId,
        returnPolicyId,
        shippingPolicyId,

        accessToken,
        requestId,
      });
    } catch (e: any) {
      const msg = e?.message || 'Publish failed';
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso,
          last_publish_error: msg,
          last_publish_error_details: { stage: 'ebay_publish', error: msg },
        })
        .eq('id', (listing as any).id);

      return res.status(400).json({
        error: msg,
        requestId,
      });
    }

    /* -------------------------------------------------------
       9) Mark listing published
       NOTE: only update columns that exist in your DB.
    ------------------------------------------------------- */
    const updatePayload: any = {
      status: 'published',
      last_publish_attempt_at: nowIso,
      last_publish_error: null,
      last_publish_error_details: null,
    };

    // If you have these columns, keep them. If you don't, remove them.
    // updatePayload.published_at = nowIso;
    // updatePayload.marketplace_listing_id = publishResult?.marketplaceListingId ?? null;

    await serviceClient.from('listings').update(updatePayload).eq('id', (listing as any).id);

    return res.status(200).json({
      success: true,
      requestId,
      env,
      listingId: (listing as any).id,
      marketplaceListingId: publishResult?.marketplaceListingId ?? null,
      debug: publishResult?.raw ?? null,
    });
  } catch (err: any) {
    console.error('❌ /api/publish-listing error', { requestId, err });
    return res.status(500).json({
      error: 'Internal server error',
      requestId,
      details: err?.message || String(err),
    });
  }
}
