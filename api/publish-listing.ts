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
       IMPORTANT: include policy/package columns because validation needs them
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

          // Shipping & Policies columns (per listing)
          'ebay_payment_policy_id',
          'ebay_return_policy_id',
          // This is "Shipping policy" in UI, called "Fulfillment policy" in eBay Account API
          'ebay_fulfillment_policy_id',

          // Optional package fields
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

    // Keep this explicit guard even if RLS exists — clearer error and safer.
    if ((listing as any).created_by !== user.id) {
      return res.status(403).json({ error: 'Forbidden', requestId });
    }

    // Only eBay flow for now.
    if (((listing as any).marketplace || 'ebay').toLowerCase() !== 'ebay') {
      return res.status(400).json({ error: 'Only eBay publishing is supported currently', requestId });
    }

    if ((listing as any).status === 'published') {
      return res.status(400).json({ error: 'Listing already published', requestId });
    }

    /* -------------------------------------------------------
       4) Shipping & Policies validation (UPDATED to match your UX)
       REQUIRED: policy IDs only
       OPTIONAL: weight/dimensions/irregular
    ------------------------------------------------------- */
    const paymentId = String((listing as any).ebay_payment_policy_id || '').trim();
    const returnId = String((listing as any).ebay_return_policy_id || '').trim();
    const shippingPolicyId = String((listing as any).ebay_fulfillment_policy_id || '').trim(); // UI name: Shipping policy

    const missingPolicies: string[] = [];
    if (!shippingPolicyId) missingPolicies.push('Shipping policy');
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

    /* -------------------------------------------------------
       5) Image + listing validation (KEEPING YOUR LOGIC)
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

    const nowIso = new Date().toISOString();

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
       6) Verify eBay connection exists for THIS user/workspace/env
    ------------------------------------------------------- */
    const env = String(process.env.EBAY_ENV || 'production').toLowerCase();

    const { data: connection, error: connErr } = await serviceClient
      .from('marketplace_connections')
      .select('id, expires_at, refresh_token')
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

    // Worker will refresh if needed, but if expired and no refresh_token, block.
    const accessExpired = connection.expires_at ? new Date(connection.expires_at).getTime() <= Date.now() : true;
    if (accessExpired && !connection.refresh_token) {
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso,
          last_publish_error: 'eBay token expired',
          last_publish_error_details: { stage: 'connection', env, accessExpired: true, hasRefreshToken: false },
        })
        .eq('id', (listing as any).id);

      return res.status(400).json({
        error: 'eBay connection expired. Please reconnect eBay in Settings.',
        requestId,
      });
    }

    /* -------------------------------------------------------
       7) Enqueue publish job
          Guard against duplicate queued jobs for same listing.
    ------------------------------------------------------- */
    const { data: existingJob, error: existingErr } = await serviceClient
      .from('listing_jobs')
      .select('id,status')
      .eq('listing_id', (listing as any).id)
      .eq('job_type', 'publish')
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingErr) {
      console.error('[publish-listing] existing job lookup failed', { requestId, existingErr });
      return res.status(500).json({ error: 'Failed to check existing publish job', requestId });
    }

    if (existingJob?.id) {
      // Already queued/running; don't create another.
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso,
          last_publish_error: null,
          last_publish_error_details: null,
        })
        .eq('id', (listing as any).id);

      return res.status(200).json({
        success: true,
        requestId,
        jobId: existingJob.id,
        alreadyQueued: true,
      });
    }

    const { data: job, error: jobErr } = await serviceClient
      .from('listing_jobs')
      .insert({
        listing_id: (listing as any).id,
        workspace_id: (listing as any).workspace_id,
        user_id: user.id,
        job_type: 'publish',
        status: 'queued',
      })
      .select('id')
      .single();

    if (jobErr || !job) {
      console.error('[publish-listing] job insert failed', { requestId, jobErr });
      return res.status(500).json({
        error: 'Failed to create publish job',
        requestId,
        details: jobErr?.message,
      });
    }

    await serviceClient
      .from('listings')
      .update({
        last_publish_attempt_at: nowIso,
        last_publish_error: null,
        last_publish_error_details: null,
      })
      .eq('id', (listing as any).id);

    return res.status(200).json({
      success: true,
      requestId,
      jobId: job.id,
      env,
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
