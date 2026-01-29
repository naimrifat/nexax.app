import { RECONCILE_SYSTEM_PROMPT, buildReconcileUserPrompt } from "../lib/prompts/reconcilePrompt.js";
import { optimizeEbayTitle } from "../lib/seo/titleOptimizer.js";
import { buildFallbackTitle } from "../lib/titleBuilder.js";
import { validateTitle } from "../lib/titleValidator.js";
import { sanitizeTitleTokens } from "../lib/titleSanitizer.js";
import { buildPromotedTitle } from "../lib/titlePromotion.js";
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

/* ----------------------------------------
   Request + URL validation helpers
-----------------------------------------*/
function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const norm = (s: any) => String(s ?? '').toLowerCase().trim();
const tokens = (s: string) => norm(s).split(/[\s\/,&-]+/).filter(Boolean);

function isBlobOrObjectUrl(u: string): boolean {
  const s = norm(u);
  return s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('file:');
}

function isHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeStringArray(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function clipInstruction(v: unknown, max: number, label: string): string {
  const s = String(v ?? '').trim();
  if (s.length <= max) return s;
  console.warn('[gen] listing style truncated', { field: label, max });
  return s.slice(0, max);
}

async function fetchWorkspaceListingStyle(params: {
  userClient: any;
  workspaceId: string;
}): Promise<
  | {
      enabled: boolean;
      title_instructions: string;
      description_instructions: string;
      extra_rules: string;
    }
  | null
> {
  const wsId = String(params.workspaceId || '').trim();
  if (!wsId) return null;

  const q = await params.userClient
    .from('workspace_listing_style')
    .select('enabled,title_instructions,description_instructions,extra_rules')
    .eq('workspace_id', wsId)
    .maybeSingle();

  if (q.error) throw q.error;
  const row: any = q.data || null;
  if (!row) return null;

  return {
    enabled: Boolean(row.enabled),
    title_instructions: String(row.title_instructions || ''),
    description_instructions: String(row.description_instructions || ''),
    extra_rules: String(row.extra_rules || ''),
  };
}


/**
 * Cloudinary optimization for vision requests:
 * - downscale to 1024 max dimension (good tradeoff for OCR/details vs tokens)
 * - q_auto and f_auto (lets Cloudinary choose efficient encoding)
 *
 * IMPORTANT: Only apply if it's a Cloudinary URL that includes /upload/
 */
function toOptimizedVisionUrl(url: string): string {
  try {
    const u = url.trim();
    if (!u.includes('cloudinary.com')) return u;
    if (!u.includes('/upload/')) return u;

    // c_limit avoids cropping.
    return u.replace('/upload/', '/upload/w_2048,h_2048,c_limit,q_auto,f_auto/');
  } catch {
    return url;
  }
}

/* ----------------------------------------
   Small helpers
-----------------------------------------*/
function safeJSON<T = any>(txt: string, fallback: T): T {
  try {
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

function normalizeConditionIntent(v: unknown): ConditionIntent {
  const s = String(v ?? '').trim().toUpperCase();
  if (
    s === 'NEW_WITH_TAGS' ||
    s === 'NEW_WITH_BOX' ||
    s === 'NEW_OTHER' ||
    s === 'USED_EXCELLENT' ||
    s === 'USED_GOOD' ||
    s === 'USED_FAIR'
  ) {
    return s as ConditionIntent;
  }
  return 'UNKNOWN';
}


function includesAny(hay: string, needles: string[]) {
  const h = norm(hay);
  return needles.some((n) => h.includes(norm(n)));
}

// Hardened option snapper for selectionOnly aspects (score-based)
function pickBestOption(target: string, options: string[] = []) {
  if (!target) return '';
  if (!options?.length) return target;

  const t = norm(target);

  // 1) exact
  const exact = options.find((o) => norm(o) === t);
  if (exact) return exact;

  // 2) token overlap + begins/contains bonus
  const tt = tokens(t);
  let best = '';
  let bestScore = 0;
  for (const o of options) {
    const on = norm(o);
    const ov = tokens(on);
    const overlap = tt.filter((x) => ov.includes(x)).length;
    const beginsBonus = on.startsWith(t) || t.startsWith(on) ? 1 : 0;
    const containsBonus = on.includes(t) || t.includes(on) ? 0.5 : 0;
    const score = overlap + beginsBonus + containsBonus;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best || '';
}

// infer dept quickly from breadcrumb
function inferDepartmentFromPath(path: string) {
  const p = norm(path);
  if (p.includes('women')) return 'Women';
  if (p.includes('men')) return 'Men';
  if (p.includes('girls')) return 'Girls';
  if (p.includes('boys')) return 'Boys';
  if (p.includes('unisex')) return 'Unisex Adult';
  return '';
}

function inferSizeType({
  size,
  title,
  categoryPath,
}: {
  size?: string;
  title?: string;
  categoryPath?: string;
}) {
  const hay = [size, title, categoryPath].filter(Boolean).join(' ').toLowerCase();
  if (includesAny(hay, ['petite'])) return 'Petite';
  if (includesAny(hay, ['tall', 'long'])) return 'Tall';
  if (includesAny(hay, ['plus', 'extended', 'big & tall', 'big tall'])) return 'Plus';
  return 'Regular';
}

/* ----------------------------------------
   Synonyms / normalization helpers
-----------------------------------------*/

// Value-level synonym tables keyed by canonical aspect category
const VALUE_SYNONYMS: Record<string, Record<string, string>> = {
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
};

// Simple color canonicalization table
const COLOR_CANON: Record<string, string> = {
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
};

// Pattern keyword mapping
const PATTERN_KEYWORDS: Record<string, string[]> = {
  Floral: ['floral', 'flower', 'botanical'],
  Solid: ['solid', 'plain'],
  Striped: ['stripe', 'striped'],
  Plaid: ['plaid', 'tartan'],
  'Animal Print': ['animal print', 'leopard', 'cheetah', 'zebra', 'snake'],
  Graphic: ['graphic', 'logo', 'print'],
  Quilted: ['quilted'],
};

// Map raw aspect name to a canonical key used in the tables above
function canonicalAspectKey(aspectName: string): string | null {
  const n = norm(aspectName);
  if (n.includes('color') || n.includes('colour')) return 'Color';
  if (n.includes('material')) return 'Material';
  if (n === 'department') return 'Department';
  if (n.includes('pattern')) return 'Pattern';
  return null;
}

function unifySynonyms(aspectName: string, raw: string): string {
  const key = canonicalAspectKey(aspectName);
  if (!key) return raw;
  const table = VALUE_SYNONYMS[key];
  if (!table) return raw;
  const n = norm(raw);
  for (const from in table) {
    if (n === norm(from)) return table[from];
  }
  return raw;
}

function normalizeColor(raw: string): string {
  const n = norm(raw);
  return COLOR_CANON[n] || raw;
}

function resolvePattern(raw: string): string {
  const r = norm(raw);
  for (const pattern in PATTERN_KEYWORDS) {
    if (PATTERN_KEYWORDS[pattern].some((k) => r.includes(k))) {
      return pattern;
    }
  }
  return raw;
}

function dedupeArray<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const key = norm(String(v));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/* ----------------------------------------
   Types + schema utilities
-----------------------------------------*/
type AspectSchema = {
  name: string;
  required: boolean;
  type: 'SelectionOnly' | 'FreeText' | string;
  multi: boolean;
  selectionOnly: boolean;
  freeTextAllowed: boolean;
  values: string[];
};

// Typed model outputs (prevents TS {} / never errors)
type ConditionIntent =
  | 'NEW_WITH_TAGS'
  | 'NEW_WITH_BOX'
  | 'NEW_OTHER'
  | 'USED_EXCELLENT'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'UNKNOWN';

type VisionJSON = {
  condition_intent?: ConditionIntent | string;
  condition_reason?: string;
  detected?: {
    department?: string;
    sizeTypeHint?: string;
    size?: string;
    brand?: string;
    colors?: any;
    materials?: any;
    outerShellMaterial?: string;
    liningMaterial?: string;
    insulationMaterial?: string;
    style?: string;
    type?: string;
    lengthHint?: string;
    closure?: string;
    features?: any;
    pattern?: string;
    theme?: any;
    countryOfOrigin?: string;
    model?: string;
    sleeveLength?: string;
    fit?: string;
    pocketType?: string;
    frontType?: string;
    fabricType?: string;
    occasion?: string;
    [k: string]: any;
  };
  title?: string;
  description?: string;
  meaning_tokens?: string[];
  keywords?: any;
  confidence_score?: number;
  [k: string]: any;
};

type ReconcileJSON = {
  final_specifics?: Array<{ name: string; value: any }>;
  intent_aspects?: Array<{ name: string; value: any }>;
  attribute_aspects?: Array<{ name: string; value: any }>;
  notes?: any;
  [k: string]: any;
};

function buildSchemaMaps(aspects: AspectSchema[]) {
  const byName = new Map<string, AspectSchema>();
  const optionSets = new Map<string, Set<string>>();
  const canonicalValue = new Map<string, Map<string, string>>(); // per-aspect norm(value) -> canonical

  for (const a of aspects) {
    const key = norm(a.name);
    byName.set(key, a);

    const set = new Set<string>();
    const canonMap = new Map<string, string>();
    for (const v of a.values || []) {
      const nv = norm(v);
      set.add(nv);
      canonMap.set(nv, v);
    }
    optionSets.set(key, set);
    canonicalValue.set(key, canonMap);
  }
  return { byName, optionSets, canonicalValue };
}

// Preprocess a single raw value based on aspect semantics (color/material/pattern/etc.)
function preprocessValue(aspect: AspectSchema, raw: string): string {
  let v = raw;
  const key = canonicalAspectKey(aspect.name);
  if (!key) return v;

  if (key === 'Color') {
    v = unifySynonyms(aspect.name, v);
    v = normalizeColor(v);
  } else if (key === 'Material' || key === 'Department') {
    v = unifySynonyms(aspect.name, v);
  } else if (key === 'Pattern') {
    v = resolvePattern(v);
  }
  return v;
}

function normalizeValueForAspect(
  aspect: AspectSchema,
  raw: any,
  optionSet: Set<string> | undefined,
  canonMap: Map<string, string> | undefined
) {
  const toArray = (v: any) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

  // normalize each candidate through synonyms/color/pattern resolver
  const vals = toArray(raw)
    .map(String)
    .filter(Boolean)
    .map((v) => preprocessValue(aspect, v));

  const hasOptions = !!(aspect.values && aspect.values.length);
  const snapOne = (v: string): string | '' => {
    if (!hasOptions || !optionSet || !canonMap) return '';
    const nv = norm(v);
    if (optionSet.has(nv)) return canonMap.get(nv)!;
    const snapped = pickBestOption(v, aspect.values);
    return snapped || '';
  };

  // 1) Try to express everything in terms of allowed options
  if (hasOptions) {
    if (aspect.multi) {
      const snapped: string[] = [];
      for (const v of vals) {
        const s = snapOne(v);
        if (s) snapped.push(s);
      }
      const deduped = dedupeArray(snapped).slice(0, 3);
      if (deduped.length) return deduped;
      if (!aspect.freeTextAllowed) return [];
      // fall through to free-text handling
    } else {
      const first = vals[0] ?? '';
      const s = snapOne(first);
      if (s) return [s];
      if (!aspect.freeTextAllowed) return [];
      // fall through to free-text handling
    }
  }

  // 2) Fallback: use cleaned raw values as free text (only if allowed)
  if (!aspect.freeTextAllowed) {
    return [];
  }

  if (aspect.multi) {
    return dedupeArray(vals).slice(0, 3);
  } else {
    return vals.length ? [vals[0]] : [];
  }
}

/* ----------------------------------------
   OpenAI helpers
-----------------------------------------*/
async function callOpenAIChat(body: any) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenAI API error: ${r.status} ${await r.text()}`);
  return r.json();
}

/* ----------------------------------------
   MAIN HANDLER
-----------------------------------------*/
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', requestId });

  try {
    const body: any = req.body || {};
    const { session_id } = body;

    // Resolve workspace_id for style settings (optional)
    const workspace_id = String(body.workspace_id || body.workspaceId || '').trim();
    const authHeader = String(req.headers.authorization || '').trim();

    // Tenancy guard: require auth + verify workspace ownership
    if (!workspace_id) {
      return res.status(400).json({ error: 'Missing workspace_id', requestId });
    }

    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    const userClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const serviceClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const user = authData?.user;

    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized', requestId });
    }

    const u = await serviceClient
      .from('users')
      .select('workspace_id')
      .eq('auth_provider_user_id', user.id)
      .maybeSingle();

    if (u.error) {
      console.error('[gen] failed to resolve user workspace', { requestId, message: String(u.error.message || '') });
      return res.status(500).json({ error: 'Internal server error', requestId });
    }

    const userWorkspaceId = String((u.data as any)?.workspace_id || '').trim();

    if (!userWorkspaceId || userWorkspaceId !== workspace_id) {
      console.error('[gen] unauthorized workspace', {
        requestId,
        body_workspace_id: workspace_id,
        user_workspace_id: userWorkspaceId,
      });
      return res.status(403).json({ error: 'Unauthorized workspace.', requestId });
    }

    // Normalize images from common keys (be permissive, validate strictly)
    const rawImages = body.images ?? body.image_urls ?? [];
    const incoming = normalizeStringArray(rawImages);

    const blobOrObject = incoming.filter(isBlobOrObjectUrl);
    const nonHttp = incoming.filter((u) => !isBlobOrObjectUrl(u) && !isHttpUrl(u));
    const hostedImages = incoming.filter((u) => !isBlobOrObjectUrl(u) && isHttpUrl(u)).slice(0, 23);

    // Apply Cloudinary optimizations for vision (reduces tokens / bandwidth)
    const visionImages = hostedImages.map(toOptimizedVisionUrl);

    // Observability
    console.log('[analyze-listing]', {
      requestId,
      session_id,
      imagesReceivedCount: incoming.length,
      imagesValidCount: hostedImages.length,
      imagesVisionCount: visionImages.length,
      blobOrObjectCount: blobOrObject.length,
      nonHttpCount: nonHttp.length,
      sampleInvalidBlobOrObject: blobOrObject.slice(0, 2),
      sampleInvalidNonHttp: nonHttp.slice(0, 2),
      sampleValid: hostedImages.slice(0, 2),
      sampleVision: visionImages.slice(0, 2),
    });

    if (!incoming.length) {
      return res.status(400).json({ error: 'No images provided', requestId });
    }
    if (blobOrObject.length > 0) {
      return res.status(400).json({
        error:
          'Invalid image URL(s) received (blob/data/file URLs are not allowed). Upload images to Cloudinary and send the hosted URLs.',
        requestId,
        imageDiagnostics: {
          receivedCount: incoming.length,
          validCount: hostedImages.length,
          blobOrObjectCount: blobOrObject.length,
          nonHttpCount: nonHttp.length,
          sampleBlobOrObject: blobOrObject.slice(0, 2),
        },
      });
    }
    if (nonHttp.length > 0) {
      return res.status(400).json({
        error: 'Invalid image URL(s) received (must be http/https).',
        requestId,
        imageDiagnostics: {
          receivedCount: incoming.length,
          validCount: hostedImages.length,
          nonHttpCount: nonHttp.length,
          sampleNonHttp: nonHttp.slice(0, 2),
        },
      });
    }
    if (!hostedImages.length) {
      return res.status(400).json({
        error: 'No valid hosted image URLs provided.',
        requestId,
      });
    }

    /* ----------------------------------------
       Stage A: Vision analysis (broad)
       IMPORTANT CHANGE: send URLs directly to OpenAI (no base64 download)
    -----------------------------------------*/

    // Build seller-style instruction block for the vision model
    // IMPORTANT: only apply workspace settings when enabled === true.
    let listingStyleInstructions = '';

    try {
      if (workspace_id) {
        const wsStyle = await fetchWorkspaceListingStyle({ userClient, workspaceId: workspace_id });
        if (wsStyle?.enabled) {
          console.log('[gen] using listing style', { workspace_id, enabled: true });

          const title = clipInstruction(wsStyle.title_instructions, 800, 'title_instructions');
          const desc = clipInstruction(wsStyle.description_instructions, 1200, 'description_instructions');
          const extra = clipInstruction(wsStyle.extra_rules, 800, 'extra_rules');

          if (title || desc || extra) {
            const lines: string[] = [];
            lines.push('STYLE (apply ONLY to writing style/structure; never invent facts; never include secrets):');

            if (title) lines.push('STYLE_TITLE_INSTRUCTIONS:\n' + title);
            if (desc) lines.push('STYLE_DESCRIPTION_INSTRUCTIONS:\n' + desc);
            if (extra) lines.push('STYLE_EXTRA_RULES:\n' + extra);

            listingStyleInstructions = lines.join('\n\n');
          }
        }
      }
    } catch (e: any) {
      console.error('[gen] failed to load listing style', { requestId, workspace_id, message: String(e?.message || '') });
    }


    const vision = await callOpenAIChat({
      model: 'gpt-5.2',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert eBay lister. Read ALL photos together. Extract concrete facts (brand, size, color, materials, construction, features, closures, themes, patterns, lengths, fits, etc.). Return structured JSON only.',
        },
        {
          role: 'user',
          content: [
            ...visionImages.map((url) => ({
              type: 'image_url' as const,
              image_url: { url, detail: 'high' as const },
            })),
            {
              type: 'text' as const,
              text: `
${listingStyleInstructions ? listingStyleInstructions + '\n\n' : ''}You must return a single JSON object with this structure:

{
  "title": "... (<=80 chars, follow seller rules if provided)",
  "description": "... (follow seller rules if provided)",
  "meaning_tokens": ["... up to 3 short phrases ONLY if clearly readable on item (team/band/school/character/brand text). Exclude sizes, colors, materials."],
  "condition_intent": "NEW_WITH_TAGS|NEW_WITH_BOX|NEW_OTHER|USED_EXCELLENT|USED_GOOD|USED_FAIR|UNKNOWN",
  "condition_reason": "... short reason (for server logs only)",
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
    "closure": "Zip|Buttons|Buckle|Pullover|Hook & Eye|... (or null)",
    "features": ["Hood","Pockets","Water Resistant","Stretch", "..."],
    "pocketType": "Cargo|Slash|Patch|Welt|... if visible",
    "frontType": "Flat Front|Pleated|... if visible",
    "fabricType": "Canvas|Denim|Fleece|Knit|... if visible",
    "pattern": "Solid|Floral|Plaid|Striped|Animal Print|Logo|Graphic|Quilted|... (best guess)",
    "theme": ["Outdoor","Sports","Y2K","80s","90s","Animals","Floral", ...],
    "occasion": "Casual|Workwear|Activewear|... if visible",
    "countryOfOrigin": "... if visible",
    "model": "... if visible",
    "sleeveLength": "Short|3/4|Long|Sleeveless|... if visible",
    "fit": "Regular|Slim|Relaxed|Classic|... if visible",
    "sizeTypeHint": "Regular|Plus|Petite|Tall|Big & Tall if visible"
  },
  "keywords": ["... (follow seller keyword rules if provided)"]
}

Always obey the visual facts in the images and eBay-style accuracy first. Seller instructions are for *style and structure*, not for making up untrue details.

For meaning_tokens:
- Only include words/phrases that are clearly readable on the item itself (e.g., school/team names, band names, mascot text, brand text, trademark text).
- Prefer longer exact phrases if visible (e.g., "NOTRE DAME FIGHTING IRISH").
- Do NOT include sizes, colors, materials, prices, or generic descriptors.
- If nothing readable is visible, return an empty array.

For condition_intent:
- Choose NEW_WITH_TAGS only if retail tags are clearly visible.
- Choose NEW_WITH_BOX only if a retail box is clearly visible (e.g., shoes with box).
- Choose NEW_OTHER if item appears new/unused but tags/box aren't clearly visible.
- Choose USED_EXCELLENT/USED_GOOD/USED_FAIR based on visible wear.
- If unclear, choose UNKNOWN.
condition_reason should be a short phrase like "tags visible" or "light wear".

For pocketType/frontType/fabricType/occasion:
- Only include if clearly visible or explicitly shown on labels/tags.
- Otherwise return null or omit.
`,
            },
          ],
        },
      ],
    });

    const visionJSON = safeJSON<VisionJSON>(vision.choices?.[0]?.message?.content || '{}', {
      detected: {},
      title: '',
      description: '',
      keywords: [],
      condition_intent: 'UNKNOWN',
      condition_reason: '',
    });

    const detected = (visionJSON.detected || {}) as NonNullable<VisionJSON['detected']>;
    let title = visionJSON.title || '';
    const description = visionJSON.description || '';

    const condition_intent = normalizeConditionIntent((visionJSON as any).condition_intent);
    const condition_reason = String((visionJSON as any).condition_reason || '').trim().slice(0, 200);

    if (condition_intent && condition_intent !== 'UNKNOWN') {
      console.log('[gen] condition intent', { workspace_id, intent: condition_intent });
      // Do not log condition_reason content; it can include sensitive text.
    }


    // coarse, model-independent inferences
    const categoryGuessingText = `${title}\n${description}`;
    const department = detected.department || inferDepartmentFromPath(categoryGuessingText);
    const sizeType =
      detected.sizeTypeHint ||
      inferSizeType({
        size: detected.size,
        title,
        categoryPath: categoryGuessingText,
      });

    /* ----------------------------------------
       eBay: category suggestion + aspects
    -----------------------------------------*/
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const ebayApiUrl = `${origin}/api/ebay-categories`;

    // Suggest category
    let category = {
      id: '11450',
      name: 'Clothing, Shoes & Accessories',
      path: 'Clothing, Shoes & Accessories',
    };
    let categorySuggestions: any[] = [];

    try {
      const catResp = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getSuggestedCategories',
          title,
          keywords: Array.isArray(visionJSON.keywords) ? visionJSON.keywords : [],
        }),
      });

      if (catResp.ok) {
        const catData = await catResp.json();
        category = {
          id: catData.categoryId || category.id,
          name: catData.categoryName || category.name,
          path: catData.categoryPath || catData.categoryName || category.path,
        };
        categorySuggestions = (catData.suggestions || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          path: s.path || s.name,
        }));
      }
    } catch {
      // keep defaults
    }

    const optimized = optimizeEbayTitle({ rawTitle: title, categoryPath: category.path, detected });
    title = optimized.title || title;

    // Pull aspects for the chosen category
    let aspects: AspectSchema[] = [];
    try {
      const sp = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCategorySpecifics', categoryId: category.id }),
      });
      if (sp.ok) {
        const data = await sp.json();
        aspects = (data?.aspects ?? []).map((a: any) => ({
          name: a.name,
          required: !!a.required,
          type: a.type,
          multi: !!a.multi,
          selectionOnly: a.type === 'SelectionOnly',
          freeTextAllowed: a.type !== 'SelectionOnly',
          values: Array.isArray(a.values) ? a.values : [],
        }));
      }
    } catch {
      aspects = [];
    }

    const meaningTokens = (() => {
      const v = (visionJSON as any)?.meaning_tokens;
      const fromVision = normalizeStringArray(Array.isArray(v) ? v : v ? [v] : []);
      const extraFields = [
        (detected as any).graphicText,
        (detected as any).printText,
        (detected as any).detectedText,
        (detected as any).logoText,
        (detected as any).teamName,
        (detected as any).bandName,
        (detected as any).franchiseName,
        (detected as any).brandText,
      ];
      const fromDetected = normalizeStringArray(
        extraFields.flatMap((val) => (Array.isArray(val) ? val : val ? [val] : []))
      );
      return dedupeArray([...fromVision, ...fromDetected]);
    })();

    // Build fast lookup maps for schema enforcement
    const { byName, optionSets, canonicalValue } = buildSchemaMaps(aspects);

    /* ----------------------------------------
       Stage B: Reconcile to eBay aspects (AI guided)
    -----------------------------------------*/
    const getAspectOptionsCap = (name: string): number => {
      const n = norm(name);
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
        return 200;
      }
      return 150;
    };

    const buildOptionContext = () => {
      const pieces: string[] = [
        title,
        description,
        detected.brand,
        detected.type,
        detected.style,
        detected.pattern,
        Array.isArray(detected.theme) ? detected.theme.join(' ') : detected.theme,
        Array.isArray(detected.features) ? detected.features.join(' ') : detected.features,
        Array.isArray(detected.colors) ? detected.colors.join(' ') : detected.colors,
        detected.size,
        detected.model,
        meaningTokens.join(' '),
      ].filter(Boolean).map(String);
      return pieces.join(' ').toLowerCase();
    };

    const optionContext = buildOptionContext();

    const rankAndLimitOptions = (options: string[], max: number): string[] => {
      if (!Array.isArray(options)) return [];
      if (options.length <= max) return options;
      const scored = options.map((opt, idx) => {
        const clean = String(opt || '').trim();
        const lower = clean.toLowerCase();
        if (!clean) return { opt: clean, score: -1, idx };
        const overlap = tokens(lower).filter((t) => optionContext.includes(t)).length;
        const containsBonus = optionContext.includes(lower) ? 2 : 0;
        return { opt: clean, score: overlap + containsBonus, idx };
      });
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.idx - b.idx;
      });
      return scored.slice(0, max).map((s) => s.opt).filter(Boolean);
    };

    const aspectsForModel = aspects.map((a) => ({
      name: a.name,
      required: !!a.required,
      selectionOnly: a.selectionOnly,
      multi: !!a.multi,
      freeTextAllowed: a.freeTextAllowed,
      options: rankAndLimitOptions(a.values || [], getAspectOptionsCap(a.name)),
    }));

    const userPrompt = buildReconcileUserPrompt({
      categoryPath: category.path,
      title,
      description,
      detected,
      aspectsForModel,
    });

    const reconcile = await callOpenAIChat({
      model: 'gpt-5.2',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: RECONCILE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        },
      ],
    });

    const recJSON = safeJSON<ReconcileJSON>(reconcile.choices?.[0]?.message?.content || '{}', {
      final_specifics: [],
    });

    let aiSpecifics: Array<{ name: string; value: any }> = Array.isArray(recJSON.final_specifics)
      ? recJSON.final_specifics
      : [];

    // --- Post-validate AI specifics against schema (strict) ---
    const mappingLog: string[] = [];
    const sanitizedSpecifics: Array<{
      name: string;
      value: string | string[];
      source: 'ai' | 'fallback';
    }> = [];

    for (const s of aiSpecifics) {
      const key = norm(s.name);
      const a = byName.get(key);
      if (!a) continue;

      const normalized = normalizeValueForAspect(a, s.value, optionSets.get(key), canonicalValue.get(key));

      if (!normalized.length) {
        mappingLog.push(`AI → rejected or empty for "${a.name}"`);
        sanitizedSpecifics.push({ name: a.name, value: a.multi ? [] : '', source: 'ai' });
      } else {
        const v = a.multi ? normalized : normalized[0];
        mappingLog.push(`AI → accepted for "${a.name}": ${JSON.stringify(v)}`);
        sanitizedSpecifics.push({ name: a.name, value: v, source: 'ai' });
      }
    }

    let finalSpecifics: Array<{ name: string; value: any }> = sanitizedSpecifics.map(({ name, value }) => ({
      name,
      value,
    }));

    // --- Gap fill (heuristics) ONLY where empty (esp. required) ---
    const filled = new Map(finalSpecifics.map((s) => [norm(s.name), s]));

    for (const a of aspects) {
      const k = norm(a.name);
      const existing = filled.get(k);
      const isEmpty =
        !existing ||
        (Array.isArray(existing.value) ? existing.value.length === 0 : !String(existing.value || '').trim());

      if (!isEmpty) continue;

      const td = title + description;
      const n = norm(a.name);
      let guess: any = '';

      if (n.includes('brand')) guess = detected.brand || '';
      else if (n === 'department') guess = department;
      else if (n.includes('size type')) guess = sizeType;
      else if (n === 'size' || n.includes('waist') || n.includes('inseam')) guess = detected.size || '';
      else if (n.includes('color') || n.includes('colour'))
        guess = (Array.isArray(detected.colors) ? detected.colors[0] : detected.colors) || '';
      else if (n.includes('outer') && n.includes('material'))
        guess = detected.outerShellMaterial || (Array.isArray(detected.materials) ? detected.materials?.[0] : '') || '';
      else if (n.includes('lining') && n.includes('material')) guess = detected.liningMaterial || '';
      else if (n.includes('insulation') && n.includes('material'))
        guess = detected.insulationMaterial || (includesAny(td, ['puffer', 'down']) ? 'Down' : '');
      else if (n === 'style') guess = detected.style || '';
      else if (n === 'type') guess = detected.type || '';
      else if (n.includes('pattern')) guess = detected.pattern || '';
      else if (n.includes('pocket type')) guess = (detected as any).pocketType || '';
      else if (n.includes('front type')) guess = (detected as any).frontType || '';
      else if (n.includes('fabric type')) guess = (detected as any).fabricType || '';
      else if (n.includes('occasion')) guess = (detected as any).occasion || '';
      else if (n.includes('length')) {
        const h = norm(detected.lengthHint || '');
        if (h.includes('maxi') || h.includes('long') || h.includes('ankle')) guess = 'Long';
        else if (h.includes('midi') || h.includes('mid')) guess = 'Midi';
        else if (h.includes('knee')) guess = 'Knee Length';
        else if (h.includes('short') || h.includes('hip') || h.includes('cropped')) guess = 'Short';
      } else if (n.includes('closure')) guess = detected.closure || (includesAny(td, ['zip', 'zipper']) ? 'Zip' : '');
      else if (n.includes('theme'))
        guess = Array.isArray(detected.theme) ? detected.theme : detected.theme ? [detected.theme] : [];
      else if (n.includes('features'))
        guess = Array.isArray(detected.features) ? detected.features : detected.features ? [detected.features] : [];
      else if (n.includes('country') && n.includes('origin')) guess = detected.countryOfOrigin || '';
      else if (n.includes('model')) guess = detected.model || '';
      else if (n.includes('sleeve') && n.includes('length')) guess = detected.sleeveLength || '';
      else if (n === 'fit') guess = detected.fit || '';

      const snappedArr = normalizeValueForAspect(a, guess, optionSets.get(k), canonicalValue.get(k));

      if (snappedArr.length) {
        const v = a.multi ? snappedArr : snappedArr[0];
        filled.set(k, { name: a.name, value: v });
        mappingLog.push(`Heuristic → filled "${a.name}" with ${JSON.stringify(v)}`);
      } else {
        filled.set(k, { name: a.name, value: a.multi ? [] : '' });
      }
    }

    finalSpecifics = Array.from(filled.values());

    // Ensure every aspect is present (even if empty) so UI can render all rows
    const finalSpecificsMap = new Map(finalSpecifics.map((s) => [norm(s.name), s]));
    for (const a of aspects) {
      if (!finalSpecificsMap.has(norm(a.name))) {
        finalSpecifics.push({ name: a.name, value: a.multi ? [] : '' });
      }
    }

    // Final title pass (deterministic, schema-backed)
    const brand = detected.brand || null;
    const productName = String(detected.type || detected.style || category.name || detected.model || '').trim();
    const identifiers = detected.model ? [String(detected.model).trim()] : [];
    const colors = normalizeStringArray(Array.isArray(detected.colors) ? detected.colors : detected.colors ? [detected.colors] : []);
    const size = String(detected.size || '').trim();
    const materials = normalizeStringArray(Array.isArray(detected.materials) ? detected.materials : detected.materials ? [detected.materials] : []);
    const condition = null;

    const fashionPath = norm(category.path);
    const isFashionCategory = ['clothing', 'shoes', 'bags', 'accessories', 'apparel'].some((k) => fashionPath.includes(k));

    const buildPromotedFromReconcile = (
      list: Array<{ name: string; value: any }> | undefined,
      limit: number
    ): string[] => {
      if (!Array.isArray(list)) return [];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const item of list) {
        if (out.length >= limit) break;
        const aspectName = String(item?.name || '').trim();
        const valueRaw = item?.value;
        const value = Array.isArray(valueRaw) ? valueRaw[0] : valueRaw;
        const token = String(value || '').trim();
        if (!aspectName || !token) continue;
        const optionSet = optionSets.get(norm(aspectName));
        if (!optionSet || optionSet.size === 0) continue;
        if (!optionSet.has(norm(token))) continue;
        const key = norm(token);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(token);
      }
      return out;
    };

    const intentTokens = isFashionCategory ? buildPromotedFromReconcile(recJSON.intent_aspects, 3) : [];
    const attributeTokens = isFashionCategory ? buildPromotedFromReconcile(recJSON.attribute_aspects, 2) : [];

    const bestColor = (() => {
      const multi = colors.find((c) => norm(c) === 'multicolor');
      return (multi || colors[0] || '').trim();
    })();

    const hasStretch = ['spandex', 'elastane', 'lycra'].some((m) => materials.some((x) => norm(x).includes(m)));

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
    });

    const sanitizedTitle = sanitizeTitleTokens(promotedTitle.split(/\s+/).filter(Boolean), materials).join(' ').trim();

    const facts = {
      brand,
      product_name: productName,
      identifiers,
      attributes: [...intentTokens, ...(bestColor ? [bestColor] : []), ...(size ? [size] : []), ...(hasStretch ? ['Stretch'] : [])],
      condition,
    };

    const sanitizedFallback = sanitizeTitleTokens(buildFallbackTitle(facts).split(/\s+/).filter(Boolean), materials)
      .join(' ')
      .trim();

    title = validateTitle(sanitizedTitle, { brand, product_name: productName }) ? sanitizedTitle : sanitizedFallback;

    // Build final payload
    const payload = {
      title,
      description,
      category,
      condition_intent,
      // condition_reason is for server logs only; do not return to client.
      category_suggestions: categorySuggestions,
      ebay_category_id: category.id,
      ebay_category_name: category.name,
      ebay_category_path: category.path,
      detected,
      category_specifics_schema: aspects.map((a) => ({
        name: a.name,
        required: !!a.required,
        type: a.type,
        multi: !!a.multi,
        selectionOnly: a.selectionOnly,
        freeTextAllowed: a.freeTextAllowed,
        values: a.values ?? [],
      })),
      item_specifics: finalSpecifics.map((s) => {
        const a = aspects.find((x) => norm(x.name) === norm(s.name));
        return {
          name: s.name,
          value: s.value,
          options: a?.values ?? [],
          required: !!a?.required,
          multi: !!a?.multi,
          selectionOnly: !!a?.selectionOnly,
          freeTextAllowed: !!a?.freeTextAllowed,
        };
      }),
      keywords: Array.isArray(visionJSON.keywords) ? visionJSON.keywords : [],
      confidence_score: visionJSON.confidence_score ?? undefined,
      reconcile_notes: recJSON.notes ?? undefined,
      mapping_log: mappingLog,
    };

    return res.status(200).json({
      success: true,
      requestId,
      data: payload,
      images_processed: visionImages.length,
      session_id,
    });
  } catch (err: any) {
    console.error('❌ /api/analyze-listing error:', { requestId, err });
    return res.status(500).json({
      error: err?.message || 'Internal server error',
      requestId,
    });
  }
}
