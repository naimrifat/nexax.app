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
       1. Authenticate user
    ------------------------------------------------------- */
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    /* -------------------------------------------------------
       2. Input
    ------------------------------------------------------- */
    const body: any = req.body || {};
    const listingId = body.listing_id || body.listingId || body.id;

    if (!listingId) {
      return res.status(400).json({ error: 'Missing listing_id', requestId });
    }

    /* -------------------------------------------------------
       3. Load listing (ownership enforced)
    ------------------------------------------------------- */
    const { data: listing, error: listingErr } = await userClient
      .from('listings')
      .select(
        'id, workspace_id, created_by, status, marketplace, title, description, category_id, images, price'
      )
      .eq('id', listingId)
      .single();

    if (listingErr || !listing) {
      return res.status(404).json({ error: 'Listing not found', requestId });
    }

    if (listing.created_by !== user.id) {
      return res.status(403).json({ error: 'Forbidden', requestId });
    }

    if (listing.status === 'published') {
      return res.status(400).json({ error: 'Listing already published', requestId });
    }

    /* -------------------------------------------------------
       4. Image validation (KEEPING YOUR LOGIC)
    ------------------------------------------------------- */
    const rawImages =
      body?.images ??
      body?.image_urls ??
      listing?.images ??
      [];

    const incomingUrls = normalizeStringArray(rawImages);

    const blobOrObjectUrls = incomingUrls.filter(isBlobOrObjectUrl);
    const nonHttpUrls = incomingUrls.filter(
      (u) => !isBlobOrObjectUrl(u) && !isHttpUrl(u)
    );
    const imageUrls = incomingUrls.filter(
      (u) => !isBlobOrObjectUrl(u) && isHttpUrl(u)
    );

    const errors: string[] = [];

    if (!listing.title?.trim()) errors.push('Title is required.');
    if (!listing.description?.trim()) errors.push('Description is required.');
    if (!listing.category_id) errors.push('Category is required.');
    if (!imageUrls.length) errors.push('At least one hosted image URL is required.');
    if (typeof listing.price !== 'number' || listing.price <= 0)
      errors.push('Price must be greater than 0.');

    if (blobOrObjectUrls.length) {
      errors.push('Blob/data/file image URLs are not allowed.');
    }

    if (nonHttpUrls.length) {
      errors.push('Image URLs must be http/https.');
    }

    const nowIso = new Date().toISOString();

    if (errors.length) {
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso,
          last_publish_error: 'Validation failed',
          last_publish_error_details: {
            stage: 'validation',
            errors,
          },
        })
        .eq('id', listing.id);

      return res.status(400).json({
        error: 'Validation failed',
        requestId,
        details: errors,
      });
    }

    /* -------------------------------------------------------
       5. Verify eBay connection exists
    ------------------------------------------------------- */
    const { data: connection } = await serviceClient
      .from('marketplace_connections')
      .select('id')
      .eq('workspace_id', listing.workspace_id)
      .eq('marketplace', 'ebay')
      .eq('environment', 'production')
      .is('user_id', null)
      .maybeSingle();

    if (!connection) {
      await serviceClient
        .from('listings')
        .update({
          last_publish_attempt_at: nowIso,
          last_publish_error: 'No eBay connection found',
          last_publish_error_details: { stage: 'connection' },
        })
        .eq('id', listing.id);

      return res.status(400).json({
        error: 'No eBay account connected. Connect eBay in Settings.',
        requestId,
      });
    }

    /* -------------------------------------------------------
       6. Enqueue publish job
    ------------------------------------------------------- */
    const { data: job, error: jobErr } = await serviceClient
      .from('listing_jobs')
      .insert({
        listing_id: listing.id,
        workspace_id: listing.workspace_id,
        user_id: user.id,
        job_type: 'publish',
        status: 'queued',
      })
      .select('id')
      .single();

    if (jobErr || !job) {
      return res.status(500).json({
        error: 'Failed to create publish job',
        requestId,
      });
    }

    await serviceClient
      .from('listings')
      .update({
        last_publish_attempt_at: nowIso,
        last_publish_error: null,
        last_publish_error_details: null,
      })
      .eq('id', listing.id);

    return res.status(200).json({
      success: true,
      requestId,
      jobId: job.id,
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
