import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function mustEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function pickFirstQueryValue(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return String(v[0] ?? '')
  return String(v ?? '')
}

function base64urlToUtf8(input: string): string {
  const s = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s + pad, 'base64').toString('utf8')
}

function decodeState(state: string): { workspace_id: string; user_id: string } {
  const raw = base64urlToUtf8(state)
  const obj: any = JSON.parse(raw)
  const workspaceId = String(obj?.workspace_id || '').trim()
  const userId = String(obj?.user_id || '').trim()
  if (!workspaceId || !userId) throw new Error('Invalid state')
  return { workspace_id: workspaceId, user_id: userId }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.end('Method not allowed')
  }

  const code = pickFirstQueryValue(req.query.code as any).trim()
  const state = pickFirstQueryValue(req.query.state as any).trim()
  const oauthError = pickFirstQueryValue(req.query.error as any).trim()
  const oauthErrorDescription = pickFirstQueryValue(req.query.error_description as any).trim()

  if (oauthError) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.end(`OAuth error: ${oauthError} - ${oauthErrorDescription}`)
  }

  if (!code) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.end('Missing code. Query: ' + JSON.stringify(req.query))
  }
  if (!state) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.end('Missing state')
  }

  let workspace_id = ''
  let user_id = ''

  try {
    const decoded = decodeState(state)
    workspace_id = decoded.workspace_id
    user_id = decoded.user_id
  } catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.end('Invalid state')
  }

  try {
    const clientId = mustEnv('EBAY_CLIENT_ID')
    const clientSecret = mustEnv('EBAY_CLIENT_SECRET')
    const redirectUri = mustEnv('EBAY_REDIRECT_URI')

    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const body = new URLSearchParams()
    body.set('grant_type', 'authorization_code')
    body.set('code', code)
    body.set('redirect_uri', redirectUri)

    const tokenResp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${encoded}`,
      },
      body,
    })

    const tokenJson: any = await tokenResp.json().catch(() => ({}))
    if (!tokenResp.ok) {
      res.statusCode = 302
      res.setHeader('Location', '/dashboard?ebay=error')
      return res.end()
    }

    const access_token = String(tokenJson?.access_token || '')
    const refresh_token = String(tokenJson?.refresh_token || '')
    const expires_in = Number(tokenJson?.expires_in || 0)
    const scopeStr = String(tokenJson?.scope || '')

    const expiresAtMs = Date.now() + Math.max(0, expires_in - 60) * 1000
    const expires_at = new Date(expiresAtMs).toISOString()
    const scopes = scopeStr.split(' ').map((s) => s.trim()).filter(Boolean)

    const SUPABASE_URL = mustEnv('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = mustEnv('SUPABASE_SERVICE_ROLE_KEY')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    // Prefer a conservative select->update/insert to avoid depending on unique indexes.
    const existing = await supabase
      .from('marketplace_connections')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('user_id', user_id)
      .eq('marketplace', 'ebay')
      .eq('environment', 'production')
      .limit(1)
      .maybeSingle()

    if (existing.error) {
      res.statusCode = 302
      res.setHeader('Location', '/dashboard?ebay=error')
      return res.end()
    }

    const row: any = {
      workspace_id,
      user_id,
      marketplace: 'ebay',
      environment: 'production',
      access_token: access_token || null,
      refresh_token: refresh_token || null,
      expires_at,
      scopes,
    }

    if (existing.data?.id) {
      const up = await supabase.from('marketplace_connections').update(row).eq('id', existing.data.id)
      if (up.error) {
        res.statusCode = 302
        res.setHeader('Location', '/dashboard?ebay=error')
        return res.end()
      }
    } else {
      const ins = await supabase.from('marketplace_connections').insert(row)
      if (ins.error) {
        res.statusCode = 302
        res.setHeader('Location', '/dashboard?ebay=error')
        return res.end()
      }
    }

    res.statusCode = 302
    res.setHeader('Location', '/dashboard?ebay=connected')
    return res.end()
  } catch {
    res.statusCode = 302
    res.setHeader('Location', '/dashboard?ebay=error')
    return res.end()
  }
}
