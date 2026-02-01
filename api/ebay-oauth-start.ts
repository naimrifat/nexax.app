import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function getEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function pickFirstQueryValue(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return String(v[0] ?? '')
  return String(v ?? '')
}

function base64urlJson(obj: any): string {
  const b64 = Buffer.from(JSON.stringify(obj)).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function readBearerToken(req: VercelRequest): string {
  const raw = String(req.headers.authorization || '')
  const m = raw.match(/^Bearer\s+(.+)$/i)
  return m ? String(m[1] || '').trim() : ''
}

export const config = {
  api: { bodyParser: true },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body: any = req.body || {}
  const workspaceId = String(body.workspace_id || '').trim()
  const returnTo = String(body.return_to || '').trim()
  if (!workspaceId) {
    return res.status(400).json({ error: 'Missing workspace_id' })
  }
  if (!returnTo) {
    return res.status(400).json({ error: 'Missing return_to' })
  }

  const token = readBearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const SUPABASE_URL = getEnv('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const userId = String(data.user.id || '').trim()
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const state = base64urlJson({ workspace_id: workspaceId, user_id: userId, return_to: returnTo, nonce })

    const clientId = getEnv('EBAY_CLIENT_ID')
    const redirectUri = getEnv('EBAY_REDIRECT_URI')

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'sell.inventory sell.account sell.fulfillment',
      state,
    })

    const authUrl = `https://auth.ebay.com/oauth2/authorize?${params.toString()}`

    return res.status(200).json({ oauthUrl: authUrl })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
