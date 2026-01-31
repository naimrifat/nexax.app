import type { VercelRequest, VercelResponse } from '@vercel/node'

// Dispatcher gateway: single entry for all eBay related API surface
// This keeps the Hobby plan within 1 gateway function while delegating work to existing endpoints.

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type RouteMap = { [k: string]: string }

const ROUTES: RouteMap = {
  'analyze-listing': '/api/analyze-listing',
  'reconcile-specifics': '/api/reconcile-specifics',
  'publish': '/api/publish-listing',
  'transcribe': '/api/transcribe',
  'getCategorySpecifics': '/api/ebay-categories',
  'getCategorySuggestions': '/api/ebay-categories',
  'getCategoryConditions': '/api/ebay-item-conditions'
}

export const config = {
  api: { bodyParser: true },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId()
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', requestId })

  try {
    const body: any = req.body || {}
    const action = String(body.action ?? body?.payload?.action ?? body?.['action'] ?? '').trim()
    let payload = body.payload ?? body
    if (!action) {
      return res.status(400).json({ error: 'Missing action', requestId })
    }

    // Normalize payload shape for common patterns
    if (payload && typeof payload === 'object' && Object.values(payload).length === 1 && payload.action) {
      payload = payload
    }

    const path = ROUTES[action]
    if (!path) {
      return res.status(400).json({ error: 'Invalid action', requestId })
    }

    // Forward to existing backend endpoints, preserving auth headers
    const host = (req.headers.host && `http://${req.headers.host}`) || ''
    const baseUrl = process.env.NEXAX_GATEWAY_BASE_URL || host || ''
    const url = (baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl) + path

    const authHeader = req.headers['authorization'] as string | undefined
    const headers: any = {
      'Content-Type': 'application/json',
    }
    if (authHeader) headers['Authorization'] = authHeader

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      return res.status(resp.status).json({ error: data?.error || resp.statusText, requestId, data })
    }

    res.status(200).json({ ok: true, requestId, data })
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal server error', requestId })
  }
}
