import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { analyzeListingCore } from '../lib/cores/analyzeListingCore.js'
import { reconcileSpecificsCore } from '../lib/cores/reconcileSpecificsCore.js'
import { publishListingCore } from '../lib/cores/publishListingCore.js'
import { transcribeCore } from '../lib/cores/transcribeCore.js'
import { ebayCategoriesCore } from '../lib/cores/ebayCategoriesCore.js'
import { getValidEbayToken } from '../lib/ebay/ebay-token-manager.js'
import { mapDetectedToAspects } from '../lib/ebay/mapDetectedToAspects.js'
import * as Telemetry from '../lib/telemetry.js'

// Dispatcher gateway: single entry for all eBay related API surface
// This keeps the Hobby plan within 1 gateway function while delegating work to existing endpoints.

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function ebaySafeErrorMessage(json: any, status: number): string {
  const e0 = json?.errors?.[0]
  return (
    e0?.longMessage ||
    e0?.message ||
    json?.error_description ||
    json?.error ||
    `eBay API failed: ${status}`
  )
}

function isLowConfidenceValue(v: string): boolean {
  const s = String(v || '').trim().toLowerCase()
  return !s || s === 'unknown' || s === 'n/a' || s === 'na' || s === 'maybe'
}

function normalizeValueString(v: string): string {
  return String(v || '').trim().toLowerCase()
}

let cachedAppToken: { access_token: string; expires_at: number } | null = null

async function getEbayAppToken(): Promise<string> {
  if (cachedAppToken && cachedAppToken.expires_at > Date.now()) return cachedAppToken.access_token

  const clientId = process.env.EBAY_CLIENT_ID
  const clientSecret = process.env.EBAY_CLIENT_SECRET
  if (!clientId || !clientSecret) return ''

  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const resp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${encoded}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  })

  if (!resp.ok) return ''

  const data = await resp.json().catch(() => ({}))
  const accessToken = String(data?.access_token || '')
  const expiresIn = Number(data?.expires_in ?? 7200)
  if (!accessToken) return ''

  cachedAppToken = {
    access_token: accessToken,
    expires_at: Date.now() + Math.max(0, (expiresIn - 300) * 1000),
  }

  return accessToken
}

async function ebayGetJsonOrThrow(url: string, accessToken: string) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    const err: any = new Error(ebaySafeErrorMessage(json, res.status))
    err.statusCode = res.status
    err.details = json
    throw err
  }

  return json
}

function normalizeWorkspaceId(payload: any): string {
  return String(payload?.workspace_id ?? payload?.workspaceId ?? '').trim()
}

function getEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function mapCategoryChildren(children: any[]): Array<{ id: string; name: string; leaf: boolean }> {
  return (children || [])
    .map((n: any) => {
      const c = n?.category || {}
      return {
        id: String(c?.categoryId || ''),
        name: String(c?.categoryName || ''),
        leaf: !!n?.leafCategoryTreeNode,
      }
    })
    .filter((c: any) => c.id && c.name)
}

export const config = {
  api: { bodyParser: true },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId()
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', requestId })

  try {
    const body: any = req.body || {}
    const action = body.action ?? body.payload?.action ?? null
    const actionKey = typeof action === 'string' ? action.trim() : action
    const payload = body.payload ?? body
    if (!actionKey) {
      return res.status(400).json({ ok: false, error: 'MISSING_ACTION', requestId })
    }

    const SUPABASE_URL = getEnv('SUPABASE_URL')
    const SUPABASE_ANON_KEY = getEnv('SUPABASE_ANON_KEY')
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    const authHeader = req.headers.authorization || ''

    if (!authHeader) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', requestId })
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser()

    if (authErr || !user) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', requestId })
    }

    // Route to core implementations (dispatcher gateway -> core modules)
    let result: any = null
    switch (actionKey) {
      case 'analyze-listing':
        {
          const t0 = Date.now()
          result = await analyzeListingCore({ payload, headers: req.headers as any })
          console.log('[ebay-api] analyze-listing', {
            requestId,
            action: actionKey,
            analyzeOk: !!result?.ok,
            titleLen: String(result?.data?.title || '').length,
            categoryIdPresent: !!String(result?.data?.category_id || result?.data?.category?.id || '').trim(),
          })
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
      case 'reconcileSpecifics':
        {
          const t0 = Date.now()
          const categoryId = String(payload?.categoryId ?? payload?.category_id ?? '').trim()
          const categoryPath = String(payload?.categoryPath ?? payload?.category_path ?? '')
          const detected = payload?.detected || {}
          const title = String(payload?.title ?? '')
          const description = String(payload?.description ?? '')
          const aspects = Array.isArray(payload?.aspects) ? payload.aspects : []

          const aspectsForModel = aspects.map((a: any) => ({
            name: String(a?.name || '').trim(),
            required: !!a?.required,
            selectionOnly: !!a?.selectionOnly,
            multi: !!a?.multi,
            freeTextAllowed: a?.freeTextAllowed !== false,
            options: Array.isArray(a?.values) ? a.values : [],
          }))

          const proposals = mapDetectedToAspects({ detected, aspects: aspectsForModel, title, description })
          const aiSpecifics = proposals
          const schemaMap = new Map(
            aspectsForModel
              .filter((a: any) => a?.name)
              .map((a: any) => [normalizeValueString(a.name), a])
          )

          const item_specifics = proposals.map((p: any) => {
            const name = String(p?.name || '').trim()
            const key = normalizeValueString(name)
            const aspect = schemaMap.get(key)
            if (!aspect) {
              return { name, value: p?.value ?? '', accepted: false, reason: 'Unknown aspect' }
            }

            const rawValue = p?.value
            if (Array.isArray(rawValue)) {
              const cleaned = rawValue.map((v) => String(v || '')).filter((v) => !isLowConfidenceValue(v))
              if (!cleaned.length) return { name, value: [], accepted: false, reason: 'Empty value' }

              if (aspect.selectionOnly && Array.isArray(aspect.options) && aspect.options.length) {
                const allowed = new Map(
                  aspect.options.map((v: string) => [normalizeValueString(v), v])
                )
                const filtered = cleaned
                  .map((v) => allowed.get(normalizeValueString(v)) || '')
                  .filter(Boolean)
                if (!filtered.length) {
                  return { name, value: [], accepted: false, reason: 'Value not in options' }
                }
                return { name, value: aspect.multi ? filtered : filtered[0], accepted: true, reason: 'Accepted' }
              }

              if (aspect.freeTextAllowed) {
                return { name, value: aspect.multi ? cleaned : cleaned[0], accepted: true, reason: 'Accepted' }
              }

              return { name, value: [], accepted: false, reason: 'Free text not allowed' }
            }

            const value = String(rawValue || '')
            if (isLowConfidenceValue(value)) {
              return { name, value: '', accepted: false, reason: 'Empty value' }
            }

            if (aspect.selectionOnly && Array.isArray(aspect.options) && aspect.options.length) {
              const allowed = new Map(
                aspect.options.map((v: string) => [normalizeValueString(v), v])
              )
              const matched = allowed.get(normalizeValueString(value))
              if (!matched) {
                return { name, value: '', accepted: false, reason: 'Value not in options' }
              }
              return { name, value: matched, accepted: true, reason: 'Accepted' }
            }

            if (aspect.freeTextAllowed) {
              return { name, value, accepted: true, reason: 'Accepted' }
            }

            return { name, value: '', accepted: false, reason: 'Free text not allowed' }
          })

          const reconcileResult = await reconcileSpecificsCore({
            payload: { item_specifics, aiSpecifics },
            headers: req.headers as any,
          })
          const reconciledSpecifics = Array.isArray(reconcileResult?.data?.item_specifics)
            ? reconcileResult.data.item_specifics
            : item_specifics

          result = {
            ok: true,
            data: { categoryId, item_specifics: reconciledSpecifics },
            error: null,
            requestId,
          }
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
      case 'getCategorySuggestions':
      case 'getCategoryConditions':
        {
          const t0 = Date.now()
          if (actionKey === 'getCategorySpecifics') {
            const categoryId = String(payload?.categoryId ?? payload?.category_id ?? '').trim()
            console.log(JSON.stringify({ requestId, action: 'getCategorySpecifics', categoryId, phase: 'start' }))
          }
          result = await ebayCategoriesCore({ payload, headers: req.headers as any })
          if (actionKey === 'getCategorySpecifics') {
            const categoryId = String(payload?.categoryId ?? payload?.category_id ?? '').trim()
            const aspectCount = Array.isArray(result?.data?.aspects) ? result.data.aspects.length : 0
            const ebayStatus = Number(result?.status || (result?.ok ? 200 : 0)) || 0
            console.log('[ebay-api] getCategorySpecifics', {
              requestId,
              action: actionKey,
              categoryId: String(payload?.categoryId ?? payload?.category_id ?? '').trim(),
              aspectCount,
            })
            console.log(
              JSON.stringify({
                requestId,
                action: 'getCategorySpecifics',
                categoryId,
                phase: 'end',
                aspectCount,
                ebayStatus,
              })
            )
          }
          const latency = Date.now() - t0
          Telemetry.record?.(action, !!result?.ok, latency)
        }
        break
      case 'getCategories':
        {
          const t0 = Date.now()
          const marketplaceId = 'EBAY_US'
          const workspaceIdFromPayload = normalizeWorkspaceId(payload)

          const { data: userRow, error: userRowErr } = await adminClient
            .from('users')
            .select('workspace_id')
            .eq('auth_provider_user_id', user.id)
            .maybeSingle()

          if (userRowErr) {
            return res.status(500).json({ ok: false, error: 'Failed to resolve user workspace', requestId })
          }

          const userWorkspaceId = String((userRow as any)?.workspace_id || '').trim()
          const workspaceId = workspaceIdFromPayload || userWorkspaceId

          if (!workspaceId) {
            return res.status(200).json({ ok: false, error: 'EBAY_NOT_CONNECTED', requestId })
          }

          if (workspaceIdFromPayload && userWorkspaceId && workspaceIdFromPayload !== userWorkspaceId) {
            return res.status(403).json({ ok: false, error: 'FORBIDDEN', requestId })
          }

          const { data: connRow, error: connErr } = await adminClient
            .from('marketplace_connections')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('marketplace', 'ebay')
            .eq('environment', 'production')
            .maybeSingle()

          const tokenRowFound = !!connRow

          console.error('[ebay-api] auth context', {
            requestId,
            hasAuthorization: !!authHeader,
            userId: user.id,
            workspaceId,
            tokenRowFound,
          })

          if (connErr) {
            return res.status(500).json({ ok: false, error: 'Failed to load eBay connection', requestId })
          }

          if (!connRow) {
            return res.status(200).json({ ok: false, error: 'EBAY_NOT_CONNECTED', requestId })
          }

          console.error('[ebay-api] taxonomy token', {
            requestId,
            action: actionKey,
            workspace_id: workspaceId,
            usingAppToken: true,
          })

          const accessToken = await getEbayAppToken()

          if (!accessToken) {
            return res.status(200).json({ ok: false, error: 'EBAY_NOT_CONNECTED', requestId })
          }

          const parentCategoryId = String(payload?.parentCategoryId ?? '').trim()
          try {
            const treeInfo = await ebayGetJsonOrThrow(
              `https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(
                marketplaceId
              )}`,
              accessToken
            )

            const categoryTreeId = String(treeInfo?.categoryTreeId || '').trim()
            if (!categoryTreeId) {
              const msg = 'Missing categoryTreeId from eBay taxonomy'
              return res.status(502).json({
                ok: false,
                error: 'EBAY_TAXONOMY_ERROR',
                status: 502,
                details: msg,
                requestId,
              })
            }

            let categories: Array<{ id: string; name: string; leaf: boolean }> = []

            if (!parentCategoryId || parentCategoryId === '0') {
              const tree = await ebayGetJsonOrThrow(
                `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${encodeURIComponent(categoryTreeId)}`,
                accessToken
              )

              const children = Array.isArray(tree?.rootCategoryNode?.childCategoryTreeNodes)
                ? tree.rootCategoryNode.childCategoryTreeNodes
                : []
              categories = mapCategoryChildren(children)
            } else {
              const subtree = await ebayGetJsonOrThrow(
                `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
                  categoryTreeId
                )}/get_category_subtree?category_id=${encodeURIComponent(parentCategoryId)}`,
                accessToken
              )

              const children = Array.isArray(subtree?.categorySubtreeNode?.childCategoryTreeNodes)
                ? subtree.categorySubtreeNode.childCategoryTreeNodes
                : []
              categories = mapCategoryChildren(children)
            }

            result = {
              ok: true,
              data: { categories, items: categories },
              error: null,
              requestId,
            }
            const latency = Date.now() - t0
            Telemetry.record?.(action, !!result?.ok, latency)
          } catch (err: any) {
            const status = Number(err?.statusCode || 502)
            const details = String(err?.message || 'eBay taxonomy request failed')
            return res.status(status).json({
              ok: false,
              error: 'EBAY_TAXONOMY_ERROR',
              status,
              details,
              requestId,
            })
          }
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
