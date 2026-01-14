// api/ebay-oauth-status.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { sentryCaptureException } from "./_lib/sentry.js";


function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function getAuthedUser(accessToken: string) {
  const supabase = createClient(mustEnv('SUPABASE_URL'), mustEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error('Unauthorized');
  return data.user;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', requestId });

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized', requestId });

    const user = await getAuthedUser(token);

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const workspaceId = String(body.workspace_id || '').trim();
    if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required', requestId });

    const admin = createClient(mustEnv('SUPABASE_URL'), mustEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });

    const env = (process.env.EBAY_ENV || 'production').toLowerCase();

    // IMPORTANT CHANGE:
    // We select refresh_token and access_token, because "connected" should be based on refresh_token.
    const { data, error } = await admin
      .from('marketplace_connections')
      .select('id,updated_at,expires_at,refresh_token,access_token')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('marketplace', 'ebay')
      .eq('environment', env)
      .maybeSingle();

    if (error) throw error;

    // accessExpired is informational only; it MUST NOT drive "connected"
    const accessExpired = data?.expires_at ? new Date(data.expires_at).getTime() <= Date.now() : true;

    // Correct "connected" meaning for "connect once":
    // If we have a refresh token, we can always refresh access silently.
    const connected = !!data?.id && !!data?.refresh_token;

    // Optional: tell UI that a refresh will be needed soon (useful for debugging; not user-facing).
    const needsRefresh = connected && accessExpired;

    return res.status(200).json({
      connected,
      needsRefresh, // informational; you can ignore in UI
      accessExpired, // informational; you should NOT show "not connected" because of this
      updatedAt: data?.updated_at || null,
      requestId,
    });
  } catch (err: any) {
    sentryCaptureException(err, {
      operation: 'ebay_oauth_status',
      requestId,
      extras: { message: String(err?.message || ''), status: 500 },
    });
    console.error('[ebay-oauth-status] error', { requestId, err });
    return res.status(500).json({ error: 'Internal server error', details: err?.message, requestId });
  }

}
