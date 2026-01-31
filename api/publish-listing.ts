import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getValidEbayToken } from "../lib/ebay/ebay-token-manager.js";
import { ensureMerchantLocation } from "../lib/ebay/ebay-merchant-location.js";
import { ebayFetch, EbayHttpError } from "../lib/ebay/ebay-http.js";
import { sentryCaptureException, sentryCaptureMessage } from "../lib/sentry.js";

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 60,
};

function respond(res: VercelResponse, status: number, payload: unknown) {
  return res.status(status).json(payload);
}

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

function extractEbayErrorId(payload: any): string | null {
  const v =
    payload?.errors?.[0]?.errorId ??
    payload?.errors?.[0]?.error_id ??
    payload?.errorId ??
    payload?.error_id;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function extractEbayRequestId(payload: any): string | null {
  const v = payload?.requestId ?? payload?.request_id ?? payload?.meta?.requestId ?? payload?.meta?.request_id;
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function sanitizeListingForEbay(listingJson: unknown): {
  cleaned: any;
  removed: { path: string; reason: string }[];
} {
  // NOTE: This sanitizer is payload-only. It intentionally does NOT persist changes back to DB.
  // Use `any` only inside this function to keep the rest of the file type-safe.

  const removed: { path: string; reason: string }[] = [];

  const addRemoved = (path: string, reason: string) => {
    removed.push({ path, reason });
  };

  const isPlainObject = (v: any) => {
    if (!v || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };

  const cleanStringField = (obj: any, key: string, path: string, opts?: { coerceNumber?: boolean }) => {
    const v = obj?.[key];
    if (v == null) return;

    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) {
        addRemoved(path, 'empty');
        delete obj[key];
        return;
      }
      obj[key] = t;
      return;
    }

    // Only coerce non-string primitives when explicitly safe.
    if (opts?.coerceNumber && typeof v === 'number' && Number.isFinite(v)) {
      const t = String(v).trim();
      if (!t) {
        addRemoved(path, 'empty');
        delete obj[key];
        return;
      }
      obj[key] = t;
      return;
    }

    addRemoved(path, 'non-string');
    delete obj[key];
  };

  const cleanPolicyId = (obj: any, key: string, path: string) => {
    const v = obj?.[key];
    if (v == null) return;

    // IDs are safe to stringify when primitive.
    if (typeof v !== 'string' && typeof v !== 'number') {
      addRemoved(path, 'non-string');
      delete obj[key];
      return;
    }

    const t = String(v).trim();
    if (!t) {
      addRemoved(path, 'empty');
      delete obj[key];
      return;
    }

    obj[key] = t;
  };

  const cleanStringArray = (value: any, path: string, opts?: { coercePrimitives?: boolean }): string[] => {
    if (!Array.isArray(value)) {
      addRemoved(path, 'not-array');
      return [];
    }

    const coerce = opts?.coercePrimitives !== false;
    const out: string[] = [];

    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v === 'string') {
        const t = v.trim();
        if (!t) {
          addRemoved(`${path}[${i}]`, 'empty');
          continue;
        }
        out.push(t);
        continue;
      }

      if (coerce && typeof v === 'number') {
        const t = String(v).trim();
        if (!t) {
          addRemoved(`${path}[${i}]`, 'empty');
          continue;
        }
        out.push(t);
        continue;
      }

      addRemoved(`${path}[${i}]`, 'non-string');
    }

    return out;
  };

  const cleanUrlArray = (value: any, path: string): string[] => {
    const raw = cleanStringArray(value, path, { coercePrimitives: false });
    const seen = new Set<string>();
    const out: string[] = [];

    for (let i = 0; i < raw.length; i++) {
      const u = raw[i];
      if (!isHttpUrl(u)) {
        addRemoved(`${path}[${i}]`, 'invalid-url');
        continue;
      }
      if (seen.has(u)) {
        addRemoved(`${path}[${i}]`, 'duplicate');
        continue;
      }
      seen.add(u);
      out.push(u);
    }

    return out;
  };

  const cleaned: any = isPlainObject(listingJson) ? { ...(listingJson || {}) } : {};

  // Common top-level strings
  cleanStringField(cleaned, 'title', 'title');
  cleanStringField(cleaned, 'description', 'description');
  cleanStringField(cleaned, 'brand', 'brand');
  cleanStringField(cleaned, 'model', 'model');
  cleanStringField(cleaned, 'sku', 'sku', { coerceNumber: true });
  cleanStringField(cleaned, 'condition_name', 'condition_name');
  cleanStringField(cleaned, 'condition_description', 'condition_description');

  // Also trim the canonical eBay policy keys if present in listing_json
  cleanPolicyId(cleaned, 'ebay_payment_policy_id', 'ebay_payment_policy_id');
  cleanPolicyId(cleaned, 'ebay_return_policy_id', 'ebay_return_policy_id');
  cleanPolicyId(cleaned, 'ebay_fulfillment_policy_id', 'ebay_fulfillment_policy_id');

  // Price
  if (cleaned.price != null) {
    const raw = cleaned.price;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(n) && n > 0) {
      cleaned.price = Math.round(n * 100) / 100;
    } else {
      // Requirement: do not change value, just record invalid.
      addRemoved('price', 'invalid price');
    }
  }

  // Images (sanitize whichever the JSON has)
  if (cleaned.images != null) {
    const urls = cleanUrlArray(cleaned.images, 'images');
    if (urls.length) cleaned.images = urls;
    else {
      addRemoved('images', 'empty');
      delete cleaned.images;
    }
  }

  if (cleaned.image_urls != null) {
    const urls = cleanUrlArray(cleaned.image_urls, 'image_urls');
    if (urls.length) cleaned.image_urls = urls;
    else {
      addRemoved('image_urls', 'empty');
      delete cleaned.image_urls;
    }
  }

  // Category + condition
  if (cleaned.category_id != null) {
    const s = String(cleaned.category_id).trim();
    if (!s) {
      addRemoved('category_id', 'empty');
      delete cleaned.category_id;
    } else {
      cleaned.category_id = s;
      if (!/^\d+$/.test(s)) {
        addRemoved('category_id', 'invalid category_id');
      }
    }
  }

  if (cleaned.condition_id != null) {
    const raw = cleaned.condition_id;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (Number.isFinite(n) && n > 0) {
      cleaned.condition_id = n;
    } else {
      addRemoved('condition_id', 'invalid condition_id');
    }
  }

  // Policies: trim only; do not invent.
  cleanPolicyId(cleaned, 'payment_policy_id', 'payment_policy_id');
  cleanPolicyId(cleaned, 'return_policy_id', 'return_policy_id');
  cleanPolicyId(cleaned, 'fulfillment_policy_id', 'fulfillment_policy_id');

  // Aspects: { Brand: ["Nike"] }
  if (isPlainObject(cleaned.aspects)) {
    const next: any = {};
    for (const [rawKey, rawVal] of Object.entries(cleaned.aspects)) {
      const key = String(rawKey || '').trim();
      if (!key) {
        addRemoved('aspects.<key>', 'empty-key');
        continue;
      }

      if (Array.isArray(rawVal)) {
        const vals = cleanStringArray(rawVal, `aspects.${key}`, { coercePrimitives: true });
        if (!vals.length) {
          addRemoved(`aspects.${key}`, 'empty');
          continue;
        }
        next[key] = vals;
        continue;
      }

      if (typeof rawVal === 'string' || typeof rawVal === 'number') {
        const t = String(rawVal).trim();
        if (!t) {
          addRemoved(`aspects.${key}`, 'empty');
          continue;
        }
        next[key] = [t];
        continue;
      }

      addRemoved(`aspects.${key}`, 'invalid');
    }

    cleaned.aspects = next;
  }

  // Item specifics: support either object map or array
  // - object map: { "Brand": "Nike" }
  // - array: [{ name, value }]
  if (isPlainObject(cleaned.item_specifics)) {
    const next: any = {};
    for (const [rawKey, rawVal] of Object.entries(cleaned.item_specifics)) {
      const key = String(rawKey || '').trim();
      if (!key) {
        addRemoved('item_specifics.<key>', 'empty-key');
        continue;
      }

      if (Array.isArray(rawVal)) {
        const vals = cleanStringArray(rawVal, `item_specifics.${key}`);
        if (!vals.length) {
          addRemoved(`item_specifics.${key}`, 'empty');
          continue;
        }
        next[key] = vals;
        continue;
      }

      if (typeof rawVal === 'string') {
        const t = rawVal.trim();
        if (!t) {
          addRemoved(`item_specifics.${key}`, 'empty');
          continue;
        }
        next[key] = t;
        continue;
      }

      // Only coerce primitives to string when safe: numbers/bools are safe here.
      if (typeof rawVal === 'number') {
        const t = String(rawVal).trim();
        if (!t) {
          addRemoved(`item_specifics.${key}`, 'empty');
          continue;
        }
        next[key] = t;
        continue;
      }


      addRemoved(`item_specifics.${key}`, 'invalid');
    }

    cleaned.item_specifics = next;
  } else if (Array.isArray(cleaned.item_specifics)) {
    const next: any[] = [];
    for (let i = 0; i < cleaned.item_specifics.length; i++) {
      const s = cleaned.item_specifics[i];
      const name = String(s?.name ?? s?.Name ?? '').trim();
      if (!name) {
        addRemoved(`item_specifics[${i}].name`, 'empty');
        continue;
      }

      const rawVal = s?.value ?? s?.Value;

      if (Array.isArray(rawVal)) {
        const vals = cleanStringArray(rawVal, `item_specifics.${name}`);
        if (!vals.length) {
          addRemoved(`item_specifics.${name}`, 'empty');
          continue;
        }
        next.push({ ...s, name, value: vals });
        continue;
      }

      if (typeof rawVal === 'string') {
        const t = rawVal.trim();
        if (!t) {
          addRemoved(`item_specifics.${name}`, 'empty');
          continue;
        }
        next.push({ ...s, name, value: t });
        continue;
      }

      if (typeof rawVal === 'number') {
        const t = String(rawVal).trim();
        if (!t) {
          addRemoved(`item_specifics.${name}`, 'empty');
          continue;
        }
        next.push({ ...s, name, value: t });
        continue;
      }

      addRemoved(`item_specifics.${name}`, 'invalid');
    }

    cleaned.item_specifics = next;
  }

  return { cleaned, removed };
}

function pickEbayApiBase(env: string) {
  const e = String(env || 'production').toLowerCase();
  return e === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

let cachedEbayAppToken: { access_token: string; expires_at: number } | null = null;

async function getEbayAppToken(env: string, requestId: string): Promise<string> {
  if (cachedEbayAppToken && cachedEbayAppToken.expires_at > Date.now()) {
    return cachedEbayAppToken.access_token;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('eBay credentials not found (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)');
  }

  const base = pickEbayApiBase(env);
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const r = await ebayFetch(
    `${base}/identity/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${encoded}`,
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    },
    { requestId, operation: 'publish' }
  );

  if (!r.ok) {
    throw new Error(`eBay app token request failed (status ${r.status})`);
  }

  const data: any = r.json || {};
  const accessToken = String(data.access_token || '');
  const expiresIn = Number(data.expires_in ?? 7200);

  if (!accessToken) {
    throw new Error('eBay app token missing access_token');
  }

  cachedEbayAppToken = {
    access_token: accessToken,
    expires_at: Date.now() + Math.max(0, (expiresIn - 300) * 1000),
  };

  return accessToken;
}

// Removed: getCategoryConditionsForPublish (deprecated)

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

  const failGuard = (field: string, userMessage: string) => {
    const e: any = new Error(userMessage);
    e.code = 'PUBLISH_GUARD';
    e.field = field;
    return e;
  };

  // Use listing id as SKU (stable)
  const sku = String(listing.id || '').trim();
  if (!sku) throw failGuard('sku', 'Missing SKU for publish.');

  const safeMarketplaceId = String(marketplaceId || '').trim();
  if (!safeMarketplaceId) throw failGuard('marketplaceId', 'Marketplace is required for publish.');
  if (safeMarketplaceId !== 'EBAY_US') {
    // Minimal production-safe guard (current app uses EBAY_US)
    throw failGuard('marketplaceId', 'Unsupported marketplace for publish.');
  }

  const safeMerchantLocationKey = String(merchantLocationKey || '').trim();
  if (!safeMerchantLocationKey) throw failGuard('merchantLocationKey', 'Merchant location is not configured for this eBay account.');

  // images: enforce ordered hosted URLs
  const imageUrls = normalizeStringArray(listing.images || []).filter((u) => !isBlobOrObjectUrl(u) && isHttpUrl(u));
  if (!imageUrls.length) throw failGuard('images', 'At least one hosted image is required for publish.');

  // policy ids
  const paymentPolicyId = String(listing.ebay_payment_policy_id || '').trim();
  const returnPolicyId = String(listing.ebay_return_policy_id || '').trim();
  const fulfillmentPolicyId = String(listing.ebay_fulfillment_policy_id || '').trim(); // UI label: Shipping policy

  if (!paymentPolicyId) throw failGuard('payment_policy_id', 'Missing required policy IDs (payment/return/shipping). Save draft and retry.');
  if (!returnPolicyId) throw failGuard('return_policy_id', 'Missing required policy IDs (payment/return/shipping). Save draft and retry.');
  if (!fulfillmentPolicyId) throw failGuard('fulfillment_policy_id', 'Missing required policy IDs (payment/return/shipping). Save draft and retry.');

  const price = listing.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) throw failGuard('price', 'Invalid price for publish.');
  const currency = String(listing.currency || 'USD').trim();
  if (!currency) throw failGuard('currency', 'Currency is required for publish.');
  if (safeMarketplaceId === 'EBAY_US' && currency !== 'USD') throw failGuard('currency', 'Currency must be USD for this marketplace.');

  const title = String(listing.title || '').trim();
  const description = String(listing.description || '').trim();
  const categoryId = String(listing.category_id || '').trim();

  if (!title) throw failGuard('title', 'Title is required for publish.');
  if (!description) throw failGuard('description', 'Description is required for publish.');
  if (!categoryId || !/^\d+$/.test(categoryId)) throw failGuard('category_id', 'Category is required for publish.');

  // 1) Upsert inventory item
  const inventoryItemUrl = `${base}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;

  // Condition: must be present and a digits-only string id
  const rawConditionId =
    listing?.listing_json?.condition_id ??
    listing?.listing_json?.conditionId ??
    listing?.listing_json?.conditionID ??
    listing?.listing_json?.ebay_condition_id ??
    '';

  const conditionIdStr = String(rawConditionId || '').trim();
  const conditionIdNum = conditionIdStr ? Number.parseInt(conditionIdStr, 10) : NaN;

  if (!conditionIdStr || !/^\d+$/.test(conditionIdStr) || !Number.isFinite(conditionIdNum) || conditionIdNum <= 0) {
    throw failGuard('condition_id', 'Condition is required. Please select a condition for this category.');
  }

  const rawAspects: any = listing?.listing_json?.aspects;
  const aspects: any = {};

  if (rawAspects && typeof rawAspects === 'object' && !Array.isArray(rawAspects)) {
    for (const [k, v] of Object.entries(rawAspects)) {
      const key = String(k || '').trim();
      if (!key) continue;
      if (!Array.isArray(v)) continue;

      const vals = (v as any[])
        .filter((x) => typeof x === 'string' || typeof x === 'number')
        .map((x) => String(x).trim())
        .filter((x) => x.length > 0);

      if (vals.length) aspects[key] = vals;
    }
  }

  const invProduct: any = {
    title,
    description,
    imageUrls,
    ...(Object.keys(aspects).length ? { aspects } : {}),
    conditionId: conditionIdNum,
  };

  if (!invProduct.title) throw failGuard('inventory.product.title', 'Title is required for publish.');
  if (!invProduct.description) throw failGuard('inventory.product.description', 'Description is required for publish.');
  if (!Array.isArray(invProduct.imageUrls) || invProduct.imageUrls.length === 0) throw failGuard('inventory.product.imageUrls', 'At least one hosted image is required for publish.');

  const invPayload: any = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    product: invProduct,
  };

  const r1 = await ebayFetch(
    inventoryItemUrl,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
        'Accept-Language': 'en-US',
      },
      body: JSON.stringify(invPayload),
    },
    { requestId, operation: 'publish' }
  );

  if (!r1.ok) {
    const text = r1.text || '';
    const j: any = r1.json || {};

    const firstErr = j?.errors?.[0] || {};
    console.error('[ebay] inventory_item PUT failed', {
      operation: 'inventory',
      requestId,
      status: r1.status,
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

    const e: any = new Error(
      `eBay rejected the request (errorId: ${String(firstErr.errorId || '') || 'unknown'}): ${
        firstErr.message || firstErr.longMessage || j.message || 'eBay API error'
      }`
    );
    e.statusCode = r1.status;
    e.ebayPayload = j;
    if (r1.meta?.retryExhausted) e.hint = 'retry_exhausted';
    throw e;
  }

  // 2) Create offer
  const offerUrl = `${base}/sell/inventory/v1/offer`;
  const conditionDescription = String(listing?.listing_json?.condition_description || '').trim();

  const offerPayload: any = {
    sku,
    marketplaceId: safeMarketplaceId,
    format: 'FIXED_PRICE',
    listingDescription: description,
    availableQuantity: 1,
    categoryId,
    conditionId: conditionIdNum,
    ...(conditionDescription && conditionDescription.length <= 1000 ? { conditionDescription } : {}),
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

  offerPayload.merchantLocationKey = safeMerchantLocationKey;
  offerPayload.location = { country, postalCode };

  // Offer payload hardening (structural guard)
  if (!offerPayload.sku) throw failGuard('offer.sku', 'Unable to publish. Please review the listing and try again.');
  if (offerPayload.marketplaceId !== 'EBAY_US') throw failGuard('offer.marketplaceId', 'Unable to publish. Please review the listing and try again.');
  if (offerPayload.format !== 'FIXED_PRICE') throw failGuard('offer.format', 'Unable to publish. Please review the listing and try again.');
  if (typeof offerPayload.listingDescription !== 'string' || !offerPayload.listingDescription.trim()) {
    throw failGuard('offer.listingDescription', 'Unable to publish. Please review the listing and try again.');
  }
  if (!Number.isInteger(offerPayload.availableQuantity) || offerPayload.availableQuantity < 1) {
    throw failGuard('offer.availableQuantity', 'Unable to publish. Please review the listing and try again.');
  }
  if (typeof offerPayload.categoryId !== 'string' || !/^\d+$/.test(offerPayload.categoryId)) {
    throw failGuard('offer.categoryId', 'Unable to publish. Please review the listing and try again.');
  }
  if (!offerPayload.merchantLocationKey) {
    throw failGuard('offer.merchantLocationKey', 'Merchant location is not configured for this eBay account.');
  }

  const lp = offerPayload.listingPolicies || {};
  if (!String(lp.paymentPolicyId || '').trim()) throw failGuard('offer.listingPolicies.paymentPolicyId', 'Missing required policy IDs (payment/return/shipping). Save draft and retry.');
  if (!String(lp.returnPolicyId || '').trim()) throw failGuard('offer.listingPolicies.returnPolicyId', 'Missing required policy IDs (payment/return/shipping). Save draft and retry.');
  if (!String(lp.fulfillmentPolicyId || '').trim()) throw failGuard('offer.listingPolicies.fulfillmentPolicyId', 'Missing required policy IDs (payment/return/shipping). Save draft and retry.');

  const pv = Number.parseFloat(String(offerPayload.pricingSummary?.price?.value ?? ''));
  const pc = String(offerPayload.pricingSummary?.price?.currency || '').trim();
  if (!Number.isFinite(pv) || pv <= 0) throw failGuard('offer.pricingSummary.price.value', 'Invalid price for publish.');
  if (!/^[0-9]+\.[0-9]{2}$/.test(String(offerPayload.pricingSummary?.price?.value || ''))) {
    throw failGuard('offer.pricingSummary.price.value', 'Invalid price for publish.');
  }
  if (!pc) throw failGuard('offer.pricingSummary.price.currency', 'Currency is required for publish.');
  if (offerPayload.marketplaceId === 'EBAY_US' && pc !== 'USD') throw failGuard('offer.pricingSummary.price.currency', 'Currency must be USD for this marketplace.');


  const r2 = await ebayFetch(
    offerUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
        'Accept-Language': 'en-US',
      },
      body: JSON.stringify(offerPayload),
    },
    { requestId, operation: 'publish' }
  );

  const offerJson: any = r2.json || {};

  if (!r2.ok) {
    const firstErr = offerJson?.errors?.[0] || {};
    console.error('[ebay] offer POST failed', {
      operation: 'offer',
      requestId,
      status: r2.status,
      errorId: firstErr.errorId,
      domain: firstErr.domain,
      category: firstErr.category,
      message: firstErr.message,
      longMessage: firstErr.longMessage,
      parameters: firstErr.parameters,
      body: offerJson,
    });

    const e: any = new Error(
      `eBay rejected the request (errorId: ${String(firstErr.errorId || '') || 'unknown'}): ${
        firstErr.message || firstErr.longMessage || offerJson.message || 'eBay API error'
      }`
    );
    e.statusCode = r2.status;
    e.ebayPayload = offerJson;
    if (r2.meta?.retryExhausted) e.hint = 'retry_exhausted';
    throw e;
  }

  const offerId = String(offerJson.offerId || '');
  if (!offerId) throw new Error('eBay did not return offerId.');

  // 3) Publish offer
  const publishUrl = `${base}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`;
  const r3 = await ebayFetch(
    publishUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
        'Accept-Language': 'en-US',
      },
    },
    { requestId, operation: 'publish' }
  );

  const pubJson: any = r3.json || {};

  if (!r3.ok) {
    const firstErr = pubJson?.errors?.[0] || {};
    console.error('[ebay] publish POST failed', {
      operation: 'publish',
      requestId,
      status: r3.status,
      errorId: firstErr.errorId,
      domain: firstErr.domain,
      category: firstErr.category,
      message: firstErr.message,
      longMessage: firstErr.longMessage,
      parameters: firstErr.parameters,
      body: pubJson,
    });

    const e: any = new Error(
      `eBay rejected the request (errorId: ${String(firstErr.errorId || '') || 'unknown'}): ${
        firstErr.message || firstErr.longMessage || pubJson.message || 'eBay API error'
      }`
    );
    e.statusCode = r3.status;
    e.ebayPayload = pubJson;
    if (r3.meta?.retryExhausted) e.hint = 'retry_exhausted';
    throw e;
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
  let listingIdForSentry: string | null = null;
  let workspaceIdForSentry: string | null = null;

  let serviceClient: any | null = null;
  let listingRowForFailure: any | null = null;

  const persistPublishFailed = async (params: {
    message: string;
    errorId?: string | null;
    stage?: string;
  }) => {
    try {
      if (!serviceClient || !listingRowForFailure) return;
      const ts = nowIso();
      await serviceClient
        .from('listings')
        .update({
          status: 'publish_failed',
          last_publish_attempt_at: ts,
          last_publish_error: params.message,
          last_publish_error_id: params.errorId ?? null,
          last_publish_error_at: ts,
          last_publish_error_details: params.stage ? { stage: params.stage, error: params.message } : undefined,
        })
        .eq('id', listingRowForFailure.id)
        .eq('workspace_id', listingRowForFailure.workspace_id);
    } catch (e) {
      console.error('[publish] failed to persist publish_failed', { requestId, e });
    }
  };

  if (req.method !== 'POST') {
    return respond(res, 405, { ok: false, requestId, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
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

    serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) Authenticate user
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const user = authData?.user;

    if (authErr || !user) {
      // Auth/validation errors are expected; don't treat as exceptions.
      sentryCaptureMessage('publish unauthorized', 'info', {
        operation: 'validation',
        requestId,
        listing_id: listingIdForSentry,
        workspace_id: workspaceIdForSentry,
      });
      return respond(res, 401, { ok: false, requestId, code: 'UNAUTHORIZED', message: 'Unauthorized', error: 'Unauthorized' });
    }

    // 2) Input
    const body: any = req.body || {};
    const listingId = body.listing_id || body.listingId || body.id;
    listingIdForSentry = listingId ? String(listingId) : null;
    if (!listingId) {
      sentryCaptureMessage('publish validation error', 'info', {
        operation: 'validation',
        requestId,
        listing_id: listingIdForSentry,
        workspace_id: workspaceIdForSentry,
        extras: { code: 'VALIDATION_ERROR' },
      });
      return respond(res, 400, {
        ok: false,
        requestId,
        code: 'VALIDATION_ERROR',
        message: 'Missing listing_id',
        error: 'Missing listing_id',
        errors: ['Missing listing_id'],
      });
    }

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

    if (listingErr || !listing) {
      sentryCaptureMessage('publish listing not found', 'info', {
        operation: 'validation',
        requestId,
        listing_id: listingIdForSentry,
        workspace_id: workspaceIdForSentry,
        extras: { code: 'NOT_FOUND' },
      });
      return respond(res, 404, { ok: false, requestId, code: 'NOT_FOUND', message: 'Listing not found', error: 'Listing not found' });
    }

    workspaceIdForSentry = (listing as any).workspace_id ? String((listing as any).workspace_id) : null;
 
    if ((listing as any).created_by !== user.id) {
      sentryCaptureMessage('publish forbidden', 'info', {
        operation: 'validation',
        requestId,
        listing_id: listingIdForSentry,
        workspace_id: workspaceIdForSentry,
        extras: { code: 'FORBIDDEN' },
      });
      return respond(res, 403, { ok: false, requestId, code: 'FORBIDDEN', message: 'Forbidden', error: 'Forbidden' });
    }

    listingRowForFailure = listing as any;

    if (((listing as any).marketplace || 'ebay').toLowerCase() !== 'ebay') {
      sentryCaptureMessage('publish validation error', 'info', {
        operation: 'validation',
        requestId,
        listing_id: listingIdForSentry,
        workspace_id: workspaceIdForSentry,
        extras: { code: 'VALIDATION_ERROR' },
      });
      return respond(res, 400, {
        ok: false,
        requestId,
        code: 'VALIDATION_ERROR',
        message: 'Only eBay publishing is supported currently',
        error: 'Only eBay publishing is supported currently',
        errors: ['Only eBay publishing is supported currently'],
      });
    }

    const status = String((listing as any).status || 'draft').toLowerCase();
    const existingEbayListingUrl = (listing as any).ebay_listing_url || null;
    const existingEbayItemId = (listing as any).ebay_item_id || null;

    // PRIORITY 2: Idempotency short-circuits (no eBay calls)
    if (status === 'published') {
      return respond(res, 200, {
        ok: true,
        requestId,
        message: 'Already published',
        ebay_item_id: existingEbayItemId,
        ebay_listing_url: existingEbayListingUrl,
      });
    }

    if (status === 'publishing') {
      sentryCaptureMessage('publish in progress', 'info', {
        operation: 'validation',
        requestId,
        listing_id: listingIdForSentry,
        workspace_id: workspaceIdForSentry,
        extras: { code: 'PUBLISH_IN_PROGRESS' },
      });
      return respond(res, 409, {
        ok: false,
        requestId,
        code: 'PUBLISH_IN_PROGRESS',
        message: 'Publishing in progress. Please wait and refresh.',
        errors: ['Publishing is already in progress for this listing.'],
      });
    }

    // 4) Server-side validations (must run before any eBay calls)
    const listingJson: any = (listing as any).listing_json || {};

    // Sanitize listing_json for eBay payloads (payload-only; do not persist to DB)
    const { cleaned: cleanedListingJson, removed: sanitizedRemoved } = sanitizeListingForEbay(listingJson);
    // sanitizedRemovedCount is deprecated; compute length inline where needed

    if (sanitizedRemoved.length > 0) {
      console.log('[publish] sanitized listing', {
        listing_id: (listing as any).id,
        removedCount: sanitizedRemoved.length,
      });

      // Optional debug: removed paths/reasons only (no secrets)
      console.log('[publish] sanitized removed', sanitizedRemoved);
    }

    // Use sanitized images for the actual eBay payloads.
    const rawImages =
      body?.images ??
      body?.image_urls ??
      cleanedListingJson.images ??
      cleanedListingJson.image_urls ??
      (listing as any)?.images ??
      [];

    const incomingUrls = normalizeStringArray(rawImages).filter((u) => isHttpUrl(u));
    const invalidImageUrls = normalizeStringArray(rawImages).filter((u) => !isHttpUrl(u));

    const missing: string[] = [];

    const title = String(cleanedListingJson.title ?? (listing as any).title ?? '').trim();
    const description = String(cleanedListingJson.description ?? (listing as any).description ?? '').trim();
    const categoryId = String(cleanedListingJson.category_id ?? (listing as any).category_id ?? '').trim();

    if (!title) missing.push('title');
    if (!description) missing.push('description');
    if (!categoryId) missing.push('category_id');

    const price = cleanedListingJson.price ?? (listing as any).price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) missing.push('price');

    if (!incomingUrls.length || invalidImageUrls.length) missing.push('images');

    const rawConditionId =
      cleanedListingJson.condition_id ??
      cleanedListingJson.conditionId ??
      cleanedListingJson.conditionID ??
      cleanedListingJson.ebay_condition_id ??
      '';
    const conditionIdStr = String(rawConditionId || '').trim();
    if (!conditionIdStr) missing.push('condition_id');

    const paymentPolicyId = String(
      cleanedListingJson.payment_policy_id ??
        cleanedListingJson.paymentPolicyId ??
        cleanedListingJson.ebay_payment_policy_id ??
        cleanedListingJson.ebayPaymentPolicyId ??
        (listing as any).ebay_payment_policy_id ??
        ''
    ).trim();

    const returnPolicyId = String(
      cleanedListingJson.return_policy_id ??
        cleanedListingJson.returnPolicyId ??
        cleanedListingJson.ebay_return_policy_id ??
        cleanedListingJson.ebayReturnPolicyId ??
        (listing as any).ebay_return_policy_id ??
        ''
    ).trim();

    const fulfillmentPolicyId = String(
      cleanedListingJson.fulfillment_policy_id ??
        cleanedListingJson.fulfillmentPolicyId ??
        cleanedListingJson.shippingPolicyId ??
        cleanedListingJson.ebay_fulfillment_policy_id ??
        cleanedListingJson.ebayFulfillmentPolicyId ??
        (listing as any).ebay_fulfillment_policy_id ??
        ''
    ).trim();

    if (!paymentPolicyId) missing.push('payment_policy_id');
    if (!returnPolicyId) missing.push('return_policy_id');
    if (!fulfillmentPolicyId) missing.push('fulfillment_policy_id');

    if (missing.length) {
      const msg = `Missing required fields: ${missing.join(', ')}`;

      await persistPublishFailed({
        message: msg,
        errorId: null,
        stage: 'validation',
      });

      return respond(res, 400, {
        ok: false,
        requestId,
        error: 'Missing required fields',
        missing,
      });
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
      .in('status', ['draft', 'publish_failed'])
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
          return respond(res, 200, {
            ok: true,
            message: 'Already published',
            ebay_listing_url: (curr as any).ebay_listing_url || null,
            ebay_item_id: (curr as any).ebay_item_id || null,
            requestId,
          });
        }
        if (currStatus === 'publishing') {
          return respond(res, 409, {
            ok: false,
            code: 'PUBLISH_IN_PROGRESS',
            message: 'Publishing in progress. Please wait and refresh.',
            errors: ['Publishing is already in progress for this listing.'],
            requestId,
          });
        }
      }

      // Fallback: treat as in progress (safe default)
      return respond(res, 409, {
        ok: false,
        code: 'PUBLISH_IN_PROGRESS',
        message: 'Publishing in progress. Please wait and refresh.',
        errors: ['Publishing is already in progress for this listing.'],
        requestId,
      });
    }

    // Ensure we publish with the validated/derived values (policies + hosted images)
    const listingForPublish = {
      ...(listing as any),
      title,
      description,
      category_id: categoryId,
      price,
      currency: String((listing as any).currency || 'USD'),
      // Ensure the eBay request payload sees sanitized + hosted URLs.
      images: Array.from(new Set(incomingUrls)),
      listing_json: cleanedListingJson,
      ebay_payment_policy_id: paymentPolicyId,
      ebay_return_policy_id: returnPolicyId,
      ebay_fulfillment_policy_id: fulfillmentPolicyId,
    };

    try {
      // 5) Get valid token (centralized)
      const env = String(process.env.EBAY_ENV || 'production').toLowerCase() as 'production' | 'sandbox';
      const accessToken = await getValidEbayToken(String((listing as any).workspace_id), env);

      const merchantLocationKey = String("mainWarehouse").trim();
      if (!merchantLocationKey) {
        console.error('[publish] missing merchantLocationKey', {
          listing_id: (listing as any).id,
          workspace_id: (listing as any).workspace_id,
          requestId,
        });
        await persistPublishFailed({
          message: 'Merchant location is not configured for this eBay account.',
          errorId: null,
          stage: 'validation',
        });
        return respond(res, 400, {
          ok: false,
          requestId,
          error: 'Merchant location is not configured for this eBay account.',
        });
      }

      const locationResult = await ensureMerchantLocation({
        env,
        accessToken,
        merchantLocationKey,
        requestId,
      });

      if (!locationResult?.merchantLocationKey) {
        console.error('[publish] merchant location not configured', {
          listing_id: (listing as any).id,
          workspace_id: (listing as any).workspace_id,
          requestId,
        });
        await persistPublishFailed({
          message: 'Merchant location is not configured for this eBay account.',
          errorId: null,
          stage: 'validation',
        });
        return respond(res, 400, {
          ok: false,
          requestId,
          error: 'Merchant location is not configured for this eBay account.',
        });
      }

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
          last_publish_error_id: null,
          last_publish_error_at: null,
          last_publish_error_details: null,
        })
        .eq('id', (listing as any).id)
        .eq('workspace_id', (listing as any).workspace_id);

      if (listingUpdErr) throw new Error(`listing update failed: ${listingUpdErr.message}`);

      return respond(res, 200, {
        ok: true,
        requestId,
        message: 'Published successfully',
        ebay_item_id: publishResult.ebayListingId,
        ebay_listing_url: publishResult.ebayListingUrl,
      });
    } catch (err: any) {
      // Publish-time guard failures: return 400 with user-safe message (no eBay call made)
      if (err?.code === 'PUBLISH_GUARD') {
        const field = String(err?.field || 'unknown');
        console.error('[publish] payload guard blocked eBay call', {
          requestId,
          listing_id: (listing as any).id,
          workspace_id: (listing as any).workspace_id,
          field,
        });

        // Guards are user-driven validation issues; do not send as exceptions.
        // Optional: emit an info-level breadcrumb/message in Sentry for visibility.
        sentryCaptureMessage('publish guard blocked request', 'info', {
          operation: 'validation',
          workspace_id: String((listing as any).workspace_id || ''),
          listing_id: String((listing as any).id || ''),
          tags: { field },
        extras: { requestId },
        });

        await persistPublishFailed({ message: String(err?.message || 'Publish validation failed.'), errorId: null, stage: 'validation' });

        return respond(res, 400, {
          ok: false,
          requestId,
          error: String(err?.message || 'Publish validation failed.'),
        });
      }

      const msg = String(err?.message || 'Publish failed');

      const ebayPayload = err?.ebayPayload || null;
      const ebayErrorId = extractEbayErrorId(ebayPayload);
      const ebayReqId = extractEbayRequestId(ebayPayload);
      const idForDb = ebayErrorId || ebayReqId || requestId;

      const firstMsg = ebayPayload
        ? String(ebayPayload?.errors?.[0]?.message || '').trim() ||
          String(ebayPayload?.errors?.[0]?.longMessage || '').trim() ||
          String(ebayPayload?.message || '').trim() ||
          msg
        : msg;

      const safe = ebayPayload ? `eBay rejected the listing: ${firstMsg}` : msg;
      const ts = nowIso();

      // Mark publish_failed so user can retry
      await serviceClient
        .from('listings')
        .update({
          status: 'publish_failed',
          last_publish_attempt_at: ts,
          last_publish_error: safe,
          last_publish_error_id: idForDb,
          last_publish_error_at: ts,
          last_publish_error_details: { stage: 'publish', error: safe },
        })
        .eq('id', (listing as any).id)
        .eq('workspace_id', (listing as any).workspace_id)
        .eq('status', 'publishing');

      throw err;
    }

  } catch (err: any) {
    if (err?.code === 'EBAY_INVALID_GRANT') {
      sentryCaptureException(new Error('eBay reconnect required'), {
        operation: 'publish',
        requestId,
        listing_id: listingIdForSentry,
        workspace_id: workspaceIdForSentry,
        tags: {
          operation: 'publish',
          workspace_id: workspaceIdForSentry || '',
          listing_id: listingIdForSentry || '',
        },
         extras: {
            code: 'EBAY_RECONNECT_REQUIRED',
            requestId,
          },
      });

      await persistPublishFailed({
        message: 'eBay connection expired. Please reconnect eBay.',
        errorId: requestId,
        stage: 'publish',
      });

      return respond(res, 401, {
        ok: false,
        code: 'EBAY_RECONNECT_REQUIRED',
        message: 'eBay connection expired. Please reconnect eBay.',
        error: 'eBay connection expired. Please reconnect eBay.',
        errors: [],
        requestId,
      });
    }

    if (err instanceof EbayHttpError) {
      err = Object.assign(new Error(String(err.message || 'eBay request failed')), {
        statusCode: err.statusCode,
        hint: err.hint,
      });
    }

    const msg = String(err?.message || '');
    const isEbay = msg.includes('eBay rejected') || !!err?.ebayPayload || typeof err?.statusCode === 'number';

    if (isEbay) {
      const ebayPayload = err?.ebayPayload || {};
      const ebayErrorId = extractEbayErrorId(ebayPayload);
      const firstMsg =
        String(ebayPayload?.errors?.[0]?.message || '').trim() ||
        String(ebayPayload?.errors?.[0]?.longMessage || '').trim() ||
        String(ebayPayload?.message || '').trim() ||
        String(msg || '').trim() ||
        'eBay API error';

      const safe = `eBay rejected the listing: ${firstMsg}`;
      const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : undefined;
      const httpStatus = statusCode != null && statusCode >= 400 && statusCode < 500 ? 400 : 502;

      // Log raw payload server-side only
      console.error('[publish] eBay error payload', { requestId, statusCode, ebayErrorId, ebayPayload });

      // eBay upstream error: capture exception with minimal safe context.
      sentryCaptureException(new Error('eBay publish error'), {
        operation: 'publish',
        requestId,
        listing_id: listingIdForSentry,
        workspace_id: workspaceIdForSentry,
        tags: {
          ebay_error_id: ebayErrorId || '',
          operation: 'publish',
          workspace_id: workspaceIdForSentry || '',
          listing_id: listingIdForSentry || '',
        },
        extras: {
            requestId,
            httpStatus,
            ebay_error_id: ebayErrorId || undefined,
            hint: err?.hint || undefined,
        },
      });

      await persistPublishFailed({ message: safe, errorId: ebayErrorId || requestId, stage: 'publish' });

      return respond(res, httpStatus, {
        ok: false,
        requestId,
        error: safe,
        ebayErrorId: ebayErrorId || undefined,
      });
    }

      sentryCaptureException(new Error(msg || 'Unexpected server error'), {
      operation: 'publish',
      requestId,
      listing_id: listingIdForSentry,
      workspace_id: workspaceIdForSentry,
      tags: {
        operation: 'publish',
        workspace_id: workspaceIdForSentry || '',
        listing_id: listingIdForSentry || '',
      },
      extras: {
        requestId,
      },
    });
    await persistPublishFailed({ message: msg || 'Unexpected server error.', errorId: requestId, stage: 'publish' });

    return respond(res, 500, {
      ok: false,
      requestId,
      code: 'UNEXPECTED',
      message: 'Unexpected server error.',
      error: 'Unexpected server error.',
    });
  }
}
