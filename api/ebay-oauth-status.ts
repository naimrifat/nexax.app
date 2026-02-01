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

function readBearerToken(req: VercelRequest): string {
  const raw = String(req.headers.authorization || '')
  const m = raw.match(/^Bearer\s+(.+)$/i)
  return m ? String(m[1] || '').trim() : ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = readBearerToken(req)
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const workspaceId = pickFirstQueryValue(req.query.workspace_id as any).trim()
  if (!workspaceId) return res.status(400).json({ error: 'Missing workspace_id' })

  try {
    const supabase = createClient(mustEnv('SUPABASE_URL'), mustEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    })

    const { data: authData, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { data: row, error } = await supabase
      .from('marketplace_connections')
      .select('access_token,refresh_token,expires_at')
      .eq('workspace_id', workspaceId)
      .eq('marketplace', 'ebay')
      .eq('environment', 'production')
      .maybeSingle<any>()

    if (error) {
      return res.status(500).json({ error: error.message || 'Failed to query marketplace_connections' })
    }

    const accessToken = row?.access_token
    const refreshToken = row?.refresh_token
    const expiresAt = row?.expires_at

    const has_refresh_token = !!String(refreshToken || '').trim()
    const connected =
      !!row &&
      !!String(accessToken || '').trim() &&
      !!String(refreshToken || '').trim() &&
      !!String(expiresAt || '').trim()

    return res.status(200).json({
      ok: true,
      connected,
      expires_at: expiresAt ?? null,
      has_refresh_token,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
