import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { RECONCILE_SYSTEM_PROMPT, buildReconcileUserPrompt } from '../lib/prompts/reconcilePrompt.js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const norm = (s: any) => String(s ?? '').toLowerCase().trim();
const tokens = (s: string) => norm(s).split(/[\s\/,&-]+/).filter(Boolean);

function safeJSON<T = any>(txt: string, fallback: T): T {
  try {
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

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

function normalizeStringArray(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
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

function isEmptySpecificValue(v: any): boolean {
  if (Array.isArray(v)) return v.filter((x) => String(x ?? '').trim().length > 0).length === 0;
  return String(v ?? '').trim().length === 0;
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

/* ----------------------------------------
   Synonyms / normalization helpers
-----------------------------------------*/

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

const PATTERN_KEYWORDS: Record<string, string[]> = {
  Floral: ['floral', 'flower', 'botanical'],
  Solid: ['solid', 'plain'],
  Striped: ['stripe', 'striped'],
  Plaid: ['plaid', 'tartan'],
  'Animal Print': ['animal print', 'leopard', 'cheetah', 'zebra', 'snake'],
  Graphic: ['graphic', 'logo', 'print'],
  Quilted: ['quilted'],
};

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

type AspectSchema = {
  name: string;
  required: boolean;
  type: 'SelectionOnly' | 'FreeText' | string;
  multi: boolean;
  selectionOnly: boolean;
  freeTextAllowed: boolean;
  values: string[];
};

function buildSchemaMaps(aspects: AspectSchema[]) {
  const byName = new Map<string, AspectSchema>();
  const optionSets = new Map<string, Set<string>>();
  const canonicalValue = new Map<string, Map<string, string>>();

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
    } else {
      const first = vals[0] ?? '';
      const s = snapOne(first);
      if (s) return [s];
      if (!aspect.freeTextAllowed) return [];
    }
  }

  if (!aspect.freeTextAllowed) return [];

  if (aspect.multi) return dedupeArray(vals).slice(0, 3);
  return vals.length ? [vals[0]] : [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = makeRequestId();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', requestId });

  try {
    const body: any = req.body || {};
    const listing_id = String(body.listing_id || body.listingId || '').trim();
    const category_id = String(body.category_id || body.categoryId || '').trim();
    const category_path = String(body.category_path || body.categoryPath || '').trim();
    const current = body.current || {};

    if (!listing_id) return res.status(400).json({ error: 'Missing listing_id', requestId });
    if (!category_id) return res.status(400).json({ error: 'Missing category_id', requestId });

    const authHeader = String(req.headers.authorization || '').trim();
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized', requestId });

    const userClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const serviceClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const user = authData?.user;
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized', requestId });

    const u = await serviceClient
      .from('users')
      .select('workspace_id')
      .eq('auth_provider_user_id', user.id)
      .maybeSingle();
    if (u.error) return res.status(500).json({ error: 'Internal server error', requestId });

    const userWorkspaceId = String((u.data as any)?.workspace_id || '').trim();
    if (!userWorkspaceId) return res.status(403).json({ error: 'Unauthorized workspace', requestId });

    const listingResp = await serviceClient
      .from('listings')
      .select('id,workspace_id,listing_json,title,description')
      .eq('id', listing_id)
      .maybeSingle();

    if (listingResp.error || !listingResp.data) {
      return res.status(404).json({ error: 'Listing not found', requestId });
    }

    if (String((listingResp.data as any)?.workspace_id || '').trim() !== userWorkspaceId) {
      return res.status(403).json({ error: 'Unauthorized listing', requestId });
    }

    const dbListingJson: any = (listingResp.data as any)?.listing_json || {};

    const title = String(current?.title ?? dbListingJson?.title ?? (listingResp.data as any)?.title ?? '').trim();
    const description = String(current?.description ?? dbListingJson?.description ?? (listingResp.data as any)?.description ?? '').trim();
    const detected = (current?.detected ?? dbListingJson?.detected ?? {}) as any;

    // Fetch new category aspects from our taxonomy proxy
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const ebayApiUrl = `${origin}/api/ebay-categories`;

    let aspects: AspectSchema[] = [];
    try {
      const sp = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCategorySpecifics', categoryId: category_id }),
      });
      if (sp.ok) {
        const data = await sp.json();
        aspects = (data?.aspects ?? []).map((a: any) => ({
          name: a.name,
          required: !!a.required,
          type: a.selectionOnly ? 'SelectionOnly' : 'FreeText',
          multi: !!a.multi,
          selectionOnly: !!a.selectionOnly,
          freeTextAllowed: !!a.freeTextAllowed,
          values: Array.isArray(a.values) ? a.values : [],
        }));
      }
    } catch {
      aspects = [];
    }

    const { byName, optionSets, canonicalValue } = buildSchemaMaps(aspects);

    const optionContext = (() => {
      const pieces: string[] = [
        title,
        description,
        (() => {
          try {
            return JSON.stringify(detected || {});
          } catch {
            return '';
          }
        })(),
      ]
        .filter(Boolean)
        .map(String);
      return pieces.join(' ').toLowerCase();
    })();

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
      options: rankAndLimitOptions(a.values || [], a.required ? 250 : 120),
    }));

    const userPrompt = buildReconcileUserPrompt({
      categoryPath: category_path || category_id,
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
        { role: 'user', content: userPrompt },
      ],
    });

    const recJSON = safeJSON<any>(reconcile.choices?.[0]?.message?.content || '{}', {
      final_specifics: [],
    });

    const aiSpecifics: Array<{ name: string; value: any }> = Array.isArray(recJSON.final_specifics)
      ? recJSON.final_specifics
      : [];

    const mappingLog: string[] = [];

    // Post-validate AI specifics against schema
    const filled = new Map<string, { name: string; value: any }>();
    for (const s of aiSpecifics) {
      const key = norm(s.name);
      const a = byName.get(key);
      if (!a) continue;

      const normalized = normalizeValueForAspect(a, s.value, optionSets.get(key), canonicalValue.get(key));
      if (!normalized.length) {
        mappingLog.push(`AI → rejected or empty for "${a.name}"`);
        continue;
      }
      const v = a.multi ? normalized : normalized[0];
      filled.set(key, { name: a.name, value: v });
      mappingLog.push(`AI → accepted for "${a.name}": ${JSON.stringify(v)}`);
    }

    // Ensure every aspect exists (even if blank)
    for (const a of aspects) {
      const k = norm(a.name);
      if (!filled.has(k)) filled.set(k, { name: a.name, value: a.multi ? [] : '' });
    }

    // Retry-fill missing required aspects (conservative)
    const maxRetries = 2;
    const batchSize = 18;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const stillMissing = aspects
        .filter((a) => a.required)
        .filter((a) => {
          const cur = filled.get(norm(a.name));
          return !cur || isEmptySpecificValue(cur.value);
        })
        .slice(0, batchSize);

      if (!stillMissing.length) break;

      const retryAspectsForModel = stillMissing.map((a) => ({
        name: a.name,
        required: !!a.required,
        selectionOnly: a.selectionOnly,
        multi: !!a.multi,
        freeTextAllowed: a.freeTextAllowed,
        options: rankAndLimitOptions(a.values || [], 300),
      }));

      const retryPrompt = `
You are filling ONLY missing REQUIRED eBay item specifics.

Rules:
- Use ONLY the provided aspect names.
- If an aspect has options, choose only from those options.
- Never guess measurements, model numbers, MPN, compatibility, warnings, or origin.
- If the value is not clearly supported by detected facts/OCR/title/description, return empty ("" or []).

Category Path:
${category_path || category_id}

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
      `.trim();

      const retry = await callOpenAIChat({
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
      });

      const retryJSON = safeJSON<any>(retry?.choices?.[0]?.message?.content || '{}', { final_specifics: [] });
      const retrySpecifics: Array<{ name: string; value: any }> = Array.isArray(retryJSON.final_specifics)
        ? retryJSON.final_specifics
        : [];

      for (const s of retrySpecifics) {
        const key = norm(s.name);
        const a = byName.get(key);
        if (!a) continue;

        const normalized = normalizeValueForAspect(a, s.value, optionSets.get(key), canonicalValue.get(key));
        if (!normalized.length) continue;

        const v = a.multi ? normalized : normalized[0];
        const existing = filled.get(key);
        if (!existing || isEmptySpecificValue(existing.value)) {
          filled.set(key, { name: a.name, value: v });
          mappingLog.push(`Retry(${attempt}) → filled "${a.name}" with ${JSON.stringify(v)}`);
        }
      }
    }

    const finalSpecifics = Array.from(filled.values());

    return res.status(200).json({
      success: true,
      requestId,
      data: {
        category: { id: category_id, path: category_path || '' },
        item_specifics: aspects.map((a) => {
          const cur = filled.get(norm(a.name));
          return {
            name: a.name,
            value: cur ? cur.value : a.multi ? [] : '',
            options: a.values ?? [],
            allOptions: a.values ?? [],
            required: !!a.required,
            multi: !!a.multi,
            selectionOnly: !!a.selectionOnly,
            freeTextAllowed: !!a.freeTextAllowed,
          };
        }),
        mapping_log: mappingLog,
      },
    });
  } catch (err: any) {
    console.error('❌ /api/reconcile-specifics error:', { requestId, err });
    return res.status(500).json({
      error: err?.message || 'Internal server error',
      requestId,
    });
  }
}
