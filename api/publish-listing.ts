import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getValidEbayToken } from "./_lib/ebay-token-manager.js";
import { ensureMerchantLocation } from "./_lib/ebay-merchant-location.js";

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
  return e === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
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
  merchantLocationKey: string;
  requestId: string;
}) {
  const { env, accessToken, marketplaceId, listing, merchantLocationKey, requestId } = opts;
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
  const inventoryItemUrl = `${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;

  const invPayload: any = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    product: {
      title,
      description,
      imageUrls,
      aspects: {}, // TODO: map later
    },
  };

  let r = await fetch(inventoryItemUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US',
    },
    body: JSON.stringify(invPayload),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    let j: any = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = { raw: text };
    }
    const firstErr = j?.errors?.[0] || {};
    console.error('[ebay] inventory_item PUT failed', {
      requestId,
      status: r.status,
      errorId: firstErr.errorId,
      domain: firstErr.domain,
      category: firstErr.category,
      message: firstErr.message,
      longMessage: firstErr.longMessage,
      parameters: firstErr.parameters,
      bodyText: text,
      body: j,
      firstErr,
      firstErrString: JSON.stringify(firstErr, null, 2),
      bodyJsonString: JSON.stringify(j, null, 2),
    });
    throw new Error(firstErr.message || firstErr.longMessage || j.message || 'eBay API error');
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

  const country = String(process.env.EBAY_ITEM_COUNTRY || 'US').trim();
  const postalCode = String(process.env.EBAY_ITEM_POSTAL_CODE || '10001').trim();

  offerPayload.merchantLocationKey = merchantLocationKey;
  offerPayload.location = { country, postalCode };

  r = await fetch(offerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US',
    },
    body: JSON.stringify(offerPayload),
  });

  const offerText = await r.text().catch(() => '');
  let offerJson: any = {};
  try {
    offerJson = offerText ? JSON.parse(offerText) : {};
  } catch {
    offerJson = { raw: offerText };
  }
  if (!r.ok) {
    const firstErr = offerJson?.errors?.[0] || {};
    console.error('[ebay] offer POST failed', {
      requestId,
      status: r.status,
      errorId: firstErr.errorId,
      domain: firstErr.domain,
      category: firstErr.category,
      message: firstErr.message,
      longMessage: firstErr.longMessage,
      parameters: firstErr.parameters,
      body: offerJson,
    });
    throw new Error(firstErr.message || firstErr.longMessage || offerJson.message || 'eBay API error');
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
      'Accept-Language': 'en-US',
    },
  });

  const pubText = await r.text().catch(() => '');
  let pubJson: any = {};
  try {
    pubJson = pubText ? JSON.parse(pubText) : {};
  } catch {
    pubJson = { raw: pubText };
  }
  if (!r.ok) {
    const firstErr = pubJson?.errors?.[0] || {};
    console.error('[ebay] publish POST failed', {
      requestId,
      status: r.status,
      errorId: firstErr.errorId,
      domain: firstErr.domain,
      category: firstErr.category,
      message: firstErr.message,
      longMessage: firstErr.longMessage,
      parameters: firstErr.parameters,
      body: pubJson,
    });
    throw new Error(firstErr.message || firstErr.longMessage || pubJson.message || 'eBay API error');
  }

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

    // 3) Load listing
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
          'listing_json',
          'ebay_item_id',
          'ebay_listing_url',
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

    const status = String((listing as any).status || 'draft').toLowerCase();
    const existingEbayListingUrl = (listing as any).ebay_listing_url || null;
    const existingEbayItemId = (listing as any).ebay_item_id || null;

    // PRIORITY 2: Idempotency short-circuits (no eBay calls)
    if (status === 'published') {
      return res.status(200).json({
        ok: true,
        alreadyPublished: true,
        ebay_listing_url: existingEbayListingUrl,
        ebay_item_id: existingEbayItemId,
        requestId,
      });
    }

    if (status === 'publishing') {
      return res.status(409).json({
        ok: false,
        code: 'PUBLISH_IN_PROGRESS',
        message: 'Publishing in progress. Please wait and refresh.',
        requestId,
      });
    }

    // 4) Validations (must run before any eBay calls)
    const rawImages = body?.images ?? body?.image_urls ?? (listing as any)?.images ?? [];
    const incomingUrls = normalizeStringArray(rawImages);

    const invalidImageUrls = incomingUrls.filter((u) => !isHttpUrl(u));

    const errors: string[] = [];
    if (!(listing as any).title?.trim()) errors.push('Title is required.');
    if (!(listing as any).description?.trim()) errors.push('Description is required.');
    if (!(listing as any).category_id) errors.push('Category is required.');
    if (typeof (listing as any).price !== 'number' || (listing as any).price <= 0) errors.push('Price must be greater than 0.');
    if (!incomingUrls.length) errors.push('At least one image URL is required.');
    if (invalidImageUrls.length) errors.push('All image URLs must be http/https.');

    const listingJson: any = (listing as any).listing_json || {};

    const paymentPolicyId = String(
      listingJson.paymentPolicyId ??
        listingJson.ebay_payment_policy_id ??
        listingJson.ebayPaymentPolicyId ??
        (listing as any).ebay_payment_policy_id ??
        ''
    ).trim();

    const returnPolicyId = String(
      listingJson.returnPolicyId ??
        listingJson.ebay_return_policy_id ??
        listingJson.ebayReturnPolicyId ??
        (listing as any).ebay_return_policy_id ??
        ''
    ).trim();

    const fulfillmentPolicyId = String(
      listingJson.fulfillmentPolicyId ??
        listingJson.shippingPolicyId ??
        listingJson.ebay_fulfillment_policy_id ??
        listingJson.ebayFulfillmentPolicyId ??
        (listing as any).ebay_fulfillment_policy_id ??
        ''
    ).trim();

    if (!paymentPolicyId) errors.push('Payment policy ID is required.');
    if (!returnPolicyId) errors.push('Return policy ID is required.');
    if (!fulfillmentPolicyId) errors.push('Fulfillment (shipping) policy ID is required.');

    if (errors.length) {
      try {
        await serviceClient
          .from('listings')
          .update({
            last_publish_attempt_at: nowIso(),
            last_publish_error: 'Validation failed',
            last_publish_error_details: { stage: 'validation', errors },
          })
          .eq('id', (listing as any).id);
      } catch (e) {
        console.error('[publish] failed to persist validation error', { requestId, e });
      }

      return res.status(400).json({ errors, requestId });
    }

    // PRIORITY 2: Atomic publish lock (prevents double publish)
    // Only one request can transition draft -> publishing.
    const { data: publishingLockRows, error: publishingLockErr } = await serviceClient
      .from('listings')
      .update({
        status: 'publishing',
        published_at: null,
      })
      .eq('id', (listing as any).id)
      .eq('workspace_id', (listing as any).workspace_id)
      .eq('status', 'draft')
      .select('id');

    if (publishingLockErr) throw publishingLockErr;

    if (!publishingLockRows || (publishingLockRows as any[]).length === 0) {
      // Someone else acquired lock or status changed. Re-read status for correct idempotent response.
      const { data: curr, error: currErr } = await serviceClient
        .from('listings')
        .select('status,ebay_item_id,ebay_listing_url')
        .eq('id', (listing as any).id)
        .eq('workspace_id', (listing as any).workspace_id)
        .maybeSingle();

      if (!currErr && curr) {
        const currStatus = String((curr as any).status || '').toLowerCase();
        if (currStatus === 'published') {
          return res.status(200).json({
            ok: true,
            alreadyPublished: true,
            ebay_listing_url: (curr as any).ebay_listing_url || null,
            ebay_item_id: (curr as any).ebay_item_id || null,
            requestId,
          });
        }
        if (currStatus === 'publishing') {
          return res.status(409).json({
            ok: false,
            code: 'PUBLISH_IN_PROGRESS',
            message: 'Publishing in progress. Please wait and refresh.',
            requestId,
          });
        }
      }

      // Fallback: treat as in progress (safe default)
      return res.status(409).json({
        ok: false,
        code: 'PUBLISH_IN_PROGRESS',
        message: 'Publishing in progress. Please wait and refresh.',
        requestId,
      });
    }

    // Ensure we publish with the validated/derived values (policies + hosted images)
    const listingForPublish = {
      ...(listing as any),
      images: incomingUrls,
      ebay_payment_policy_id: paymentPolicyId,
      ebay_return_policy_id: returnPolicyId,
      ebay_fulfillment_policy_id: fulfillmentPolicyId,
    };

    try {
      // 5) Get valid token (centralized)
      const env = String(process.env.EBAY_ENV || 'production').toLowerCase() as 'production' | 'sandbox';
      const accessToken = await getValidEbayToken(String((listing as any).workspace_id), env);

      const merchantLocationKey = "mainWarehouse";

      await ensureMerchantLocation({
        env,
        accessToken,
        merchantLocationKey,
        requestId,
      });

      // 6) Publish
      const EBAY_MARKETPLACE_ID = String(process.env.EBAY_MARKETPLACE_ID || 'EBAY_US');

      const publishResult = await publishToEbayInventoryApi({
        env,
        accessToken,
        marketplaceId: EBAY_MARKETPLACE_ID,
        listing: listingForPublish,
        merchantLocationKey,
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
        .eq('id', (listing as any).id)
        .eq('workspace_id', (listing as any).workspace_id);

      if (listingUpdErr) throw new Error(`listing update failed: ${listingUpdErr.message}`);

      return res.status(200).json({
        success: true,
        requestId,
        env,
        refreshed: null, // token manager currently does not expose metadata
        marketplaceId: EBAY_MARKETPLACE_ID,
        offerId: publishResult.offerId,
        ebayListingId: publishResult.ebayListingId,
        ebayListingUrl: publishResult.ebayListingUrl,
      });
    } catch (err: any) {
      const msg = String(err?.message || 'Publish failed');

      // Reset from publishing so user can retry
      await serviceClient
        .from('listings')
        .update({
          status: 'draft',
          listing_json: { ...(listingJson || {}), publish_error: msg },
          last_publish_attempt_at: nowIso(),
          last_publish_error: msg,
          last_publish_error_details: { stage: 'publish', error: msg },
        })
        .eq('id', (listing as any).id)
        .eq('workspace_id', (listing as any).workspace_id)
        .eq('status', 'publishing');

      throw err;
    }

  } catch (err: any) {
    const statusCode = Number(err?.statusCode || 500);

    console.error('❌ /api/publish-listing error', {
      requestId,
      message: err?.message,
      stack: err?.stack,
      err,
    });

    return res.status(statusCode).json({
      error: err?.message || 'Internal server error',
      requestId,
      code: err?.code || null,
      details: err?.details || null,
    });
  }
}
