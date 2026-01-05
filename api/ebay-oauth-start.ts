// api/ebay-oauth-start.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function b64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signState(payloadJson: string, secret: string) {
  return b64url(crypto.createHmac('sha256', secret).update(payloadJson).digest());
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
    const returnTo = String(body.return_to || '/settings?ebay=connected').trim();

    if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required', requestId });

    const EBAY_ENV = (process.env.EBAY_ENV || 'production').toLowerCase();
    const CLIENT_ID = mustEnv('EBAY_CLIENT_ID');
    const RUNAME = mustEnv('EBAY_REDIRECT_URI'); // RuName (not URL)
    const SCOPES = mustEnv('EBAY_OAUTH_SCOPES');
    const STATE_SECRET = mustEnv('EBAY_OAUTH_STATE_SECRET');

    const authBase =
      EBAY_ENV === 'sandbox'
        ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
        : 'https://auth.ebay.com/oauth2/authorize';

    const statePayload = {
      v: 1,
      ts: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
      a: user.id,         // auth.uid()
      w: workspaceId,     // workspace_id
      r: returnTo,        // redirect after callback
      env: EBAY_ENV,
    };

    const payloadJson = JSON.stringify(statePayload);
    const sig = signState(payloadJson, STATE_SECRET);
    const state = `${b64url(payloadJson)}.${sig}`;

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: RUNAME, // RuName
      response_type: 'code',
      scope: SCOPES,
      state,
    });

    return res.status(200).json({ url: `${authBase}?${params.toString()}`, requestId });
  } catch (err: any) {
    console.error('[ebay-oauth-start] error', { requestId, err });
    return res.status(500).json({ error: 'Internal server error', details: err?.message, requestId });
  }
}
