import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getValidEbayToken } from '../lib/ebay/ebay-token-manager.js';
import { sentryCaptureException } from '../lib/sentry.js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

function respond(res: VercelResponse, status: number, payload: any) {
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

type EbayEnv = 'production' | 'sandbox';

function normalizeEnv(v: any): EbayEnv {
  const s = String(v || 'production').trim().toLowerCase();
  return s === 'sandbox' ? 'sandbox' : 'production';
}

let cachedAppToken: { access_token: string; expires_at: number } | null = null;

async function getEbayAppToken(): Promise<string> {
  if (cachedAppToken && cachedAppToken.expires_at > Date.now()) return cachedAppToken.access_token;

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('eBay credentials not found (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)');
  }

  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const resp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${encoded}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OAuth failed: ${resp.status} ${text}`);
  }

  const data: any = await resp.json().catch(() => ({}));

  cachedAppToken = {
    access_token: String(data.access_token || ''),
    expires_at: Date.now() + Math.max(0, (Number(data.expires_in ?? 7200) - 300) * 1000),
  };

  return cachedAppToken.access_token;
}

async function fetchCategoryAspects(categoryId: string): Promise<any[]> {
  if (!categoryId) return [];

  const token = await getEbayAppToken();

  // TREE_ID=0 corresponds to EBAY_US in this codebase.
  const resp = await fetch(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${encodeURIComponent(
      categoryId
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    return [];
  }

  const data: any = await resp.json().catch(() => ({}));
  return Array.isArray(data.aspects) ? data.aspects : [];
}

function normalizeItemSpecifics(lj: any): { name: string; value: any }[] {
  const arr = lj?.item_specifics;
  if (!Array.isArray(arr)) return [];

  return arr
    .filter((s) => s && typeof s.name === 'string')
    .map((s) => ({ name: String(s.name), value: (s as any).value }));
}

function hasSpecificValue(v: any): boolean {
  if (Array.isArray(v)) return v.some((x) => String(x ?? '').trim().length > 0);
  return String(v ?? '').trim().length > 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== 'POST') {
    return respond(res, 405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      errors: [],
      message: 'Method not allowed',
      requestId,
    });
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
      return respond(res, 401, {
        ok: false,
        code: 'UNAUTHORIZED',
        errors: [],
        message: 'Unauthorized',
        requestId,
      });
    }

    // 2) Input
    const body: any = req.body || {};
    const listingId = String(body.listing_id || '').trim();

    if (!listingId) {
      return respond(res, 400, {
        ok: false,
        code: 'VALIDATION_ERROR',
        errors: ['Missing listing_id'],
        message: 'Validation failed',
        requestId,
      });
    }

    // 3) Load listing + enforce ownership
    const { data: listing, error: listingErr } = await userClient
      .from('listings')
      .select('id,workspace_id,created_by,title,description,category_id,images,price,listing_json')
      .eq('id', listingId)
      .single();

    if (listingErr || !listing) {
      return respond(res, 404, {
        ok: false,
        code: 'NOT_FOUND',
        errors: [],
        message: 'Listing not found',
        requestId,
      });
    }

    if (String((listing as any).created_by) !== String(user.id)) {
      return respond(res, 403, {
        ok: false,
        code: 'FORBIDDEN',
        errors: [],
        message: 'Forbidden',
        requestId,
      });
    }

    const workspaceId = String((listing as any).workspace_id || '').trim();
    const listingJson: any = (listing as any).listing_json || {};

    // 4) Field validations
    const errors: string[] = [];

    const title = String((listing as any).title || '').trim();
    const description = String((listing as any).description || '').trim();
    const categoryId = String((listing as any).category_id || '').trim();
    const price = (listing as any).price;

    const rawImages = Array.isArray((listing as any).images)
      ? (listing as any).images
      : Array.isArray(listingJson.images)
        ? listingJson.images
        : [];

    const images = Array.isArray(rawImages) ? rawImages.map((u) => String(u)) : [];

    if (!title) errors.push('Title is required.');
    if (!description) errors.push('Description is required.');
    if (!categoryId) errors.push('Category is required.');

    if (!images.length) errors.push('At least one image URL is required.');
    if (images.some((u) => !isHttpUrl(u))) errors.push('All image URLs must be http/https.');

    if (typeof price !== 'number' || price <= 0) errors.push('Price must be greater than 0.');

    // 5) Policy IDs in listing_json
    const paymentPolicyId = String(listingJson.payment_policy_id || '').trim();
    const returnPolicyId = String(listingJson.return_policy_id || '').trim();
    const fulfillmentPolicyId = String(listingJson.fulfillment_policy_id || '').trim();

    if (!paymentPolicyId) errors.push('payment_policy_id is required.');
    if (!returnPolicyId) errors.push('return_policy_id is required.');
    if (!fulfillmentPolicyId) errors.push('fulfillment_policy_id is required.');

    if (errors.length) {
      return respond(res, 400, {
        ok: false,
        code: 'VALIDATION_ERROR',
        errors,
        message: 'Validation failed',
        requestId,
      });
    }

    // 6) Validate eBay connection
    const env = normalizeEnv(process.env.EBAY_ENV || 'production');

    const { data: conn, error: connErr } = await serviceClient
      .from('marketplace_connections')
      .select('id,refresh_token')
      .eq('workspace_id', workspaceId)
      .eq('marketplace', 'ebay')
      .eq('environment', env)
      .maybeSingle();

    if (connErr || !conn?.id || !conn?.refresh_token) {
      return respond(res, 401, {
        ok: false,
        code: 'NOT_CONNECTED',
        errors: [],
        message: 'eBay not connected. Please reconnect eBay.',
        requestId,
      });
    }

    try {
      await getValidEbayToken(workspaceId, env);
    } catch (e: any) {
      if (e?.code === 'EBAY_INVALID_GRANT') {
        return respond(res, 401, {
          ok: false,
          code: 'NOT_CONNECTED',
          errors: [],
          message: 'eBay connection expired. Please reconnect eBay.',
          requestId,
        });
      }

      if (e?.code === 'EBAY_NOT_CONNECTED' || e?.code === 'EBAY_NO_REFRESH_TOKEN') {
        return respond(res, 401, {
          ok: false,
          code: 'NOT_CONNECTED',
          errors: [],
          message: 'eBay not connected. Please reconnect eBay.',
          requestId,
        });
      }

      throw e;
    }

    // 7) Validate required taxonomy aspects
    const aspects = await fetchCategoryAspects(categoryId);

    const specifics = normalizeItemSpecifics(listingJson);
    const specificsMap = new Map<string, any>();
    for (const s of specifics) specificsMap.set(String(s.name || '').trim().toLowerCase(), s.value);

    const preflightErrors: string[] = [];

    for (const a of aspects) {
      const constraint = a?.aspectConstraint ?? {};
      const required = Boolean(constraint.aspectRequired);
      if (!required) continue;

      const name = String(a?.localizedAspectName || '').trim();
      if (!name) continue;

      const v = specificsMap.get(name.toLowerCase());
      if (!hasSpecificValue(v)) {
        preflightErrors.push(`${name} is required.`);
      }
    }

    // 8) Validate required item location env vars
    const country = String(process.env.EBAY_ITEM_COUNTRY || '').trim();
    const postalCode = String(process.env.EBAY_ITEM_POSTAL_CODE || '').trim();

    if (!country) preflightErrors.push('Missing env var: EBAY_ITEM_COUNTRY');
    if (!postalCode) preflightErrors.push('Missing env var: EBAY_ITEM_POSTAL_CODE');

    if (preflightErrors.length) {
      return respond(res, 422, {
        ok: false,
        code: 'PREFLIGHT_FAILED',
        errors: preflightErrors,
        message: 'Preflight validation failed',
        requestId,
      });
    }

    return respond(res, 200, {
      ok: true,
      code: 'OK',
      errors: [],
      message: 'Preflight OK',
      requestId,
    });
  } catch (err: any) {
    sentryCaptureException(err, {
      operation: 'ebay_preflight',
      requestId,
      extras: { message: String(err?.message || ''), status: 500 },
    });

    return respond(res, 500, {
      ok: false,
      code: 'UNEXPECTED',
      errors: [],
      message: 'Unexpected server error.',
      requestId,
    });
  }
}
