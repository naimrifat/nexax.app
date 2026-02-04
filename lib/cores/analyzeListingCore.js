import { createClient } from '@supabase/supabase-js'
import { RECONCILE_SYSTEM_PROMPT, buildReconcileUserPrompt } from '../prompts/reconcilePrompt.js'
import { optimizeEbayTitle } from '../seo/titleOptimizer.js'
import { buildFallbackTitle } from '../titleBuilder.js'
import { validateTitle } from '../titleValidator.js'
import { sanitizeTitleTokens } from '../titleSanitizer.js'
import { buildPromotedTitle } from '../titlePromotion.js'

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const norm = (s) => String(s ?? '').toLowerCase().trim()
const tokens = (s) => norm(s).split(/[\s\/,&-]+/).filter(Boolean)

function isBlobOrObjectUrl(u) {
  const s = norm(u)
  return s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('file:')
}

function isHttpUrl(u) {
  try {
    const url = new URL(u)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) return []
  return input
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

function getEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function clipInstruction(v, max, label) {
  const s = String(v ?? '').trim()
  if (s.length <= max) return s
  console.warn('[gen] listing style truncated', { field: label, max })
  return s.slice(0, max)
}

async function fetchWorkspaceListingStyle({ userClient, workspaceId }) {
  const wsId = String(workspaceId || '').trim()
  if (!wsId) return null

  const q = await userClient
    .from('workspace_listing_style')
    .select('enabled,title_instructions,description_instructions,extra_rules')
    .eq('workspace_id', wsId)
    .maybeSingle()

  if (q.error) throw q.error
  const row = q.data || null
  if (!row) return null

  return {
    enabled: Boolean(row.enabled),
    title_instructions: String(row.title_instructions || ''),
    description_instructions: String(row.description_instructions || ''),
    extra_rules: String(row.extra_rules || ''),
  }
}

function toOptimizedVisionUrl(url) {
  try {
    const u = url.trim()
    if (!u.includes('cloudinary.com')) return u
    if (!u.includes('/upload/')) return u
    return u.replace('/upload/', '/upload/w_2048,h_2048,c_limit,q_auto,f_auto/')
  } catch {
    return url
  }
}

function safeJSON(txt, fallback) {
  try {
    return JSON.parse(txt)
  } catch {
    return fallback
  }
}

function normalizeConditionIntent(v) {
  const s = String(v ?? '').trim().toUpperCase()
  if (
    s === 'NEW_WITH_TAGS' ||
    s === 'NEW_WITH_BOX' ||
    s === 'NEW_OTHER' ||
    s === 'USED_EXCELLENT' ||
    s === 'USED_GOOD' ||
    s === 'USED_FAIR'
  ) {
    return s
  }
  return 'UNKNOWN'
}

function includesAny(hay, needles) {
  const h = norm(hay)
  return needles.some((n) => h.includes(norm(n)))
}

function pickBestOption(target, options = []) {
  if (!target) return ''
  if (!options?.length) return target
  const t = norm(target)
  const exact = options.find((o) => norm(o) === t)
  if (exact) return exact
  const tt = tokens(t)
  let best = ''
  let bestScore = 0
  for (const o of options) {
    const on = norm(o)
    const ov = tokens(on)
    const overlap = tt.filter((x) => ov.includes(x)).length
    const beginsBonus = on.startsWith(t) || t.startsWith(on) ? 1 : 0
    const containsBonus = on.includes(t) || t.includes(on) ? 0.5 : 0
    const score = overlap + beginsBonus + containsBonus
    if (score > bestScore) {
      bestScore = score
      best = o
    }
  }
  return best || ''
}

function inferDepartmentFromPath(path) {
  const p = norm(path)
  if (p.includes('women')) return 'Women'
  if (p.includes('men')) return 'Men'
  if (p.includes('girls')) return 'Girls'
  if (p.includes('boys')) return 'Boys'
  if (p.includes('unisex')) return 'Unisex Adult'
  return ''
}

function inferSizeType({ size, title, categoryPath }) {
  const hay = [size, title, categoryPath].filter(Boolean).join(' ').toLowerCase()
  if (includesAny(hay, ['petite'])) return 'Petite'
  if (includesAny(hay, ['tall', 'long'])) return 'Tall'
  if (includesAny(hay, ['plus', 'extended', 'big & tall', 'big tall'])) return 'Plus'
  return 'Regular'
}

const VALUE_SYNONYMS = {
  Color: {
    grey: 'Gray',
    gray: 'Gray',
    charcoal: 'Gray',
    'navy blue': 'Navy',
    navy: 'Navy',
    'light blue': 'Blue',
    'sky blue': 'Blue',
    tan: 'Beige',
    khaki: 'Beige',
    offwhite: 'White',
    'off-white': 'White',
    cream: 'Ivory',
  },
  Material: {
    'polyester blend': 'Polyester',
    'cotton blend': 'Cotton',
    '100% cotton': 'Cotton',
    '100% polyester': 'Polyester',
    fleece: 'Fleece',
    denim: 'Denim',
  },
  Department: {
    women: 'Women',
    womens: 'Women',
    womenswear: 'Women',
    men: 'Men',
    mens: 'Men',
    unisex: 'Unisex Adult',
  },
}

const COLOR_CANON = {
  black: 'Black',
  white: 'White',
  gray: 'Gray',
  grey: 'Gray',
  charcoal: 'Gray',
  red: 'Red',
  blue: 'Blue',
  navy: 'Navy',
  green: 'Green',
  beige: 'Beige',
  tan: 'Beige',
  khaki: 'Beige',
  brown: 'Brown',
  pink: 'Pink',
  purple: 'Purple',
  yellow: 'Yellow',
  orange: 'Orange',
  ivory: 'Ivory',
}

const PATTERN_KEYWORDS = {
  Floral: ['floral', 'flower', 'botanical'],
  Solid: ['solid', 'plain'],
  Striped: ['stripe', 'striped'],
  Plaid: ['plaid', 'tartan'],
  'Animal Print': ['animal print', 'leopard', 'cheetah', 'zebra', 'snake'],
  Graphic: ['graphic', 'logo', 'print'],
  Quilted: ['quilted'],
}

function canonicalAspectKey(aspectName) {
  const n = norm(aspectName)
  if (n.includes('color') || n.includes('colour')) return 'Color'
  if (n.includes('material')) return 'Material'
  if (n === 'department') return 'Department'
  if (n.includes('pattern')) return 'Pattern'
  return null
}

function unifySynonyms(aspectName, raw) {
  const key = canonicalAspectKey(aspectName)
  if (!key) return raw
  const table = VALUE_SYNONYMS[key]
  if (!table) return raw
  const n = norm(raw)
  for (const from in table) {
    if (n === norm(from)) return table[from]
  }
  return raw
}

function normalizeColor(raw) {
  const n = norm(raw)
  return COLOR_CANON[n] || raw
}

function resolvePattern(raw) {
  const r = norm(raw)
  for (const pattern in PATTERN_KEYWORDS) {
    if (PATTERN_KEYWORDS[pattern].some((k) => r.includes(k))) {
      return pattern
    }
  }
  return raw
}

function dedupeArray(arr) {
  const seen = new Set()
  const out = []
  for (const v of arr) {
    const key = norm(String(v))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function isEmptySpecificValue(v) {
  if (Array.isArray(v)) return v.filter((x) => String(x ?? '').trim().length > 0).length === 0
  return String(v ?? '').trim().length === 0
}

function buildSchemaMaps(aspects) {
  const byName = new Map()
  const optionSets = new Map()
  const canonicalValue = new Map()

  for (const a of aspects) {
    const key = norm(a.name)
    byName.set(key, a)
    const set = new Set()
    const canonMap = new Map()
    for (const v of a.values || []) {
      const nv = norm(v)
      set.add(nv)
      canonMap.set(nv, v)
    }
    optionSets.set(key, set)
    canonicalValue.set(key, canonMap)
  }
  return { byName, optionSets, canonicalValue }
}

function preprocessValue(aspect, raw) {
  let v = raw
  const key = canonicalAspectKey(aspect.name)
  if (!key) return v
  if (key === 'Color') {
    v = unifySynonyms(aspect.name, v)
    v = normalizeColor(v)
  } else if (key === 'Material' || key === 'Department') {
    v = unifySynonyms(aspect.name, v)
  } else if (key === 'Pattern') {
    v = resolvePattern(v)
  }
  return v
}

function normalizeValueForAspect(aspect, raw, optionSet, canonMap) {
  const toArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])
  const vals = toArray(raw)
    .map(String)
    .filter(Boolean)
    .map((v) => preprocessValue(aspect, v))

  const hasOptions = !!(aspect.values && aspect.values.length)
  const snapOne = (v) => {
    if (!hasOptions || !optionSet || !canonMap) return ''
    const nv = norm(v)
    if (optionSet.has(nv)) return canonMap.get(nv)
    const snapped = pickBestOption(v, aspect.values)
    return snapped || ''
  }

  if (hasOptions) {
    if (aspect.multi) {
      const snapped = []
      for (const v of vals) {
        const s = snapOne(v)
        if (s) snapped.push(s)
      }
      const deduped = dedupeArray(snapped).slice(0, 3)
      if (deduped.length) return deduped
      if (!aspect.freeTextAllowed) return []
    } else {
      const first = vals[0] ?? ''
      const s = snapOne(first)
      if (s) return [s]
      if (!aspect.freeTextAllowed) return []
    }
  }

  if (!aspect.freeTextAllowed) return []

  if (aspect.multi) return dedupeArray(vals).slice(0, 3)
  return vals.length ? [vals[0]] : []
}

async function callOpenAIChat(body) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`OpenAI API error: ${r.status} ${await r.text()}`)
  return r.json()
}

let cachedAppToken = null

async function getEbayAppToken() {
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

async function ebayGetJsonOrNull(url, accessToken) {
  if (!accessToken) return null
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!resp.ok) return null
  return await resp.json().catch(() => null)
}

export async function analyzeListingCore(input) {
  const requestId = makeRequestId()
  const payload = (input && input.payload) || input
  const headers = (input && input.headers) || {}

  if (!payload) {
    return { ok: false, data: {}, error: 'No payload', requestId }
  }

  const workspace_id = String(payload.workspace_id || payload.workspaceId || '').trim()
  const authHeader = String(headers.authorization || '').trim()
  const userClient = authHeader
    ? createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      })
    : null

  const { session_id } = payload

  const rawImages = payload.images ?? payload.image_urls ?? []
  const incoming = normalizeStringArray(rawImages)
  const blobOrObject = incoming.filter(isBlobOrObjectUrl)
  const nonHttp = incoming.filter((u) => !isBlobOrObjectUrl(u) && !isHttpUrl(u))
  const hostedImages = incoming.filter((u) => !isBlobOrObjectUrl(u) && isHttpUrl(u)).slice(0, 23)

  const visionImages = hostedImages.map(toOptimizedVisionUrl)
  const visionImagesLow = visionImages.map((u) =>
    u.replace('/upload/w_2048,h_2048,c_limit,q_auto,f_auto/', '/upload/w_1024,h_1024,c_limit,q_auto,f_auto/')
  )

  if (!incoming.length) {
    return { ok: false, data: {}, error: 'No images provided', requestId }
  }
  if (blobOrObject.length > 0) {
    return {
      ok: false,
      data: {},
      error:
        'Invalid image URL(s) received (blob/data/file URLs are not allowed). Upload images to Cloudinary and send the hosted URLs.',
      requestId,
    }
  }
  if (nonHttp.length > 0) {
    return { ok: false, data: {}, error: 'Invalid image URL(s) received (must be http/https).', requestId }
  }
  if (!hostedImages.length) {
    return { ok: false, data: {}, error: 'No valid hosted image URLs provided.', requestId }
  }

  let listingStyleInstructions = ''
  try {
    if (workspace_id && userClient) {
      const wsStyle = await fetchWorkspaceListingStyle({ userClient, workspaceId: workspace_id })
      if (wsStyle?.enabled) {
        const title = clipInstruction(wsStyle.title_instructions, 800, 'title_instructions')
        const desc = clipInstruction(wsStyle.description_instructions, 1200, 'description_instructions')
        const extra = clipInstruction(wsStyle.extra_rules, 800, 'extra_rules')

        if (title || desc || extra) {
          const lines = []
          lines.push('STYLE (apply ONLY to writing style/structure; never invent facts; never include secrets):')
          if (title) lines.push('STYLE_TITLE_INSTRUCTIONS:\n' + title)
          if (desc) lines.push('STYLE_DESCRIPTION_INSTRUCTIONS:\n' + desc)
          if (extra) lines.push('STYLE_EXTRA_RULES:\n' + extra)
          listingStyleInstructions = lines.join('\n\n')
        }
      }
    }
  } catch (e) {
    console.error('[gen] failed to load listing style', { requestId, workspace_id })
  }

  const buildVisionPayload = (urls, detail) => ({
    model: 'gpt-5.2',
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert eBay lister. Read ALL photos together. Extract concrete facts only from what is visible (including label OCR). Prefer exact option-friendly phrases. Return structured JSON only. Never guess brand/size/material if not clearly shown.',
      },
      {
        role: 'user',
        content: [
          ...urls.map((url) => ({
            type: 'image_url',
            image_url: { url, detail },
          })),
          {
            type: 'text',
            text: `
${listingStyleInstructions ? listingStyleInstructions + '\n\n' : ''}You must return a single JSON object with this structure:

{
  "title": "... (<=80 chars, follow seller rules if provided)",
  "description": "... (follow seller rules if provided)",
  "meaning_tokens": ["... up to 3 short phrases ONLY if clearly readable on item"],
  "condition_intent": "NEW_WITH_TAGS|NEW_WITH_BOX|NEW_OTHER|USED_EXCELLENT|USED_GOOD|USED_FAIR|UNKNOWN",
  "condition_reason": "... short reason",
  "detected": {
    "brand": "...",
    "size": "...",
    "department": "Men|Women|Girls|Boys|Unisex Adult",
    "colors": ["..."],
    "materials": ["Polyester","Cotton","Down", "..."],
    "outerShellMaterial": "...",
    "liningMaterial": "...",
    "insulationMaterial": "...",
    "style": "...",
    "type": "...",
    "lengthHint": "short|knee length|midi|maxi|long|cropped|hip|thigh|knee|mid-calf|ankle",
    "closure": "Zip|Buttons|Buckle|Pullover|Hook & Eye|...",
    "features": ["Hood","Pockets","Water Resistant","Stretch", "..."],
    "pocketType": "Cargo|Slash|Patch|Welt|... if visible",
    "frontType": "Flat Front|Pleated|... if visible",
    "fabricType": "Canvas|Denim|Fleece|Knit|... if visible",
    "pattern": "Solid|Floral|Plaid|Striped|Animal Print|Logo|Graphic|Quilted|...",
    "theme": ["Outdoor","Sports","Y2K","80s","90s","Animals","Floral"],
    "occasion": "Casual|Workwear|Activewear|... if visible",
    "countryOfOrigin": "... if visible",
    "model": "... if visible",
    "sleeveLength": "Short|3/4|Long|Sleeveless|...",
    "fit": "Regular|Slim|Relaxed|Classic|...",
    "sizeTypeHint": "Regular|Plus|Petite|Tall|Big & Tall",
    "jacketCut": "Single-breasted|Double-breasted",
    "numberOfPieces": "1|2|3|...",
    "lapelStyle": "Notch Lapel|Peak Lapel|Shawl Lapel",
    "frontButtonStyle": "1-Button|2-Button|3-Button",
    "ventStyle": "No Vent|Single Vent|Double Vent",
    "sleeveButtonStyle": "0|1|2|3|4|5 buttons",
    "lined": "Fully Lined|Partially Lined|Unlined",
    "garmentCare": "Dry clean only|...",
    "vintage": "Yes|No|Unknown",
    "handmade": "Yes|No|Unknown",
    "ocrText": "All readable tag text lines",
    "tagStyleNumber": "Style/PO/CA/RN numbers",
    "mpn": "MPN if explicitly labeled"
  },
  "keywords": ["..."]
}
`,
          },
        ],
      },
    ],
  })

  let vision
  try {
    vision = await callOpenAIChat(buildVisionPayload(visionImages, 'high'))
  } catch (err) {
    const msg = String(err?.message || '')
    if (msg.includes('invalid_image_url') || msg.includes('Timeout while downloading')) {
      vision = await callOpenAIChat(buildVisionPayload(visionImagesLow, 'low'))
    } else {
      return { ok: false, data: {}, error: `Vision analysis failed: ${String(err?.message || 'Unknown error')}`, requestId }
    }
  }

  const visionJSON = safeJSON(vision.choices?.[0]?.message?.content || '{}', {
    detected: {},
    title: '',
    description: '',
    keywords: [],
    condition_intent: 'UNKNOWN',
    condition_reason: '',
  })

  const detected = visionJSON.detected || {}
  let title = visionJSON.title || ''
  const description = visionJSON.description || ''

  const condition_intent = normalizeConditionIntent(visionJSON.condition_intent)
  const condition_reason = String(visionJSON.condition_reason || '').trim().slice(0, 200)

  const categoryGuessingText = `${title}\n${description}`
  const department = detected.department || inferDepartmentFromPath(categoryGuessingText)
  const sizeType =
    detected.sizeTypeHint ||
    inferSizeType({ size: detected.size, title, categoryPath: categoryGuessingText })

  let category = { id: '', name: '', path: '' }
  let categorySuggestions = []

  const suggestionQuery =
    (title && title !== 'Untitled Listing')
      ? title
      : Array.isArray(visionJSON.keywords) && visionJSON.keywords.length
        ? visionJSON.keywords.join(' ')
        : [detected.brand, detected.type, detected.department, detected.color, detected.size]
            .map((v) => String(v || '').trim())
            .filter(Boolean)
            .join(' ')

  if (suggestionQuery) {
    const appToken = await getEbayAppToken()
    if (appToken) {
      const tree = await ebayGetJsonOrNull(
        'https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US',
        appToken
      )
      const treeId = String(tree?.categoryTreeId || '').trim()
      if (treeId) {
        const sug = await ebayGetJsonOrNull(
          `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
            treeId
          )}/get_category_suggestions?q=${encodeURIComponent(suggestionQuery)}`,
          appToken
        )
        const suggestions = Array.isArray(sug?.categorySuggestions) ? sug.categorySuggestions : []
        const top = suggestions[0]
        const cat = top?.category || {}
        const cid = String(cat?.categoryId || '').trim()
        const cname = String(cat?.categoryName || '').trim()
        if (cid && cid !== '0') {
          const ancestors = Array.isArray(top?.categoryTreeNodeAncestors)
            ? top.categoryTreeNodeAncestors
            : []
          const pathParts = ancestors
            .map((a) => String(a?.categoryName || '').trim())
            .filter(Boolean)
          if (cname) pathParts.push(cname)
          category = {
            id: cid,
            name: cname,
            path: pathParts.length ? pathParts.join(' > ') : cname,
          }
        }
        categorySuggestions = suggestions.map((s) => ({
          id: String(s?.category?.categoryId || ''),
          name: String(s?.category?.categoryName || ''),
          path: String(s?.category?.categoryName || ''),
        }))
      }
    }
  }

  const optimized = optimizeEbayTitle({ rawTitle: title, categoryPath: category.path, detected })
  title = optimized.title || title

  let aspects = []
  if (category.id) {
    const appToken = await getEbayAppToken()
    if (appToken) {
      const tree = await ebayGetJsonOrNull(
        'https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US',
        appToken
      )
      const treeId = String(tree?.categoryTreeId || '').trim()
      if (treeId) {
        const data = await ebayGetJsonOrNull(
          `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
            treeId
          )}/get_item_aspects_for_category?category_id=${encodeURIComponent(category.id)}`,
          appToken
        )
        aspects = (data?.aspects ?? []).map((a) => ({
          name: a.name,
          required: !!a.required,
          type: a.type,
          multi: !!a.multi,
          selectionOnly: a.type === 'SelectionOnly',
          freeTextAllowed: a.type !== 'SelectionOnly',
          values: Array.isArray(a.values) ? a.values : [],
        }))
      }
    }
  }

  const meaningTokens = (() => {
    const v = visionJSON?.meaning_tokens
    const fromVision = normalizeStringArray(Array.isArray(v) ? v : v ? [v] : [])
    const extraFields = [
      detected.graphicText,
      detected.printText,
      detected.detectedText,
      detected.logoText,
      detected.teamName,
      detected.bandName,
      detected.franchiseName,
      detected.brandText,
    ]
    const fromDetected = normalizeStringArray(
      extraFields.flatMap((val) => (Array.isArray(val) ? val : val ? [val] : []))
    )
    return dedupeArray([...fromVision, ...fromDetected])
  })()

  const { byName, optionSets, canonicalValue } = buildSchemaMaps(aspects)

  const getAspectOptionsCap = (name) => {
    const n = norm(name)
    if (
      n.includes('fabric type') ||
      n.includes('occasion') ||
      n.includes('pocket type') ||
      n.includes('front type') ||
      n.includes('fit') ||
      n.includes('rise') ||
      n.includes('season') ||
      n.includes('vintage') ||
      n.includes('pattern') ||
      n.includes('style') ||
      n.includes('theme') ||
      n.includes('sport') ||
      n.includes('activity')
    ) {
      return 120
    }
    return 80
  }

  const buildOptionContext = () => {
    const flatDetected = (() => {
      try {
        return JSON.stringify(detected || {})
      } catch {
        return ''
      }
    })()

    const pieces = [
      title,
      description,
      flatDetected,
      detected.brand,
      detected.type,
      detected.style,
      detected.pattern,
      detected.jacketCut,
      detected.lapelStyle,
      detected.ventStyle,
      detected.frontButtonStyle,
      detected.sleeveButtonStyle,
      detected.lined,
      detected.garmentCare,
      detected.ocrText,
      detected.tagStyleNumber,
      detected.mpn,
      Array.isArray(detected.theme) ? detected.theme.join(' ') : detected.theme,
      Array.isArray(detected.features) ? detected.features.join(' ') : detected.features,
      Array.isArray(detected.colors) ? detected.colors.join(' ') : detected.colors,
      Array.isArray(detected.materials) ? detected.materials.join(' ') : detected.materials,
      detected.size,
      detected.model,
      meaningTokens.join(' '),
    ]
      .filter(Boolean)
      .map(String)

    return pieces.join(' ').toLowerCase()
  }

  const optionContext = buildOptionContext()

  const rankAndLimitOptions = (options, max) => {
    if (!Array.isArray(options)) return []
    if (options.length <= max) return options
    const scored = options.map((opt, idx) => {
      const clean = String(opt || '').trim()
      const lower = clean.toLowerCase()
      if (!clean) return { opt: clean, score: -1, idx }
      const overlap = tokens(lower).filter((t) => optionContext.includes(t)).length
      const containsBonus = optionContext.includes(lower) ? 2 : 0
      return { opt: clean, score: overlap + containsBonus, idx }
    })
    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx))
    return scored.slice(0, max).map((s) => s.opt).filter(Boolean)
  }

  const aspectsForModel = aspects.map((a) => ({
    name: a.name,
    required: !!a.required,
    selectionOnly: a.selectionOnly,
    multi: !!a.multi,
    freeTextAllowed: a.freeTextAllowed,
    options: rankAndLimitOptions(a.values || [], getAspectOptionsCap(a.name)),
  }))

  let recJSON = { final_specifics: [] }
  if (aspectsForModel.length) {
    const userPrompt = buildReconcileUserPrompt({
      categoryPath: category.path,
      title,
      description,
      detected,
      aspectsForModel,
    })

    const reconcile = await callOpenAIChat({
      model: 'gpt-5.2',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: RECONCILE_SYSTEM_PROMPT },
        { role: 'user', content: [{ type: 'text', text: userPrompt }] },
      ],
    })

    recJSON = safeJSON(reconcile.choices?.[0]?.message?.content || '{}', { final_specifics: [] })
  }

  let aiSpecifics = Array.isArray(recJSON.final_specifics) ? recJSON.final_specifics : []
  const mappingLog = []
  const sanitizedSpecifics = []

  for (const s of aiSpecifics) {
    const key = norm(s.name)
    const a = byName.get(key)
    if (!a) continue
    const normalized = normalizeValueForAspect(a, s.value, optionSets.get(key), canonicalValue.get(key))
    if (!normalized.length) {
      mappingLog.push(`AI → rejected or empty for "${a.name}"`)
      sanitizedSpecifics.push({ name: a.name, value: a.multi ? [] : '', source: 'ai' })
    } else {
      const v = a.multi ? normalized : normalized[0]
      mappingLog.push(`AI → accepted for "${a.name}": ${JSON.stringify(v)}`)
      sanitizedSpecifics.push({ name: a.name, value: v, source: 'ai' })
    }
  }

  let finalSpecifics = sanitizedSpecifics.map(({ name, value }) => ({ name, value }))
  const filled = new Map(finalSpecifics.map((s) => [norm(s.name), s]))

  for (const a of aspects) {
    const k = norm(a.name)
    const existing = filled.get(k)
    const isEmpty = !existing || (Array.isArray(existing.value) ? existing.value.length === 0 : !String(existing.value || '').trim())
    if (!isEmpty) continue

    const td = title + description
    const n = norm(a.name)
    let guess = ''

    if (n.includes('brand')) guess = detected.brand || ''
    else if (n === 'department') guess = department
    else if (n.includes('size type')) guess = sizeType
    else if (n === 'size' || n.includes('waist') || n.includes('inseam')) guess = detected.size || ''
    else if (n.includes('chest') && n.includes('size')) guess = detected.size || ''
    else if (n.includes('color') || n.includes('colour'))
      guess = (Array.isArray(detected.colors) ? detected.colors[0] : detected.colors) || ''
    else if (n.includes('outer') && n.includes('material'))
      guess = detected.outerShellMaterial || (Array.isArray(detected.materials) ? detected.materials?.[0] : '') || ''
    else if (n.includes('lining') && n.includes('material')) guess = detected.liningMaterial || ''
    else if (n.includes('insulation') && n.includes('material'))
      guess = detected.insulationMaterial || (includesAny(td, ['puffer', 'down']) ? 'Down' : '')
    else if (n === 'style') guess = detected.style || ''
    else if (n === 'type') guess = detected.type || ''
    else if (n.includes('pattern')) guess = detected.pattern || ''
    else if (n.includes('jacket cut')) guess = detected.jacketCut || ''
    else if (n.includes('number of pieces')) guess = detected.numberOfPieces || ''
    else if (n.includes('lapel')) guess = detected.lapelStyle || ''
    else if (n.includes('front button')) guess = detected.frontButtonStyle || ''
    else if (n.includes('vent')) guess = detected.ventStyle || ''
    else if (n.includes('sleeve') && n.includes('button')) guess = detected.sleeveButtonStyle || ''
    else if (n.includes('lined') || n.includes('lining')) guess = detected.lined || ''
    else if (n.includes('garment care') || (n.includes('care') && !n.includes('california'))) guess = detected.garmentCare || ''
    else if (n === 'mpn') guess = detected.mpn || ''
    else if (n.includes('pocket type')) guess = detected.pocketType || ''
    else if (n.includes('front type')) guess = detected.frontType || ''
    else if (n.includes('fabric type')) guess = detected.fabricType || ''
    else if (n.includes('occasion')) guess = detected.occasion || ''
    else if (n.includes('vintage')) guess = detected.vintage || ''
    else if (n.includes('handmade')) guess = detected.handmade || ''
    else if (n.includes('length')) {
      const h = norm(detected.lengthHint || '')
      if (h.includes('maxi') || h.includes('long') || h.includes('ankle')) guess = 'Long'
      else if (h.includes('midi') || h.includes('mid')) guess = 'Midi'
      else if (h.includes('knee')) guess = 'Knee Length'
      else if (h.includes('short') || h.includes('hip') || h.includes('cropped')) guess = 'Short'
    } else if (n.includes('closure')) guess = detected.closure || (includesAny(td, ['zip', 'zipper']) ? 'Zip' : '')
    else if (n.includes('theme'))
      guess = Array.isArray(detected.theme) ? detected.theme : detected.theme ? [detected.theme] : []
    else if (n.includes('features'))
      guess = Array.isArray(detected.features) ? detected.features : detected.features ? [detected.features] : []
    else if (n.includes('country') && n.includes('origin')) guess = detected.countryOfOrigin || ''
    else if (n.includes('model')) guess = detected.model || ''
    else if (n.includes('sleeve') && n.includes('length')) guess = detected.sleeveLength || ''
    else if (n === 'fit') guess = detected.fit || ''

    const snappedArr = normalizeValueForAspect(a, guess, optionSets.get(k), canonicalValue.get(k))
    if (snappedArr.length) {
      const v = a.multi ? snappedArr : snappedArr[0]
      filled.set(k, { name: a.name, value: v })
      mappingLog.push(`Heuristic → filled "${a.name}" with ${JSON.stringify(v)}`)
    } else {
      filled.set(k, { name: a.name, value: a.multi ? [] : '' })
    }
  }

  finalSpecifics = Array.from(filled.values())

  const requiredMissing = aspects
    .filter((a) => a.required)
    .filter((a) => {
      const cur = filled.get(norm(a.name))
      return !cur || isEmptySpecificValue(cur.value)
    })

  if (requiredMissing.length > 0) {
    const maxRetries = 2
    const batchSize = 18

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const stillMissing = aspects
        .filter((a) => a.required)
        .filter((a) => {
          const cur = filled.get(norm(a.name))
          return !cur || isEmptySpecificValue(cur.value)
        })
        .slice(0, batchSize)

      if (!stillMissing.length) break

      const retryAspectsForModel = stillMissing.map((a) => ({
        name: a.name,
        required: !!a.required,
        selectionOnly: a.selectionOnly,
        multi: !!a.multi,
        freeTextAllowed: a.freeTextAllowed,
        options: rankAndLimitOptions(a.values || [], 250),
      }))

      const retryPrompt = `
You are filling ONLY missing REQUIRED eBay item specifics.

Rules:
- Use ONLY the provided aspect names.
- If an aspect has options, choose only from those options.
- Never guess measurements, model numbers, MPN, compatibility, warnings, or origin.
- If the value is not clearly supported by detected facts/OCR/title/description, return empty ("" or []).
- Prefer exact matches from label OCR (numbers/letters) when present.

Category Path:
${category.path}

Title:
${title}

Description:
${description}

Detected facts (JSON):
${JSON.stringify(detected, null, 2)}

Missing required aspects to fill (JSON):
${JSON.stringify(retryAspectsForModel, null, 2)}

Return JSON only:
{
  "final_specifics": [
    { "name": "Aspect Name", "value": "string OR string[]" }
  ]
}
      `.trim()

      try {
        const retryResp = await callOpenAIChat({
          model: 'gpt-5.2',
          response_format: { type: 'json_object' },
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert eBay lister. You ONLY fill missing required aspects with evidence-based values. If unsure, output empty values.',
            },
            { role: 'user', content: retryPrompt },
          ],
        })

        const retryJSON = safeJSON(retryResp?.choices?.[0]?.message?.content || '{}', {
          final_specifics: [],
        })

        const retrySpecifics = Array.isArray(retryJSON.final_specifics) ? retryJSON.final_specifics : []

        for (const s of retrySpecifics) {
          const key = norm(s.name)
          const a = byName.get(key)
          if (!a) continue
          const normalized = normalizeValueForAspect(a, s.value, optionSets.get(key), canonicalValue.get(key))
          if (!normalized.length) continue
          const v = a.multi ? normalized : normalized[0]
          const existing = filled.get(key)
          if (!existing || isEmptySpecificValue(existing.value)) {
            filled.set(key, { name: a.name, value: v })
            mappingLog.push(`Retry(${attempt}) → filled "${a.name}" with ${JSON.stringify(v)}`)
          }
        }
      } catch (e) {
        console.error('[gen] retry-fill required aspects failed', { requestId, attempt })
        break
      }
    }

    finalSpecifics = Array.from(filled.values())
  }

  const finalSpecificsMap = new Map(finalSpecifics.map((s) => [norm(s.name), s]))
  for (const a of aspects) {
    if (!finalSpecificsMap.has(norm(a.name))) {
      finalSpecifics.push({ name: a.name, value: a.multi ? [] : '' })
    }
  }

  const brand = detected.brand || null
  const productName = String(detected.type || detected.style || category.name || detected.model || '').trim()
  const identifiers = detected.model ? [String(detected.model).trim()] : []
  const colors = normalizeStringArray(Array.isArray(detected.colors) ? detected.colors : detected.colors ? [detected.colors] : [])
  const size = String(detected.size || '').trim()
  const materials = normalizeStringArray(Array.isArray(detected.materials) ? detected.materials : detected.materials ? [detected.materials] : [])
  const condition = null

  const fashionPath = norm(category.path)
  const isFashionCategory = ['clothing', 'shoes', 'bags', 'accessories', 'apparel'].some((k) => fashionPath.includes(k))

  const buildPromotedFromReconcile = (list, limit) => {
    if (!Array.isArray(list)) return []
    const out = []
    const seen = new Set()
    for (const item of list) {
      if (out.length >= limit) break
      const aspectName = String(item?.name || '').trim()
      const valueRaw = item?.value
      const value = Array.isArray(valueRaw) ? valueRaw[0] : valueRaw
      const token = String(value || '').trim()
      if (!aspectName || !token) continue
      const optionSet = optionSets.get(norm(aspectName))
      if (!optionSet || optionSet.size === 0) continue
      if (!optionSet.has(norm(token))) continue
      const key = norm(token)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(token)
    }
    return out
  }

  const intentTokens = isFashionCategory ? buildPromotedFromReconcile(recJSON.intent_aspects, 3) : []
  const attributeTokens = isFashionCategory ? buildPromotedFromReconcile(recJSON.attribute_aspects, 2) : []

  const bestColor = (() => {
    const multi = colors.find((c) => norm(c) === 'multicolor')
    return (multi || colors[0] || '').trim()
  })()

  const hasStretch = ['spandex', 'elastane', 'lycra'].some((m) => materials.some((x) => norm(x).includes(m)))

  const promotedTitle = buildPromotedTitle({
    brand,
    productName,
    identifiers,
    meaningTokens,
    intentTokens: isFashionCategory ? intentTokens : [],
    attributeTokens: isFashionCategory ? attributeTokens : [],
    colors,
    sizeToken: size || null,
    condition,
    attributes: hasStretch ? ['Stretch'] : [],
  })

  const sanitizedTitle = sanitizeTitleTokens(promotedTitle.split(/\s+/).filter(Boolean), materials).join(' ').trim()

  const facts = {
    brand,
    product_name: productName,
    identifiers,
    attributes: [...intentTokens, ...(bestColor ? [bestColor] : []), ...(size ? [size] : []), ...(hasStretch ? ['Stretch'] : [])],
    condition,
  }

  const sanitizedFallback = sanitizeTitleTokens(buildFallbackTitle(facts).split(/\s+/).filter(Boolean), materials)
    .join(' ')
    .trim()

  title = validateTitle(sanitizedTitle, { brand, product_name: productName }) ? sanitizedTitle : sanitizedFallback

  if (!category.id || category.id === '0') {
    category = { id: '', name: '', path: '' }
  }

  const payloadOut = {
    title,
    description,
    category,
    category_id: category.id || null,
    category_path: category.id ? category.path || null : null,
    condition_intent,
    category_suggestions: categorySuggestions,
    ebay_category_id: category.id || null,
    ebay_category_name: category.name || null,
    ebay_category_path: category.path || null,
    detected,
    category_specifics_schema: aspects.map((a) => ({
      name: a.name,
      required: !!a.required,
      type: a.type,
      multi: !!a.multi,
      selectionOnly: a.selectionOnly,
      freeTextAllowed: !!a.freeTextAllowed,
      values: a.values ?? [],
    })),
    item_specifics: finalSpecifics.map((s) => {
      const a = aspects.find((x) => norm(x.name) === norm(s.name))
      return {
        name: s.name,
        value: s.value,
        options: a?.values ?? [],
        required: !!a?.required,
        multi: !!a?.multi,
        selectionOnly: !!a?.selectionOnly,
        freeTextAllowed: !!a?.freeTextAllowed,
      }
    }),
    keywords: Array.isArray(visionJSON.keywords) ? visionJSON.keywords : [],
    confidence_score: visionJSON.confidence_score ?? undefined,
    reconcile_notes: recJSON.notes ?? undefined,
    mapping_log: mappingLog,
  }

  return { ok: true, data: payloadOut, error: null, requestId }
}
