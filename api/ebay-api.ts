import type { VercelRequest, VercelResponse } from '@vercel/node'
import { analyzeListingCore } from '../lib/cores/analyzeListingCore.js'
import { reconcileSpecificsCore } from '../lib/cores/reconcileSpecificsCore.js'
import { publishListingCore } from '../lib/cores/publishListingCore.js'
import { transcribeCore } from '../lib/cores/transcribeCore.js'
import { ebayCategoriesCore } from '../lib/cores/ebayCategoriesCore.js'
import * as Telemetry from '../lib/telemetry.js'

// Dispatcher gateway: single entry for all eBay related API surface
// This keeps the Hobby plan within 1 gateway function while delegating work to existing endpoints.

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
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
    const action = body.action ?? body.payload?.action ?? null
    const actionKey = typeof action === 'string' ? action.trim() : action
    const payload = body.payload ?? body
    if (!actionKey) {
      return res.status(400).json({ ok: false, error: 'MISSING_ACTION', requestId })
    }

    // Route to core implementations (dispatcher gateway -> core modules)
    let result: any = null
    switch (actionKey) {
      case 'analyze-listing':
        {
          const t0 = Date.now()
          result = await analyzeListingCore({ payload, headers: req.headers as any })
          const latency = Date.now() - t0
          // instrument telemetry
          Telemetry.record?.(action, !!result?.ok, latency)
        }
        break
      case 'reconcile-specifics':
        {
          const t0 = Date.now()
          result = await reconcileSpecificsCore({ payload, headers: req.headers as any })
          const latency = Date.now() - t0
          Telemetry.record?.(action, !!result?.ok, latency)
        }
        break
      case 'publish':
        {
          const t0 = Date.now()
          result = await publishListingCore({ payload, headers: req.headers as any })
          const latency = Date.now() - t0
          Telemetry.record?.(action, !!result?.ok, latency)
        }
        break
      case 'transcribe':
        {
          const t0 = Date.now()
          result = await transcribeCore({ payload, headers: req.headers as any })
          const latency = Date.now() - t0
          Telemetry.record?.(action, !!result?.ok, latency)
        }
        break
      case 'getCategorySpecifics':
      case 'getCategories':
      case 'getCategorySuggestions':
      case 'getCategoryConditions':
        {
          const t0 = Date.now()
          const normalizedPayload =
            actionKey === 'getCategories'
              ? {
                  ...payload,
                  parentCategoryId:
                    payload?.parentCategoryId == null && payload?.parent_category_id == null
                      ? '0'
                      : String(payload?.parentCategoryId).trim() === '0'
                        ? '0'
                        : payload?.parentCategoryId,
                }
              : payload
          result = await ebayCategoriesCore({ payload: normalizedPayload, headers: req.headers as any })
          const latency = Date.now() - t0
          Telemetry.record?.(action, !!result?.ok, latency)
        }
        break
      default:
        return res.status(400).json({
          ok: false,
          error: 'INVALID_ACTION',
          received_action: actionKey,
          received_body_keys: Object.keys(body),
          requestId,
        })
    }

    const ok = result?.ok ?? true
    const dataOut = result?.data ?? {}
    const errOut = result?.error
    const rid = result?.requestId ?? requestId
    return res.status(200).json({ ok, requestId: rid, data: dataOut, error: errOut })
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal server error', requestId })
  }
}
