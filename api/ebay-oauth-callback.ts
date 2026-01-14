// api/ebay-oauth-callback.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { sentryCaptureException } from "./_lib/sentry.js";


function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function b64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToString(input: string) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

function signState(payloadJson: string, secret: string) {
  return b64url(crypto.createHmac('sha256', secret).update(payloadJson).digest());
}

async function exchangeCodeForTokens(args: { env: string; clientId: string; clientSecret: string; runame: string; code: string }) {
  const tokenUrl =
    args.env === 'sandbox'
      ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
      : 'https://api.ebay.com/identity/v1/oauth2/token';

  const basic = Buffer.from(`${args.clientId}:${args.clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.runame, // RuName
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body,
  });

  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    const msg = json?.error_description || json?.error || text || 'Token exchange failed';
    throw new Error(`eBay token exchange failed: ${msg}`);
  }

  return json as {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    refresh_token_expires_in: number;
    token_type: string;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).send('Method not allowed');

    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    if (!code) return res.status(400).send('Missing code');
    if (!state) return res.status(400).send('Missing state');

    const STATE_SECRET = mustEnv('EBAY_OAUTH_STATE_SECRET');

    const [payloadB64, sig] = state.split('.');
    if (!payloadB64 || !sig) return res.status(400).send('Invalid state');

    const payloadJson = b64urlToString(payloadB64);
    const expectedSig = signState(payloadJson, STATE_SECRET);

    // Signature verify
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return res.status(400).send('Invalid state signature');
    }

    const payload = JSON.parse(payloadJson) as {
      v: number;
      ts: number;
      nonce: string;
      a: string;  // user_id (auth uid)
      w: string;  // workspace_id
      r: string;  // return_to
      env: string;
    };

    // 10 min window
    if (!payload.ts || Date.now() - payload.ts > 10 * 60 * 1000) {
      return res.status(400).send('State expired; please try again');
    }

    const EBAY_ENV = String(payload.env || process.env.EBAY_ENV || 'production').toLowerCase();
    const CLIENT_ID = mustEnv('EBAY_CLIENT_ID');
    const CLIENT_SECRET = mustEnv('EBAY_CLIENT_SECRET');
    const RUNAME = mustEnv('EBAY_REDIRECT_URI');
    const SCOPES_STR = mustEnv('EBAY_OAUTH_SCOPES');

    const tokens = await exchangeCodeForTokens({
      env: EBAY_ENV,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      runame: RUNAME,
      code,
    });

    const now = Date.now();
    const accessExpiresAt = new Date(now + (Number(tokens.expires_in) || 0) * 1000).toISOString();

    const scopes = SCOPES_STR.split(' ').map((s) => s.trim()).filter(Boolean);

    // Service role for DB write
    const admin = createClient(mustEnv('SUPABASE_URL'), mustEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });

    const upsertPayload = {
      workspace_id: payload.w,
      user_id: payload.a,
      marketplace: 'ebay',
      environment: EBAY_ENV,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: accessExpiresAt,
      scopes,
      updated_at: new Date().toISOString(),
    };

    const { error } = await admin
      .from('marketplace_connections')
      .upsert(upsertPayload, { onConflict: 'workspace_id,user_id,marketplace,environment' });

    if (error) throw error;

    res.status(302).setHeader('Location', payload.r || '/settings?ebay=connected');
    return res.end();
  } catch (err: any) {
    sentryCaptureException(err, {
      operation: 'ebay_oauth_callback',
      workspace_id: String((req.query as any)?.w || '' || ''),
      extras: { message: String(err?.message || ''), status: 302 },
    });
    const msg = encodeURIComponent(err?.message || 'OAuth failed');
    res.status(302).setHeader('Location', `/settings?ebay=error&message=${msg}`);
    return res.end();
  }

}
