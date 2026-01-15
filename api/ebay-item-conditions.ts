import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getValidEbayToken } from '../lib/ebay/ebay-token-manager.js';
import { sentryCaptureException } from '../lib/sentry.js';

export const config = {
  api: { bodyParser: { sizeLimit: '512kb' } },
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

function pickEbayApiBase(env: string) {
  const e = String(env || 'production').toLowerCase();
  return e === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL');
    const SUPABASE_ANON_KEY = getEnv('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const authHeader = req.headers.authorization || '';

    const userClient: any = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
      auth: { persistSession: false },
    });

    const admin: any = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Auth user
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    const body: any = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const rawCategoryId =
      String(body.category_id || body.categoryId || '').trim() || String((req.query as any)?.category_id || '').trim();

    if (!rawCategoryId) {
      return res.status(400).json({ error: 'category_id is required', requestId });
    }

    if (!/^\d+$/.test(rawCategoryId)) {
      return res.status(400).json({ error: 'category_id must be digits', requestId });
    }

    const categoryId = rawCategoryId;

    // Resolve workspace_id using conservative lookup (same pattern used in other endpoints).
    const u = await admin
      .from('users')
      .select('workspace_id')
      .eq('auth_provider_user_id', user.id)
      .maybeSingle();

    if (u.error) {
      return res.status(500).json({ error: 'Failed to resolve user workspace', requestId });
    }

    const workspaceId = String(u.data?.workspace_id || '').trim();
    if (!workspaceId) {
      return res.status(403).json({ error: 'Forbidden', requestId });
    }

    const env = String(process.env.EBAY_ENV || 'production').toLowerCase() as 'production' | 'sandbox';
    const marketplaceId = String(process.env.EBAY_MARKETPLACE_ID || 'EBAY_US');

    const accessToken = await getValidEbayToken(workspaceId, env);

    const base = pickEbayApiBase(env);
    const url = `${base}/sell/metadata/v1/marketplace/${encodeURIComponent(
      marketplaceId
    )}/get_item_condition_policies?category_ids=${encodeURIComponent(categoryId)}`;

    const ebayRes = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const text = await ebayRes.text().catch(() => '');
    const data: any = text ? JSON.parse(text) : {};

    if (!ebayRes.ok) {
      const firstErr = Array.isArray(data?.errors) ? data.errors[0] : null;
      const errorId = firstErr?.errorId != null ? String(firstErr.errorId) : undefined;

      console.error('[ebay-item-conditions] eBay error', {
        requestId,
        categoryId,
        status: ebayRes.status,
        errorId,
        body: String(text || '').slice(0, 300),
      });

      sentryCaptureException(new Error('eBay condition policies failed'), {
        operation: 'ebay_item_conditions',
        requestId,
        extras: {
          status: ebayRes.status,
          errorId,
        },
      });

      return res.status(500).json({
        error: 'Failed to fetch eBay conditions',
        ...(errorId ? { errorId } : {}),
        requestId,
      });
    }

    const policies = Array.isArray(data?.itemConditionPolicies) ? data.itemConditionPolicies : [];
    const firstPolicy = policies[0] || null;
    const conditionPolicies = Array.isArray(firstPolicy?.conditionPolicies) ? firstPolicy.conditionPolicies : [];

    const conditions = conditionPolicies
      .map((p: any) => ({
        conditionId: Number(p?.condition?.conditionId ?? NaN),
        conditionName: String(p?.condition?.conditionName ?? '').trim(),
      }))
      .filter((c: any) => Number.isFinite(c.conditionId) && c.conditionId > 0 && c.conditionName);

    if (!conditions.length && String(text || '').trim()) {
      console.error('[ebay-item-conditions] unexpected response shape', {
        requestId,
        categoryId,
        status: ebayRes.status,
        body: String(text || '').slice(0, 300),
      });
    }

    return res.status(200).json({
      conditions,
      rawCategoryId: categoryId,
      marketplaceId,
    });
  } catch (err: any) {
    sentryCaptureException(err, {
      operation: 'ebay_item_conditions',
      requestId,
      extras: { message: String(err?.message || ''), status: 500 },
    });

    return res.status(500).json({ error: 'Internal server error', requestId });
  }
}
