// api/analyze-listing.ts
import { RECONCILE_SYSTEM_PROMPT, buildReconcileUserPrompt } from './prompts/reconcilePrompt.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

/* ----------------------------------------
   Small helpers
-----------------------------------------*/
const norm = (s: any) => String(s ?? '').toLowerCase().trim();
const tokens = (s: string) => norm(s).split(/[\s\/,&-]+/).filter(Boolean);

function safeJSON<T = any>(txt: string, fallback: T): T {
  try {
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
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
    '100% acrylic': 'Acrylic',
    'Elastane': 'Spandex',
    'Genuine Leather':'Leather',
    'Lycra': 'Spandex',
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

// Clean up raw material strings so they match dropdown options better
function normalizeMaterialText(raw: string): string {
  let v = raw;

  // strip common label prefixes
  v = v.replace(/^(shell|lining|body|fabric|material):?\s*/i, '');

  // remove percentage prefixes like "100% " or "60% "
  v = v.replace(/\b\d{1,3}%\s*/g, '');

  // collapse slashes "Cotton/Polyester" -> "Cotton Polyester"
  v = v.replace(/\s*\/\s*/g, ' ');

  // normalize spacing
  v = v.replace(/\s+/g, ' ').trim();

  return v;
}

function dedupeArray<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  ...
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

function preprocessValue(aspect: AspectSchema, raw: string): string {
  let v = raw;
  const key = canonicalAspectKey(aspect.name);
  if (!key) return v;

  if (key === 'Color') {
    v = unifySynonyms(aspect.name, v);
    v = normalizeColor(v);
  } else if (key === 'Material') {
    // strip things like "Shell: 100% Acrylic" -> "Acrylic"
    v = normalizeMaterialText(v);
    v = unifySynonyms(aspect.name, v);
  } else if (key === 'Department') {
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
      // if nothing snapped and free text is allowed, we MAY fall through to raw text
      if (!aspect.freeTextAllowed) return [];
      // otherwise continue to raw free-text handling below
    } else {
      const first = vals[0] ?? '';
      const s = snapOne(first);
      if (s) return [s];
      if (!aspect.freeTextAllowed) return [];
      // otherwise continue to raw free-text handling below
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { images, session_id } = req.body;
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    // 1) Download images (<=12) and convert to base64
    const base64Images = await Promise.all(
      images.slice(0, 12).map(async (url: string) => {
        const optimizedUrl = url.includes('cloudinary.com')
          ? url.replace('/upload/', '/upload/w_1024,h_1024,c_limit,q_auto,f_jpg/')
          : url;
        const resp = await fetch(optimizedUrl);
        if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        const mimeType = resp.headers.get('content-type') || 'image/jpeg';
        return `data:${mimeType};base64,${base64}`;
      })
    );

    /* ----------------------------------------
       Stage A: Vision analysis (broad)
    -----------------------------------------*/
    const vision = await callOpenAIChat({
      model: 'gpt-5.1',
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
            ...base64Images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: img, detail: 'low' as const },
            })),
            {
              type: 'text' as const,
              text: `Return JSON like:
{
  "title": "... (<=80 chars)",
  "description": "...",
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
    "pattern": "Solid|Floral|Plaid|Striped|Animal Print|Logo|Graphic|Quilted|... (best guess)`,
            },
          ],
        },
      ],
    });

    const visionJSON = safeJSON(vision.choices?.[0]?.message?.content || '{}', {});
    const detected = visionJSON.detected || {};
    const title = visionJSON.title || '';
    const description = visionJSON.description || '';

    // coarse, model-independent inferences
    const categoryGuessingText = `${title}\n${description}`;
    const department =
      detected.department || inferDepartmentFromPath(categoryGuessingText);
    const sizeType = detected.sizeTypeHint || inferSizeType({
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
          keywords: visionJSON.keywords || [],
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

    // Build fast lookup maps for schema enforcement
    const { byName, optionSets, canonicalValue } = buildSchemaMaps(aspects);

    /* ----------------------------------------
       Stage B: Reconcile to eBay aspects (AI guided)
-----------------------------------------*/
    const aspectsForModel = aspects.map((a) => ({
      name: a.name,
      required: !!a.required,
      selectionOnly: a.selectionOnly,
      multi: !!a.multi,
      freeTextAllowed: a.freeTextAllowed,
      options: (a.values || []).slice(0, 150), // cap for tokens
    }));

    const userPrompt = buildReconcileUserPrompt({
      categoryPath: category.path,
      title,
      description,
      detected,
      aspectsForModel,
    });

    const reconcile = await callOpenAIChat({
      model: 'gpt-5.1',
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

    const recJSON = safeJSON(reconcile.choices?.[0]?.message?.content || '{}', {});
    let aiSpecifics: Array<{ name: string; value: any }> =
      Array.isArray(recJSON.final_specifics) ? recJSON.final_specifics : [];

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

      const normalized = normalizeValueForAspect(
        a,
        s.value,
        optionSets.get(key),
        canonicalValue.get(key)
      );

      if (!normalized.length) {
        mappingLog.push(`AI → rejected or empty for "${a.name}"`);
        sanitizedSpecifics.push({
          name: a.name,
          value: a.multi ? [] : '',
          source: 'ai',
        });
      } else {
        const v = a.multi ? normalized : normalized[0];
        mappingLog.push(`AI → accepted for "${a.name}": ${JSON.stringify(v)}`);
        sanitizedSpecifics.push({ name: a.name, value: v, source: 'ai' });
      }
    }

    let finalSpecifics: Array<{ name: string; value: any }> =
      sanitizedSpecifics.map(({ name, value }) => ({ name, value }));

    // --- Gap fill (heuristics) ONLY where empty (esp. required) ---
    const filled = new Map(finalSpecifics.map((s) => [norm(s.name), s]));

    for (const a of aspects) {
      const k = norm(a.name);
      const existing = filled.get(k);
      const isEmpty =
        !existing ||
        (Array.isArray(existing.value)
          ? existing.value.length === 0
          : !String(existing.value || '').trim());

      if (!isEmpty) continue;

      const options: string[] = a.values ?? [];
      let guess: any = '';

      const td = title + description;
      const n = norm(a.name);

      if (n.includes('brand')) guess = detected.brand || '';
      else if (n === 'department') guess = department;
      else if (n.includes('size type')) guess = sizeType;
      else if (n === 'size' || n.includes('waist') || n.includes('inseam'))
        guess = detected.size || '';
      else if (n.includes('color') || n.includes('colour'))
        guess =
          (Array.isArray(detected.colors)
            ? detected.colors[0]
            : detected.colors) || '';
      else if (n.includes('outer') && n.includes('material'))
        guess = detected.outerShellMaterial || detected.materials?.[0] || '';
      else if (n.includes('lining') && n.includes('material'))
        guess = detected.liningMaterial || '';
      else if (n.includes('insulation') && n.includes('material'))
        guess =
          detected.insulationMaterial ||
          (includesAny(td, ['puffer', 'down']) ? 'Down' : '');
      else if (n === 'style') guess = detected.style || '';
      else if (n === 'type') guess = detected.type || '';
      else if (n.includes('pattern')) guess = detected.pattern || '';
      else if (n.includes('length')) {
        const h = norm(detected.lengthHint || '');
        if (h.includes('maxi') || h.includes('long') || h.includes('ankle'))
          guess = 'Long';
        else if (h.includes('midi') || h.includes('mid')) guess = 'Midi';
        else if (h.includes('knee')) guess = 'Knee Length';
        else if (h.includes('short') || h.includes('hip') || h.includes('cropped'))
          guess = 'Short';
      } else if (n.includes('closure'))
        guess = detected.closure || (includesAny(td, ['zip', 'zipper']) ? 'Zip' : '');
      else if (n.includes('theme'))
        guess = Array.isArray(detected.theme)
          ? detected.theme
          : detected.theme
          ? [detected.theme]
          : [];
      else if (n.includes('features'))
        guess = Array.isArray(detected.features)
          ? detected.features
          : detected.features
          ? [detected.features]
          : [];
      else if (n.includes('country') && n.includes('origin'))
        guess = detected.countryOfOrigin || '';
      else if (n.includes('model')) guess = detected.model || '';
      else if (n.includes('sleeve') && n.includes('length'))
        guess = detected.sleeveLength || '';
      else if (n === 'fit') guess = detected.fit || '';

      const snappedArr = normalizeValueForAspect(
        a,
        guess,
        optionSets.get(k),
        canonicalValue.get(k)
      );

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

    // Build final payload
    const payload = {
      title,
      description,
      category,
      category_suggestions: categorySuggestions,
      ebay_category_id: category.id,
      ebay_category_name: category.name,
      ebay_category_path: category.path,
      detected,
      // schema for UI rendering
      category_specifics_schema: aspects.map((a) => ({
        name: a.name,
        required: !!a.required,
        type: a.type,
        multi: !!a.multi,
        selectionOnly: a.selectionOnly,
        freeTextAllowed: a.freeTextAllowed,
        values: a.values ?? [],
      })),
      // initial values for UI
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
      keywords: visionJSON.keywords || [],
      confidence_score: visionJSON.confidence_score ?? undefined,
      reconcile_notes: recJSON.notes ?? undefined,
      mapping_log: mappingLog, // optional: remove or trim for prod
    };

    // Optional webhook for Make.com
    if (process.env.VITE_MAKE_WEBHOOK_URL) {
      try {
        await fetch(process.env.VITE_MAKE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id,
            analysis: payload,
            image_urls: images,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {
        /* ignore */
      }
    }

    return res.status(200).json({
      success: true,
      data: payload,
      images_processed: base64Images.length,
      session_id,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
}
