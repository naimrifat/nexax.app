// api/analyze-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

/* ──────────────────────────────────────────────────────────────
   Small utilities
   ────────────────────────────────────────────────────────────── */
const norm = (s: string) => (s || '').toLowerCase().trim();
const tokenize = (s: string) =>
  norm(s).replace(/[%/(),.&\-–—_+]/g, ' ').split(/\s+/).filter(Boolean);
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

/* ──────────────────────────────────────────────────────────────
   Generic option snapping with scoring
   - selectionOnly: must return a valid option (or '')
   - returns best option by (exact > synonym > token overlap)
   ────────────────────────────────────────────────────────────── */
function snapToOption(
  target: string,
  options: string[] = [],
  selectionOnly = false,
  synonyms: Record<string, string[]> = {},
): string {
  const t = norm(target);
  if (!t) return selectionOnly ? '' : '';

  // exact
  const exact = options.find(o => norm(o) === t);
  if (exact) return exact;

  // synonym tables: if target matches a synonym key or any of its alias, pick the option
  for (const opt of options) {
    const o = norm(opt);
    if (synonyms[o]?.includes(t)) return opt;      // alias equals target
    // also allow reverse: if target is a canonical and option text contains alias/canonical
    const aliases = synonyms[o] || [];
    if (aliases.some(a => o.includes(norm(a))) && (o.includes(t) || t.includes(o))) return opt;
  }

  // token overlap score
  const tks = tokenize(t);
  let best = '';
  let bestScore = -1;
  for (const opt of options) {
    const oks = tokenize(opt);
    const score = tks.reduce((acc, tk) => acc + (oks.includes(tk) ? 1 : 0), 0);
    if (score > bestScore) {
      best = opt;
      bestScore = score;
    }
  }
  return selectionOnly ? (best || '') : (best || target);
}

/* ──────────────────────────────────────────────────────────────
   Normalizers (category-agnostic)
   ────────────────────────────────────────────────────────────── */
const COUNTRY_NORMALIZE: Record<string, string> = {
  'usa': 'United States', 'u.s.a': 'United States', 'united states': 'United States', 'america': 'United States',
  'uk': 'United Kingdom', 'u.k': 'United Kingdom', 'england': 'United Kingdom',
  'korea': 'Korea, Republic of', 'south korea': 'Korea, Republic of',
  'china': 'China', 'japan': 'Japan', 'italy': 'Italy', 'france': 'France',
  'viet nam': 'Vietnam', 'vietnam': 'Vietnam', 'mexico': 'Mexico', 'canada': 'Canada',
  'portugal': 'Portugal', 'spain': 'Spain', 'turkiye': 'Turkey', 'turkey': 'Turkey',
};

function normalizeCountry(raw: string): string {
  const t = norm(raw).replace(/made in|product of|assembled in|usa|u\.s\.a/gi, (m) => m);
  for (const [k, v] of Object.entries(COUNTRY_NORMALIZE)) {
    if (t.includes(k)) return v;
  }
  return raw;
}

function normalizeColor(raw: string): string {
  const t = norm(raw);
  if (!t) return raw;
  // families
  if (/(teal|aqua|turquoise|cyan)/.test(t)) return 'Blue';
  if (/(burgundy|maroon|wine)/.test(t)) return 'Red';
  if (/(beige|tan|khaki|taupe|ivory|cream)/.test(t)) return 'Beige';
  if (/(off\s*white|bone)/.test(t)) return 'White';
  return raw;
}

/* ──────────────────────────────────────────────────────────────
   Reasoner: equivalences + implications
   NOTE: This is schema-aware: it only tries to fill an aspect
   when that aspect exists in the live Taxonomy response, and
   it always snaps to *that* aspect’s options.
   ────────────────────────────────────────────────────────────── */

// Canonical synonyms keyed by the canonical option we expect to see
const GLOBAL_SYNONYMS: Record<string, string[]> = {
  // lengths
  'short': ['mini', 'short'],
  'midi': ['midi', 'tea length', 'knee length', 'knee-length'],
  'long': ['maxi', 'floor', 'ankle', 'long', 'full length'],
  // closures
  'zip': ['zip', 'zipper', 'zipped'],
  'button': ['button', 'buttoned', 'buttons', 'button-down', 'button front'],
  'hook & eye': ['hook', 'hook-and-eye', 'hook & eye'],
  'snap': ['snap', 'snaps'],
  // necklines
  'crew neck': ['crew', 'crewneck'],
  'v-neck': ['v', 'v neck', 'v-neck'],
  'scoop neck': ['scoop'],
  'boat neck': ['boatneck', 'bateau', 'boat'],
  'cowl neck': ['cowl'],
  'square neck': ['square'],
  'halter': ['halter'],
  'turtleneck': ['turtle', 'roll neck'],
  // themes
  'flowers': ['floral', 'flower', 'botanical', 'blossom', 'hibiscus'],
  'animals': ['animal', 'leopard', 'cheetah', 'zebra', 'tiger', 'giraffe'],
  'hawaiian': ['hawaiian', 'aloha'],
  // fabrics/material
  'cotton': ['cotton'],
  'polyester': ['polyester', 'poly'],
  'linen': ['linen'],
  'silk': ['silk'],
  'wool': ['wool'],
  'leather': ['leather'],
  'spandex': ['spandex', 'elastane', 'lycra'],
  'rayon': ['rayon', 'viscose'],
  'nylon': ['nylon'],
  'acrylic': ['acrylic'],
  'cashmere': ['cashmere'],
};

// When AI/description gives blends like "65% polyester / 35% cotton", infer material set
function inferMaterialsFromText(text: string): string[] {
  const t = norm(text);
  const found: string[] = [];
  for (const canon of Object.keys(GLOBAL_SYNONYMS)) {
    if (GLOBAL_SYNONYMS[canon]?.some(a => t.includes(a))) found.push(canon);
  }
  return uniq(found);
}

// Implication rules (category-agnostic). They produce candidate values for certain aspect names.
function reasonCandidatesFromTokens(tokens: string[]) {
  const t = tokens.map(norm);
  const has = (...words: string[]) => words.some(w => t.includes(norm(w)));

  const cands: Record<string, string[] | string> = {};

  // Dress length / Length in general
  if (has('maxi', 'floor', 'ankle')) cands['dress length'] = ['long'];
  else if (has('mini', 'short')) cands['dress length'] = ['short'];
  else if (has('midi', 'knee')) cands['dress length'] = ['midi'];

  // Closure
  if (has('zip', 'zipper')) cands['closure'] = ['zip'];
  if (has('button', 'buttons', 'button-down')) cands['closure'] = uniq([...(cands['closure'] as string[] || []), 'button']);

  // Neckline
  if (has('v-neck', 'vneck', 'v')) cands['neckline'] = ['v-neck'];
  if (has('crew', 'crewneck')) cands['neckline'] = ['crew neck'];
  if (has('scoop')) cands['neckline'] = ['scoop neck'];
  if (has('boat', 'bateau')) cands['neckline'] = ['boat neck'];
  if (has('cowl')) cands['neckline'] = ['cowl neck'];
  if (has('square')) cands['neckline'] = ['square neck'];
  if (has('halter')) cands['neckline'] = ['halter'];
  if (has('turtle', 'turtleneck', 'roll')) cands['neckline'] = ['turtleneck'];

  // Pattern -> Theme implications
  if (has('floral', 'flower', 'hibiscus')) cands['theme'] = ['flowers', 'hawaiian'];
  if (has('animal', 'leopard', 'zebra', 'tiger', 'cheetah')) cands['theme'] = uniq([...(cands['theme'] as string[] || []), 'animals']);

  // Season (rough heuristic)
  if (has('fleece', 'sherpa', 'wool', 'down')) cands['season'] = ['winter'];
  if (has('linen', 'shortsleeve', 'short-sleeve', 'shorts')) cands['season'] = ['summer'];

  // Features (multi)
  const feat: string[] = [];
  if (has('pockets')) feat.push('pockets');
  if (has('adjustable waist', 'drawstring')) feat.push('adjustable waist');
  if (has('elastic')) feat.push('elastic waist');
  if (has('lined')) feat.push('lined');
  if (feat.length) cands['features'] = feat;

  return cands;
}

// Given live aspect schema + raw detections, produce final specifics
function buildReasonedSpecifics(args: {
  aspects: any[];
  detected: any;
  title?: string;
  description?: string;
}) {
  const { aspects, detected, title, description } = args;

  const tokensFromAI = [
    title || '',
    description || '',
    detected?.brand || '',
    detected?.size || '',
    ...(Array.isArray(detected?.colors) ? detected.colors : [detected?.colors || '']),
    ...(Array.isArray(detected?.materials) ? detected.materials : [detected?.materials || '']),
    detected?.style || '',
    detected?.type || '',
    detected?.productLine || '',
    ...(detected?.features || []),
  ].join(' ');

  const allTokens = uniq(tokenize(tokensFromAI));
  const infer = reasonCandidatesFromTokens(allTokens);
  const inferredMaterials = inferMaterialsFromText(tokensFromAI);

  // Special SizeType before Size (dependency)
  let chosenSizeType = '';
  {
    const sizeTypeAspect = aspects.find(a => norm(a.name).includes('size type'));
    if (sizeTypeAspect) {
      const opts = sizeTypeAspect.values || [];
      // heuristic from tokens
      const stGuess =
        (allTokens.find(t => ['petite', 'tall', 'plus', 'regular', 'big', 'big & tall'].includes(t))) ||
        detected?.sizeType ||
        '';
      chosenSizeType = snapToOption(stGuess || 'regular', opts, !!sizeTypeAspect.selectionOnly, GLOBAL_SYNONYMS);
    }
  }

  function resolveValueForAspect(aspect: any): string | string[] {
    const aName = norm(aspect.name);
    const opts: string[] = aspect.values || [];
    const selectionOnly = !!aspect.selectionOnly;
    const multi = !!aspect.multi;

    const trySnap = (v: string) =>
      snapToOption(v, opts, selectionOnly, GLOBAL_SYNONYMS);

    // pre-seeded guesses (AI detections and reasoned candidates)
    const guesses: (string | string[])[] = [];

    if (aName === 'brand') guesses.push(detected?.brand || '');
    else if (aName === 'department') guesses.push(detected?.department || '');
    else if (aName.includes('size type')) guesses.push(chosenSizeType || 'regular');
    else if (aName === 'size' || aName.includes('waist') || aName.includes('inseam')) {
      // Prefer numeric/label size tokens; if Size Type chosen, still snap to options
      guesses.push(String(detected?.size || ''));
    } else if (aName.includes('color') || aName.includes('colour')) {
      const primary = Array.isArray(detected?.colors) ? detected.colors[0] : detected?.colors || '';
      guesses.push(normalizeColor(primary));
    } else if (aName.includes('material') || aName.includes('fabric')) {
      // Combine AI material + inferred blends
      const fromAI = Array.isArray(detected?.materials) ? detected.materials : [detected?.materials || ''];
      const mats = uniq([...fromAI, ...inferredMaterials]);
      if (multi) guesses.push(mats);
      else guesses.push(mats[0] || '');
    } else if (aName === 'style') {
      guesses.push(detected?.style || '');
    } else if (aName === 'type') {
      guesses.push(detected?.type || '');
    } else if (aName.includes('product line')) {
      guesses.push(detected?.productLine || '');
    } else if (aName.includes('theme') && infer['theme']) {
      guesses.push(infer['theme']);
    } else if (aName.includes('neck') && infer['neckline']) {
      guesses.push(infer['neckline']);
    } else if ((aName.includes('closure') || aName.includes('fastening')) && infer['closure']) {
      guesses.push(infer['closure']);
    } else if (aName.includes('dress length') && infer['dress length']) {
      guesses.push(infer['dress length']);
    } else if (aName.includes('season') && infer['season']) {
      guesses.push(infer['season']);
    } else if (aName.includes('country') && aName.includes('origin')) {
      guesses.push(normalizeCountry(tokensFromAI));
    } else if (aName.includes('features') && infer['features']) {
      guesses.push(infer['features']);
    } else {
      // generic guess: try AI detected map if same key exists
      const key = aName.replace(/\s+/g, '_');
      if (detected && typeof detected[key] === 'string') guesses.push(detected[key]);
    }

    // Multi-select aspects
    if (multi) {
      const allVals = uniq(
        guesses
          .flatMap(g => (Array.isArray(g) ? g : [g]))
          .map(v => String(v).trim())
          .filter(Boolean),
      );
      const snapped = allVals
        .map(v => trySnap(v))
        .filter(Boolean);
      return uniq(snapped);
    }

    // Single-select / free text
    for (const g of guesses.flatMap(g => (Array.isArray(g) ? g : [g]))) {
      const v = String(g || '').trim();
      if (!v) continue;
      const snapped = trySnap(v);
      if (snapped) return snapped;
    }

    // If nothing guessed and free text allowed, return blank
    return selectionOnly ? '' : '';
  }

  const specifics = aspects.map(aspect => {
    const value = resolveValueForAspect(aspect);
    return {
      name: aspect.name,
      value,
      required: !!aspect.required,
      type: aspect.type,
      options: aspect.values || [],
      selectionOnly: !!aspect.selectionOnly,
      multi: !!aspect.multi,
      freeTextAllowed: !!aspect.freeTextAllowed,
    };
  });

  return specifics;
}

/* ──────────────────────────────────────────────────────────────
   Main handler
   ────────────────────────────────────────────────────────────── */
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

    // 1) Download & convert to base64 (max 12)
    const base64Images = await Promise.all(
      images.slice(0, 12).map(async (url: string) => {
        const optimizedUrl = url.includes('cloudinary.com')
          ? url.replace('/upload/', '/upload/w_1024,h_1024,c_limit,q_auto,f_jpg/')
          : url;
        const response = await fetch(optimizedUrl);
        if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        return `data:${mimeType};base64,${base64}`;
      }),
    );

    // 2) OpenAI Vision — return structured detection block
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert eBay product lister. Analyze ALL provided photos together. Return ONLY valid JSON with no markdown.',
          },
          {
            role: 'user',
            content: [
              ...base64Images.map(img => ({ type: 'image_url' as const, image_url: { url: img, detail: 'low' as const } })),
              {
                type: 'text' as const,
                text: `Extract a clean, structured analysis. JSON schema:

{
  "title": "SEO title, <=80 chars",
  "description": "short description from the photos/labels",
  "detected": {
    "brand": "brand or null",
    "size": "size label or null",
    "colors": ["primary","secondary?"],
    "materials": ["materials/percent words seen in tags"],
    "style": "style guess",
    "type": "type guess",
    "department": "Men|Women|Unisex|Boys|Girls if visible",
    "features": ["keywords like pockets, zip, lined, adjustable waist"],
    "ocr": "short concatenated text from labels/tags (if visible)"
  },
  "keywords": ["search terms"]
}`,
              },
            ],
          },
        ],
        max_tokens: 1800,
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      throw new Error(`OpenAI API error: ${openaiResponse.status} ${errorData}`);
    }

    const openaiResult = await openaiResponse.json();
    const content = openaiResult?.choices?.[0]?.message?.content || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Invalid response format from OpenAI');
    }

    // 3) eBay category suggestion + live aspect schema
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const ebayApiUrl = `${origin}/api/ebay-categories`;

    // suggested category
    let categoryId = '11450';
    let categoryName = 'Clothing, Shoes & Accessories';
    let categoryPath = categoryName;
    let suggestions: any[] = [{ id: categoryId, name: categoryName, path: categoryPath }];

    try {
      const catResp = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getSuggestedCategories', title: parsed.title, keywords: parsed.keywords || [] }),
      });
      if (catResp.ok) {
        const catData = await catResp.json();
        categoryId = catData.categoryId || categoryId;
        categoryName = catData.categoryName || categoryName;
        categoryPath = catData.categoryPath || categoryName;
        suggestions = (catData.suggestions || []).map((s: any) => ({ id: s.id, name: s.name, path: s.path || s.name }));
      }
    } catch {
      /* fallback already set */
    }

    // fetch live aspects
    let aspects: any[] = [];
    try {
      const aspResp = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCategorySpecifics', categoryId }),
      });
      if (aspResp.ok) {
        const aspData = await aspResp.json();
        aspects = aspData.aspects || [];
      }
    } catch {
      aspects = [];
    }

    // 4) Reasoning pass -> produce item_specifics (snap to live options)
    const detected = parsed?.detected || {};
    const item_specifics = buildReasonedSpecifics({
      aspects,
      detected,
      title: parsed?.title || '',
      description: `${parsed?.description || ''} ${detected?.ocr || ''}`,
    });

    // 5) Assemble final analysis payload
    const result = {
      title: parsed?.title || '',
      description: parsed?.description || '',
      category: { id: categoryId, name: categoryName, path: categoryPath },
      category_suggestions: suggestions,
      category_specifics_schema: aspects,
      item_specifics,
      keywords: parsed?.keywords || [],
      detected,
    };

    // 6) Optional webhook (Make.com)
    if (process.env.VITE_MAKE_WEBHOOK_URL) {
      try {
        await fetch(process.env.VITE_MAKE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id, analysis: result, image_urls: images, timestamp: new Date().toISOString() }),
        });
      } catch {
        /* non-fatal */
      }
    }

    return res.status(200).json({ success: true, data: result, images_processed: base64Images.length, session_id });
  } catch (error: any) {
    return res.status(500).json({
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}
