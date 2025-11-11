// api/analyze-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

/* =========================
   Generic helpers
========================= */
function norm(s: string) {
  return (s || '').toLowerCase().trim();
}
function tokenize(s: string) {
  return norm(s).split(/[^a-z0-9%]+/).filter(Boolean);
}
function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
function startsOrContainsScore(a: string, b: string) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.startsWith(B) || B.startsWith(A)) return 0.86;
  if (A.includes(B) || B.includes(A)) return 0.6;
  return 0;
}
function lastLeafFromPath(path: string) {
  if (!path) return '';
  const segs = path.split('>').map(s => s.trim()).filter(Boolean);
  const leaf = segs[segs.length - 1] || '';
  const parts = leaf.split('/').map(s => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || leaf;
}
const CANON_MAP: Record<string, string> = {
  "floor length": "maxi",
  "ankle length": "maxi",
  "tea length": "midi",
  "knee-length": "knee length",
  "crewneck": "crew neck",
  "vneck": "v-neck",
  "v neck": "v-neck",
  "button down": "button-down",
  "zip up": "zip",
  "zip-up": "zip",
  "solid color": "solid",
  "striped": "stripes",
  "stripe": "stripes",
  "polka dot": "polka dots",
  "leopard print": "animal print",
  "cheetah print": "animal print",
  "snake print": "animal print",
  "floral print": "floral",
};
function canon(s: string) {
  const n = norm(s);
  return CANON_MAP[n] || n;
}

/* =========================
   Confidence settings
========================= */
const CONF = {
  optionThreshold: 0.78,   // min score to accept a single option
  multiThreshold: 0.72,    // min score per option in multi
  maxMulti: 5,
};

/* =========================
   Aspect policies
========================= */
// “Sensitive” aspects: only fill with trusted literal OR option above threshold; else blank.
const SENSITIVE_ASPECTS = new Set([
  'brand', 'country of origin', 'model', 'mpn', 'personalize', 'handmade',
  'vintage', 'california prop 65 warning'
]);

// Aspects where title/category cues are helpful (broader matching allowed)
const LIBERAL_ASPECTS = new Set([
  'style', 'type', 'pattern', 'features', 'occasion', 'leg style', 'fit',
  'collar style', 'sleeve length', 'dress length', 'top cuff style', 'character', 'theme'
]);

/* =========================
   Candidate builders
========================= */
function trustedLiteralsFromDetected(det: any): string[] {
  const set = new Set<string>();
  const add = (v?: string | string[]) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(x => x && set.add(canon(x)));
    else set.add(canon(v));
  };
  add(det?.brand);
  add(det?.size);
  add(det?.colors);
  add(det?.materials);
  add(det?.style);
  add(det?.type);
  add(det?.productLine);
  add(det?.features);
  return Array.from(set).filter(Boolean);
}
function broadCandidates(det: any, title: string, description: string, categoryPath: string) {
  // Used only for “liberal” aspects (style/type/etc.)
  const set = new Set<string>(trustedLiteralsFromDetected(det));
  tokenize(title).forEach(t => set.add(canon(t)));
  tokenize(description).forEach(t => set.add(canon(t)));
  const leaf = lastLeafFromPath(categoryPath);
  tokenize(leaf).forEach(t => set.add(canon(t)));
  const tks = tokenize(title);
  for (let i = 0; i < tks.length - 1; i++) set.add(canon(`${tks[i]} ${tks[i + 1]}`));
  return Array.from(set).filter(Boolean);
}

/* =========================
   Scoring / picking
========================= */
function scoreOption(option: string, candidates: string[], contextLeaf: string) {
  const oCanon = canon(option);
  const oTokens = tokenize(oCanon);
  let best = 0;
  for (const cand of candidates) {
    const cCanon = canon(cand);
    const cTokens = tokenize(cCanon);
    const j = jaccard(oTokens, cTokens);
    const s = startsOrContainsScore(oCanon, cCanon);
    const local = Math.max(j, s, 0);
    if (local > best) best = local;
  }
  // small contextual bump
  const leafTok = tokenize(contextLeaf);
  const leafBoost = jaccard(oTokens, leafTok);
  return best + 0.12 * leafBoost;
}
function bestOptionAboveThreshold(options: string[], candidates: string[], leaf: string, min: number) {
  let best = '', score = -1;
  for (const opt of options) {
    const sc = scoreOption(opt, candidates, leaf);
    if (sc > score) { score = sc; best = opt; }
  }
  return score >= min ? { best, score } : { best: '', score };
}
function topMultiOptions(options: string[], candidates: string[], leaf: string, min: number, maxN: number) {
  const scored = options.map(o => ({ o, s: scoreOption(o, candidates, leaf) }))
    .filter(x => x.s >= min)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, maxN).map(x => x.o);
}

/* =========================
   Inference helpers
========================= */
function inferDepartmentFromPath(path: string) {
  const p = norm(path);
  if (p.includes('men')) return 'Men';
  if (p.includes('women')) return 'Women';
  if (p.includes('boys')) return 'Boys';
  if (p.includes('girls')) return 'Girls';
  if (p.includes('unisex')) return 'Unisex Adult';
  return '';
}
function inferSizeType({ size, title, categoryPath }: { size?: string; title?: string; categoryPath?: string; }) {
  const hay = [size, title, categoryPath].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes('petite')) return 'Petite';
  if (hay.includes('tall') || hay.includes('long')) return 'Tall';
  if (hay.includes('plus') || hay.includes('extended')) return 'Plus';
  return 'Regular';
}

/* =========================
   Handler
========================= */
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

    // 1) base64
    const base64Images = await Promise.all(
      images.slice(0, 12).map(async (url: string) => {
        const optimizedUrl = url.includes('cloudinary.com')
          ? url.replace('/upload/', '/upload/w_1024,h_1024,c_limit,q_auto,f_jpg/')
          : url;
        const r = await fetch(optimizedUrl);
        if (!r.ok) throw new Error(`Failed to download image: ${r.status}`);
        const buf = await r.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        const mime = r.headers.get('content-type') || 'image/jpeg';
        return `data:${mime};base64,${b64}`;
      })
    );

    // 2) OpenAI
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are an expert eBay product lister. Only return JSON. Do not invent attributes—prefer values directly observed on tags/logos/labels in the photos.',
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
                text: `Analyze ALL ${base64Images.length} photos and return this JSON:

{
  "title": "Max 80 chars",
  "description": "Concise description",
  "category": "Breadcrumb path like 'Clothing, Shoes & Accessories > Men > Shirts > Polos'",
  "item_specifics": [
    {"name": "Brand", "value": "exact brand or 'Unbranded'"},
    {"name": "Size", "value": "exact size or 'See photos'"},
    {"name": "Color", "value": "primary color"},
    {"name": "Material", "value": "material or 'See description'"},
    {"name": "Style", "value": ""},
    {"name": "Type", "value": ""},
    {"name": "Features", "value": "", "values": ["array of feature words if helpful"]}
  ],
  "detected": {
    "brand": "visible brand name or null",
    "size": "visible size text or null",
    "colors": ["primary color", "secondary color if any"],
    "materials": ["visible materials like 'cotton', 'polyester'"],
    "style": "short style phrase if seen",
    "type": "short type phrase if seen",
    "productLine": "if explicitly shown",
    "features": ["bullet list of label/feature words seen"]
  },
  "keywords": [],
  "suggested_price": "29.99",
  "confidence_score": 0.95
}`,
              },
            ],
          },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      }),
    });

    if (!openaiResponse.ok) {
      const text = await openaiResponse.text();
      throw new Error(`OpenAI API error: ${openaiResponse.status} ${text}`);
    }

    const openaiResult = await openaiResponse.json();
    const content = openaiResult.choices[0].message.content;
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { throw new Error('Invalid response JSON'); }

    // 3) eBay taxonomy/specifics
    try {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const ebayApiUrl = `${origin}/api/ebay-categories`;

      const sugg = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getSuggestedCategories',
          title: parsed.title,
          keywords: parsed.keywords || [],
        }),
      });

      if (sugg.ok) {
        const cat = await sugg.json();

        parsed.ebay_category_id   = cat.categoryId;
        parsed.ebay_category_name = cat.categoryName;
        parsed.ebay_category_path = cat.categoryPath || cat.categoryName;
        parsed.category = { id: cat.categoryId, name: cat.categoryName, path: parsed.ebay_category_path };
        parsed.category_suggestions = (cat.suggestions || []).map((s: any) => ({ id: s.id, name: s.name, path: s.path || s.name }));

        const specRes = await fetch(ebayApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getCategorySpecifics', categoryId: cat.categoryId }),
        });

        if (specRes.ok) {
          const spec = await specRes.json();
          const mapped = mapAIToEbayFields(
            parsed.detected,
            spec.aspects || [],
            parsed.ebay_category_path || parsed.category?.path || '',
            parsed.title || '',
            parsed.description || ''
          );
          parsed.category_specifics_schema = spec.aspects || [];
          parsed.item_specifics = mapped.item_specifics;
          parsed.needs_review   = mapped.needs_review;
          parsed.debug          = mapped.debug;
        } else {
          parsed.category_specifics_schema = [];
          parsed.item_specifics = [];
        }
      } else {
        parsed.ebay_category_id = '11450';
        parsed.ebay_category_name = 'Clothing, Shoes & Accessories';
        parsed.ebay_category_path = 'Clothing, Shoes & Accessories';
        parsed.category = { id: '11450', name: 'Clothing, Shoes & Accessories', path: 'Clothing, Shoes & Accessories' };
        parsed.category_suggestions = [
          { id: '11450', name: 'Clothing, Shoes & Accessories', path: 'Clothing, Shoes & Accessories' },
        ];
      }
    } catch {
      parsed.ebay_category_id = '11450';
      parsed.ebay_category_name = 'Clothing, Shoes & Accessories';
      parsed.ebay_category_path = 'Clothing, Shoes & Accessories';
      parsed.category = { id: '11450', name: 'Clothing, Shoes & Accessories', path: 'Clothing, Shoes & Accessories' };
      parsed.category_suggestions = [
        { id: '11450', name: 'Clothing, Shoes & Accessories', path: 'Clothing, Shoes & Accessories' },
      ];
    }

    // 4) Optional webhook
    if (process.env.VITE_MAKE_WEBHOOK_URL) {
      try {
        await fetch(process.env.VITE_MAKE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id,
            analysis: parsed,
            image_urls: images,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch { /* non-fatal */ }
    }

    return res.status(200).json({
      success: true,
      data: parsed,
      images_processed: base64Images.length,
      session_id,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
}

/* =========================
   Strict, confidence-gated mapper
========================= */
function mapAIToEbayFields(
  aiDetected: any,
  ebayAspects: any[],
  categoryPath: string,
  title: string,
  description: string
) {
  const det = aiDetected || {};
  const dept = inferDepartmentFromPath(categoryPath || '');
  const sizeType = inferSizeType({ size: det.size, title, categoryPath });
  const leaf = lastLeafFromPath(categoryPath || '');

  const needs_review: Record<string, any> = {};
  const debug: Record<string, any> = { decisions: {} };

  // candidate pools
  const trusted = trustedLiteralsFromDetected(det);                        // strict
  const liberal = broadCandidates(det, title || '', description || '', categoryPath || ''); // broader

  const out: any[] = [];

  for (const aspect of ebayAspects) {
    const name: string = aspect?.name || '';
    const n = norm(name);
    const options: string[] = aspect?.values || [];
    const required = !!aspect?.required;
    const selectionOnly = !!aspect?.selectionOnly || aspect?.type === 'SelectionOnly';
    const multi = !!aspect?.multi;
    const freeTextAllowed = aspect?.freeTextAllowed !== false && !selectionOnly;

    // pick candidate source
    const useLiberal = LIBERAL_ASPECTS.has(n);
    const candPool = useLiberal ? liberal : trusted;

    // seed aspect-specific literals
    const literals: string[] = [];
    const addLit = (v?: string | string[]) => {
      if (!v) return;
      if (Array.isArray(v)) v.forEach(x => x && literals.push(x));
      else literals.push(v);
    };
    if (n.includes('brand')) addLit(det.brand);
    if ((n === 'size' || n.includes('waist') || n.includes('inseam')) && det.size) addLit(det.size);
    if ((n.includes('color') || n.includes('colour')) && det.colors?.length) addLit(det.colors);
    if ((n.includes('material') || n.includes('fabric')) && det.materials?.length) addLit(det.materials);
    if (n.includes('department') && dept) addLit(dept);
    if (n.includes('size type') && sizeType) addLit(sizeType);
    if (n === 'style' && det.style) addLit(det.style);
    if (n === 'type' && det.type) addLit(det.type);
    if (n.includes('product line') && det.productLine) addLit(det.productLine);
    if (n.includes('feature') && Array.isArray(det.features)) addLit(det.features);

    // selection logic
    let value = '';
    let reason = 'unset';

    if (multi) {
      const picks = topMultiOptions(options, candPool, leaf, CONF.multiThreshold, CONF.maxMulti);
      value = picks.join(', ');
      if (!value && required) needs_review[n] = 'required multi but low confidence';
      reason = 'multi: top options above threshold';

    } else if (selectionOnly) {
      // sensitive? demand higher confidence
      const min = SENSITIVE_ASPECTS.has(n) ? Math.max(CONF.optionThreshold, 0.82) : CONF.optionThreshold;
      const { best, score } = bestOptionAboveThreshold(options, candPool, leaf, min);
      value = best;
      if (!value && required) needs_review[n] = 'required selectionOnly but low confidence';
      reason = `single/selectionOnly: best=${best || '(none)'} score=${score.toFixed(2)} min=${min}`;

      // Brand policy: never fabricate a brand
      if (n.includes('brand') && value) {
        const lit = det.brand ? norm(det.brand) : '';
        if (lit && !options.some(o => norm(o) === lit) && norm(value) !== lit) {
          // mismatch → clear & flag
          value = '';
          needs_review['brand'] = `Detected "${det.brand}" not in allowed list`;
          reason += ' | brand cleared & flagged';
        }
      }

    } else {
      // free-text allowed: only use trusted literals (never from broad tokens)
      const literal = literals.find(Boolean);
      if (literal) {
        // If there are options and one matches strongly, snap to it; else keep literal
        if (options?.length) {
          const { best, score } = bestOptionAboveThreshold(options, [literal], leaf, 0.85);
          if (best) {
            value = best;
            reason = `single/freeText: snapped literal to option (score ${score.toFixed(2)})`;
          } else {
            value = literal;
            reason = 'single/freeText: trusted literal';
          }
        } else {
          value = literal;
          reason = 'single/freeText: trusted literal (no options)';
        }
      } else {
        value = '';
        if (required) needs_review[n] = 'required freeText but no trusted literal';
        reason = 'single/freeText: no trusted literal';
      }
    }

    // Final record
    debug.decisions[name] = {
      selectionOnly, multi, required, freeTextAllowed,
      chosen: value, reason,
      optionsPreview: options.slice(0, 10),
      sampleCandidates: candPool.slice(0, 10),
    };

    out.push({
      name: aspect.name,
      value,
      required,
      type: aspect.type,
      options,
      selectionOnly,
      multi,
      freeTextAllowed,
    });
  }

  return { item_specifics: out, needs_review, debug };
}
