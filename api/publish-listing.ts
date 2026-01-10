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

function nowIso() {
  return new Date().toISOString();
}

function pickEbayApiBase(env: string) {
  const e = String(env || 'production').toLowerCase();
  // production vs sandbox
  return e === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

/**
 * Refresh eBay OAuth token using marketplace_connections row.
 * NOTE: This assumes you already store refresh_token and client credentials are in env.
 */
async function getValidEbayAccessTokenOrThrow(opts: {
  serviceClient: any;
  workspaceId: string;
  userId: string;
  env: string;
  requestId: string;
}) {
  const { serviceClient, workspaceId, userId, env, requestId } = opts;

  const { data: conn, error: connErr } = await serviceClient
    .from('marketplace_connections')
    .select('id, access_token, refresh_token, expires_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('marketplace', 'ebay')
    .eq('environment', env)
    .maybeSingle();

  if (connErr) throw new Error(`connection lookup failed: ${connErr.message}`);
  if (!conn?.id) throw new Error('No eBay account connected. Connect eBay in Settings.');

  const expired = conn.expires_at ? new Date(conn.expires_at).getTime() <= Date.now() + 30_000 : true;
  if (!expired && conn.access_token) {
    return { accessToken: conn.access_token as string, refreshed: false };
  }

  if (!conn.refresh_token) {
    throw new Error('eBay connection expired and no refresh token exists. Please reconnect eBay in Settings.');
  }

  const EBAY_CLIENT_ID = getEnv('EBAY_CLIENT_ID');
  const EBAY_CLIENT_SECRET = getEnv('EBAY_CLIENT_SECRET');

  // eBay OAuth token endpoint differs for sandbox vs prod
  const tokenUrl = env === 'sandbox' ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token' : 'https://api.ebay.com/identity/v1/oauth2/token';

  const basic = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', conn.refresh_token as string);

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('[ebay-refresh] failed', { requestId, status: resp.status, json });
    throw new Error(json?.error_description || json?.error || 'Failed to refresh eBay token');
  }

  const accessToken = String(json.access_token || '');
  const expiresIn = Number(json.expires_in || 0);
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  const { error: updErr } = await serviceClient
    .from('marketplace_connections')
    .update({
      access_token: accessToken,
      expires_at: expiresAt,
      updated_at: nowIso(),
    })
    .eq('id', conn.id);

  if (updErr) throw new Error(`Failed to persist refreshed token: ${updErr.message}`);

  return { accessToken, refreshed: true };
}

/**
 * REAL eBay publish using Inventory API.
 * This is the minimum viable mapping; you can enrich later.
 */
async function publishToEbayInventoryApi(opts: {
  env: string;
  accessToken: string;
  marketplaceId: string; // e.g. EBAY_US
  listing: any;
  requestId: string;
}) {
  const { env, accessToken, marketplaceId, listing, requestId } = opts;
  const base = pickEbayApiBase(env);

  // Use listing id as SKU (stable)
  const sku = String(listing.id);

  // images: enforce ordered hosted URLs
  const imageUrls = normalizeStringArray(listing.images || []).filter((u) => !isBlobOrObjectUrl(u) && isHttpUrl(u));
  if (!imageUrls.length) throw new Error('No hosted images found for publish.');

  // policy ids
  const paymentPolicyId = String(listing.ebay_payment_policy_id || '').trim();
  const returnPolicyId = String(listing.ebay_return_policy_id || '').trim();
  const fulfillmentPolicyId = String(listing.ebay_fulfillment_policy_id || '').trim(); // UI label: Shipping policy

  // IMPORTANT: These are REQUIRED in your UX
  if (!paymentPolicyId || !returnPolicyId || !fulfillmentPolicyId) {
    throw new Error('Missing required policy IDs (payment/return/shipping). Save draft and retry.');
  }

  const price = listing.price;
  if (typeof price !== 'number' || price <= 0) throw new Error('Invalid price for publish.');
  const currency = String(listing.currency || 'USD');

  const title = String(listing.title || '').trim();
  const description = String(listing.description || '').trim();
  const categoryId = String(listing.category_id || '').trim();

  if (!title || !description || !categoryId) throw new Error('Title/description/category are required for publish.');

  // 1) Upsert inventory item
  // NOTE: Inventory API description is not directly set here; it is often done via Listing API or via offer + listing details.
  // We'll include a minimal product payload; your real listing content can be expanded later.
  const inventoryItemUrl = `${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;

  const invPayload: any = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    product: {
      title,
      description,
      imageUrls,
      aspects: {}, // optional; can be mapped from listing_json.item_specifics later
    },
  };

  let r = await fetch(inventoryItemUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
    },
    body: JSON.stringify(invPayload),
  });

  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    console.error('[ebay] inventory_item PUT failed', { requestId, status: r.status, j });
    throw new Error(j?.errors?.[0]?.message || j?.message || 'Failed to upsert inventory item');
  }

  // 2) Create offer
  const offerUrl = `${base}/sell/inventory/v1/offer`;
  const offerPayload: any = {
    sku,
    marketplaceId,
    format: 'FIXED_PRICE',
    listingDescription: description,
    availableQuantity: 1,
    categoryId,
    listingPolicies: {
      paymentPolicyId,
      returnPolicyId,
      fulfillmentPolicyId,
    },
    pricingSummary: {
      price: { value: price.toFixed(2), currency },
    },
  };

  r = await fetch(offerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
    },
    body: JSON.stringify(offerPayload),
  });

  const offerJson: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[ebay] offer POST failed', { requestId, status: r.status, offerJson });
    throw new Error(offerJson?.errors?.[0]?.message || offerJson?.message || 'Failed to create offer');
  }

  const offerId = String(offerJson.offerId || '');
  if (!offerId) throw new Error('eBay did not return offerId.');

  // 3) Publish offer
  const publishUrl = `${base}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`;
  r = await fetch(publishUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
    },
  });

  const pubJson: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[ebay] publish POST failed', { requestId, status: r.status, pubJson });
    throw new Error(pubJson?.errors?.[0]?.message || pubJson?.message || 'Failed to publish offer');
  }

  // publish returns listingId (a string), not the itemId sometimes
  const ebayListingId = String(pubJson.listingId || pubJson.itemId || '');
  const ebayUrl = ebayListingId ? `https://www.ebay.com/itm/${ebayListingId}` : null;

  return {
    offerId,
    ebayListingId: ebayListingId || null,
    ebayListingUrl: ebayUrl,
    raw: pubJson,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

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

    // 1) Authenticate user
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const user = authData?.user;

    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    // 2) Input
    const body: any = req.body || {};
    const listingId = body.listing_id || body.listingId || body.id;
    if (!listingId) return res.status(400).json({ error: 'Missing listing_id', requestId });

    // 3) Load listing (ownership enforced). Include policy/package columns.
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
          'currency',
          'ebay_payment_policy_id',
          'ebay_return_policy_id',
          'ebay_fulfillment_policy_id',
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

    if (listingErr || !listing) return res.status(404).json({ error: 'Listing not found', requestId });

    if ((listing as any).created_by !== user.id) {
      return res.status(403).json({ error: 'Forbidden', requestId });
    }

    if (((listing as any).marketplace || 'ebay').toLowerCase() !== 'ebay') {
      return res.status(400).json({ error: 'Only eBay publishing is supported currently', requestId });
    }

    if ((listing as any).status === 'published') {
      return res.status(400).json({ error: 'Listing already published', requestId });
    }

    // 4) Basic validations (keep yours)
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

    // policy IDs required (your UX)
    const paymentId = String((listing as any).ebay_payment_policy_id || '').trim();
    const returnId = String((listing as any).ebay_return_policy_id || '').trim();
    const shippingId = String((listing as any).ebay_fulfillment_policy_id || '').trim();

    const missingPolicies: string[] = [];
    if (!shippingId) missingPolicies.push('Shipping policy');
    if (!returnId) missingPolicies.push('Return policy');
    if (!paymentId) missingPolicies.push('Payment policy');

    if (missingPolicies.length) {
      return res.status(400).json({
        error: 'Missing required policy IDs',
        missing: missingPolicies,
        hint: 'Complete the Shipping & Policies section, save the draft, and retry publishing.',
        requestId,
      });
    }

    if (errors.length) {
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso(),
          last_publish_error: 'Validation failed',
          last_publish_error_details: { stage: 'validation', errors },
        })
        .eq('id', (listing as any).id);

      return res.status(400).json({ error: 'Validation failed', requestId, details: errors });
    }

    // 5) Get valid token
    const env = String(process.env.EBAY_ENV || 'production').toLowerCase();
    const { accessToken, refreshed } = await getValidEbayAccessTokenOrThrow({
      serviceClient,
      workspaceId: (listing as any).workspace_id,
      userId: user.id,
      env,
      requestId,
    });

    // 6) Publish NOW (no jobs)
    const EBAY_MARKETPLACE_ID = String(process.env.EBAY_MARKETPLACE_ID || 'EBAY_US');

    const publishResult = await publishToEbayInventoryApi({
      env,
      accessToken,
      marketplaceId: EBAY_MARKETPLACE_ID,
      listing,
      requestId,
    });

    // 7) Update DB as published
    const finishedAt = nowIso();
    const { error: listingUpdErr } = await serviceClient
      .from('listings')
      .update({
        status: 'published',
        published_at: finishedAt,
        ebay_item_id: publishResult.ebayListingId,
        ebay_listing_url: publishResult.ebayListingUrl,
        last_publish_attempt_at: finishedAt,
        last_publish_error: null,
        last_publish_error_details: null,
      })
      .eq('id', (listing as any).id);

    if (listingUpdErr) throw new Error(`listing update failed: ${listingUpdErr.message}`);

    return res.status(200).json({
      success: true,
      requestId,
      env,
      refreshed,
      marketplaceId: EBAY_MARKETPLACE_ID,
      offerId: publishResult.offerId,
      ebayListingId: publishResult.ebayListingId,
      ebayListingUrl: publishResult.ebayListingUrl,
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
