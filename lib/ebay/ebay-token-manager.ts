// lib/ebay-token-manager.ts
import { createClient } from '@supabase/supabase-js';
import { sentryCaptureException } from '../sentry.js';


type EbayEnv = 'production' | 'sandbox';

type MarketplaceConnection = {
  id: string;
  workspace_id: string;
  marketplace: string;
  environment: EbayEnv;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(
    mustEnv('SUPABASE_URL'),
    mustEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );
}

function tokenHost(env: EbayEnv) {
  return env === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';
}

function isExpiredSoon(expiresAt: string | null, skewSec = 90): boolean {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) <= Date.now() + skewSec * 1000;
}

function computeExpiresAt(expiresIn: number) {
  return new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();
}

async function refreshToken(params: {
  env: EbayEnv;
  refreshToken: string;
  connectionId?: string;
}) {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', params.refreshToken);
  body.set('scope', mustEnv('EBAY_OAUTH_SCOPES'));

  let res: Response;
  try {
    res = await fetch(`${tokenHost(params.env)}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(`${mustEnv('EBAY_CLIENT_ID')}:${mustEnv('EBAY_CLIENT_SECRET')}`).toString('base64'),
      },
      body,
    });
  } catch (e: any) {
    // Network errors only (no tokens)
    sentryCaptureException(e, {
      operation: 'token_refresh',
      tags: { operation: 'token_refresh' },
      extras: { error_type: 'network' },
    });
    throw e;
  }


  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = json?.error || 'refresh_failed';
    const desc = json?.error_description || 'Unknown refresh error';

    const httpStatus = res.status;
    const errorType = err === 'invalid_grant' ? 'invalid_grant' : 'unexpected_response';

    // Capture refresh failure (no tokens)
    // Note: workspace_id is added at the callsite where workspace context exists.
    sentryCaptureException(new Error('eBay token refresh failed'), {
      operation: 'token_refresh',
      tags: { operation: 'token_refresh' },
      extras: { httpStatus, error_type: errorType },
    });


    if (err === 'invalid_grant') {
      if (params.connectionId) {
        try {
          const admin = adminClient();
          await admin
            .from('marketplace_connections')
            .update({ access_token: null, refresh_token: null, expires_at: null })
            .eq('id', params.connectionId);
        } catch (e: any) {
          console.error('[ebay-token-manager] failed to mark connection disconnected', {
            connectionId: params.connectionId,
            message: String(e?.message || ''),
          });
        }
      }

      throw Object.assign(new Error('Please reconnect eBay'), {
        code: 'EBAY_INVALID_GRANT',
        statusCode: 401,
      });
    }

    throw Object.assign(new Error(`eBay token refresh failed: ${desc}`), {
      code: 'EBAY_REFRESH_FAILED',
      statusCode: 502,
      details: json,
    });
  }

  return json as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
}

/**
 * PUBLIC API
 */
export async function getValidEbayToken(
  workspaceId: string,
  env: EbayEnv = "production"
): Promise<string> {
  const admin = adminClient();

  const { data, error } = await admin
    .from("marketplace_connections")
    .select("id,workspace_id,marketplace,environment,access_token,refresh_token,expires_at")
    .eq("workspace_id", workspaceId)
    .eq("marketplace", "ebay")
    .eq("environment", env)
    .maybeSingle<MarketplaceConnection>();

  if (error) throw error;

  if (!data) {
    throw Object.assign(new Error("eBay is not connected for this workspace"), {
      code: "EBAY_NOT_CONNECTED",
      statusCode: 400,
    });
  }

  if (!data.refresh_token) {
    throw Object.assign(new Error("Missing eBay refresh token. Please reconnect eBay."), {
      code: "EBAY_NO_REFRESH_TOKEN",
      statusCode: 400,
    });
  }

  // fast path
  if (data.access_token && !isExpiredSoon(data.expires_at, 90)) {
    return data.access_token;
  }

  // lock attempt (optional)
  let lockHeld = false;

  try {
    const { data: lockOk, error: lockErr } = await admin.rpc("acquire_ebay_refresh_lock", {
      p_workspace_id: workspaceId,
    });

    if (!lockErr && lockOk === true) {
      lockHeld = true;
    } else if (!lockErr && lockOk !== true) {
      throw Object.assign(new Error("eBay token refresh in progress. Please retry."), {
        code: "EBAY_REFRESH_LOCK_BUSY",
        statusCode: 429,
      });
    } else if (lockErr) {
      // RPC missing or permissions; proceed without lock
      console.warn("[ebay-token-manager] lock RPC unavailable", { message: lockErr.message });
    }
  } catch (e: any) {
    if (e?.code === "EBAY_REFRESH_LOCK_BUSY") throw e;
    // otherwise ignore and proceed without lock
  }

  try {
    // re-read in case another request refreshed
    const { data: latest, error: latestErr } = await admin
      .from("marketplace_connections")
      .select("id,access_token,refresh_token,expires_at")
      .eq("id", data.id)
      .maybeSingle();

    if (latestErr) throw latestErr;

    if (latest?.access_token && !isExpiredSoon(latest.expires_at, 90)) {
      return String(latest.access_token);
    }

    const refreshTok = String(latest?.refresh_token || data.refresh_token || "");
    if (!refreshTok) {
      throw Object.assign(new Error("Missing eBay refresh token. Please reconnect eBay."), {
        code: "EBAY_NO_REFRESH_TOKEN",
        statusCode: 400,
      });
    }

    let refreshed: { access_token: string; expires_in: number; refresh_token?: string };
    try {
      refreshed = await refreshToken({ env, refreshToken: refreshTok, connectionId: data.id });
    } catch (e: any) {
      // Add workspace context at callsite (no tokens)
      sentryCaptureException(e, {
        operation: 'token_refresh',
        workspace_id: workspaceId,
        tags: { operation: 'token_refresh', workspace_id: workspaceId },
        extras: { error_type: String(e?.code || 'refresh_failed') },
      });
      throw e;
    }

    if (!refreshed?.access_token) {
      const e: any = new Error('eBay token refresh failed: unexpected response');
      e.code = 'EBAY_REFRESH_FAILED';
      e.statusCode = 502;
      sentryCaptureException(e, {
        operation: 'token_refresh',
        workspace_id: workspaceId,
        tags: { operation: 'token_refresh', workspace_id: workspaceId },
        extras: { error_type: 'unexpected_response' },
      });
      throw e;
    }


    const update: any = {
      access_token: refreshed.access_token,
      expires_at: computeExpiresAt(refreshed.expires_in),
    };
    if (refreshed.refresh_token) update.refresh_token = refreshed.refresh_token;

    const { error: upErr } = await admin.from("marketplace_connections").update(update).eq("id", data.id);
    if (upErr) {
      console.error("[ebay-token-manager] DB update failed", {
        workspaceId,
        connectionId: data.id,
        error: upErr.message,
      });

      sentryCaptureException(upErr, {
        operation: 'token_refresh',
        workspace_id: workspaceId,
        tags: { operation: 'token_refresh', workspace_id: workspaceId },
        extras: { error_type: 'db_persist' },
      });
    }


    return refreshed.access_token;
  } finally {
    if (lockHeld) {
      try {
        await admin.rpc("release_ebay_refresh_lock", { p_workspace_id: workspaceId });
      } catch {
        // ignore unlock failure
      }
    }
  }
}
