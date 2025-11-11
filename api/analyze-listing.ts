// api/analyze-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

/* -------------------------------------------------------
   Generic helpers
------------------------------------------------------- */
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
  if (A.startsWith(B) || B.startsWith(A)) return 0.85;
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

/* -------------------------------------------------------
   Light-weight normalization (domain-safe, not hard-coded to a category)
------------------------------------------------------- */
const CANON_MAP: Record<string, string> = {
  "floor length": "maxi",
  "ankle length": "maxi",
  "tea length": "midi",
  "knee-length": "knee length",
  "short sleeve": "short sleeves",
  "long sleeve": "long sleeves",
  "3/4 sleeve": "three quarter sleeves",
  "three-quarter sleeve": "three quarter sleeves",
  "crewneck": "crew neck",
  "vneck": "v-neck",
  "v neck": "v-neck",
  "button down": "button-down",
  "zip up": "zip",
  "zip-up": "zip",
  "solid color": "solid",
  "polka dot": "polka dots",
  "leopard print": "animal print",
  "cheetah print": "animal print",
  "snake print": "animal print",
  "floral print": "floral",
  "striped": "stripes",
  "stripe": "stripes",
};
function canon(s: string) {
  const n = norm(s);
  return CANON_MAP[n] || n;
}

/* -------------------------------------------------------
   Candidate builder (dynamic): use AI detected + title + path
------------------------------------------------------- */
function buildCandidates(aiDetected: any, title: string, description: string, categoryPath: string) {
  const cands = new Set<string>();

  const add = (v?: string | string[]) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(x => x && cands.add(canon(x)));
    else cands.add(canon(v));
  };

  // AI detected
  add(aiDetected?.brand);
  add(aiDetected?.size);
  add(aiDetected?.colors);
  add(aiDetected?.materials);
  add(aiDetected?.style);
  add(aiDetected?.type);
  add(aiDetected?.productLine);
  add(aiDetected?.features);

  // Text cues
  tokenize(title).forEach(t => cands.add(canon(t)));
  tokenize(description).forEach(t => cands.add(canon(t)));

  // Category leaf terms help (e.g., "Polos", "Blazer", "Dress")
  const leaf = lastLeafFromPath(categoryPath);
  tokenize(leaf).forEach(t => cands.add(canon(t)));

  // Join some common two-grams from title for better phrase matching
  const tks = tokenize(title);
  for (let i = 0; i < tks.length - 1; i++) {
    cands.add(canon(`${tks[i]} ${tks[i + 1]}`));
  }

  return Array.from(cands).filter(Boolean);
}

/* -------------------------------------------------------
   Scoring options against candidates
------------------------------------------------------- */
function scoreOption(option: string, candidates: string[], contextLeaf: string) {
  const oCanon = canon(option);
  const oTokens = tokenize(oCanon);
  let best = 0;

  for (const cand of candidates) {
    const cCanon = canon(cand);
    const cTokens = tokenize(cCanon);
    const j = jaccard(oTokens, cTokens);
    const s = startsOrContainsScore(oCanon, cCanon);
    // blended score
    const local = Math.max(j, s, 0);
    if (local > best) best = local;
  }

  // Small bump if option overlaps with leaf (category context)
  const leafTok = tokenize(contextLeaf);
  const leafBoost = jaccard(oTokens, leafTok);
  return best + 0.15 * leafBoost; // bounded around ~1.15
}

/* -------------------------------------------------------
   Decide a single value for selectionOnly aspects
------------------------------------------------------- */
function chooseSingleOption(candidates: string[], options: string[], contextLeaf: string) {
  if (!options?.length) return '';
  // Stage A: quick exact/contains checks
  for (const cand of candidates) {
    const exact = options.find(o => canon(o) === canon(cand));
    if (exact) return exact;
  }
  for (const cand of candidates) {
    const soft = options.find(o => startsOrContainsScore(canon(o), canon(cand)) >= 0.85);
    if (soft) return soft;
  }

  // Stage B: score all options against candidates, pick best
  let bestOpt = options[0], bestScore = -1;
  for (const opt of options) {
    const sc = scoreOption(opt, candidates, contextLeaf);
    if (sc > bestScore) {
      bestScore = sc;
      bestOpt = opt;
    }
  }
  return bestOpt;
}

/* -------------------------------------------------------
   Multi-select: pick top N distinct options
------------------------------------------------------- */
function chooseMultiOptions(candidates: string[], options: string[], contextLeaf: string, maxN = 5) {
  if (!options?.length) return [];
  const scored = options.map(o => ({ o, s: scoreOption(o, candidates, contextLeaf) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, Math.min(maxN, scored.length)).map(x => x.o);
}

/* -------------------------------------------------------
   Inference helpers
------------------------------------------------------- */
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

/* -------------------------------------------------------
   Main handler
------------------------------------------------------- */
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

    // 1) Download → base64 (max 12)
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
      })
    );

    // 2) OpenAI Vision
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
              'You are an expert eBay product lister. Analyze ALL provided photos together to create a comprehensive listing. Return ONLY valid JSON with no markdown.',
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
  "title": "SEO-optimized eBay title, maximum 80 characters",
  "description": "Detailed product description with key features, condition, and materials",
  "category": "Most specific eBay category path like 'Clothing, Shoes & Accessories > Women > Dresses'",
  "item_specifics": [
    {"name": "Brand", "value": "exact brand or 'Unbranded'"},
    {"name": "Size", "value": "exact size or 'See photos'"},
    {"name": "Color", "value": "primary color"},
    {"name": "Material", "value": "material or 'See description'"},
    {"name": "Style", "value": "style if applicable"},
    {"name": "Type", "value": "type if applicable"},
    {"name": "Features", "value": "", "values": ["array of feature words if helpful"]}
  ],
  "detected": {
    "brand": "visible brand name or null",
    "size": "visible size or null",
    "colors": ["primary color", "secondary color if any"],
    "condition": "New with tags | New without tags | Pre-owned | Good | Fair",
    "materials": ["visible materials"],
    "style": "style guess",
    "type": "type guess",
    "productLine": "product line guess or null",
    "features": ["list of features words"]
  },
  "keywords": ["relevant", "search", "terms"],
  "suggested_price": "29.99",
  "confidence_score": 0.95
}`,
              },
            ],
          },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      throw new Error(`OpenAI API error: ${openaiResponse.status} ${errorData}`);
    }

    const openaiResult = await openaiResponse.json();
    const analysisContent = openaiResult.choices[0].message.content;
    let parsedAnalysis: any;
    try {
      parsedAnalysis = JSON.parse(analysisContent);
    } catch {
      throw new Error('Invalid response format from OpenAI');
    }

    // 3) eBay taxonomy & specifics
    try {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const ebayApiUrl = `${origin}/api/ebay-categories`;

      // suggested category
      const ebayResponse = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getSuggestedCategories',
          title: parsedAnalysis.title,
          keywords: parsedAnalysis.keywords || [],
        }),
      });

      if (ebayResponse.ok) {
        const ebayData = await ebayResponse.json();

        parsedAnalysis.ebay_category_id = ebayData.categoryId;
        parsedAnalysis.ebay_category_name = ebayData.categoryName;
        parsedAnalysis.ebay_category_path = ebayData.categoryPath || ebayData.categoryName;

        parsedAnalysis.category = {
          id: ebayData.categoryId,
          name: ebayData.categoryName,
          path: ebayData.categoryPath || ebayData.categoryName,
        };
        parsedAnalysis.category_suggestions = (ebayData.suggestions || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          path: s.path || s.name,
        }));

        // specifics
        const specificsResponse = await fetch(ebayApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'getCategorySpecifics',
            categoryId: ebayData.categoryId,
          }),
        });

        if (specificsResponse.ok) {
          const specificsData = await specificsResponse.json();
          const aspects = specificsData.aspects || [];

          const mapped = mapAIToEbayFields(
            parsedAnalysis.detected,
            aspects,
            parsedAnalysis.category?.path || parsedAnalysis.ebay_category_path || '',
            parsedAnalysis.title || '',
            parsedAnalysis.description || ''
          );

          parsedAnalysis.category_specifics_schema = aspects;
          parsedAnalysis.item_specifics = mapped.item_specifics;
          parsedAnalysis.needs_review = mapped.needs_review;
          parsedAnalysis.debug = mapped.debug;
        } else {
          parsedAnalysis.category_specifics_schema = [];
          parsedAnalysis.item_specifics = [];
          parsedAnalysis.needs_review = { message: 'Failed to fetch category specifics' };
        }
      } else {
        // default fallback
        parsedAnalysis.ebay_category_id = '11450';
        parsedAnalysis.ebay_category_name = 'Clothing, Shoes & Accessories';
        parsedAnalysis.ebay_category_path = 'Clothing, Shoes & Accessories';
        parsedAnalysis.category = {
          id: '11450',
          name: 'Clothing, Shoes & Accessories',
          path: 'Clothing, Shoes & Accessories',
        };
        parsedAnalysis.category_suggestions = [
          { id: '11450', name: 'Clothing, Shoes & Accessories', path: 'Clothing, Shoes & Accessories' },
        ];
      }
    } catch {
      // safe fallback
      parsedAnalysis.ebay_category_id = '11450';
      parsedAnalysis.ebay_category_name = 'Clothing, Shoes & Accessories';
      parsedAnalysis.ebay_category_path = 'Clothing, Shoes & Accessories';
      parsedAnalysis.category = {
        id: '11450',
        name: 'Clothing, Shoes & Accessories',
        path: 'Clothing, Shoes & Accessories',
      };
      parsedAnalysis.category_suggestions = [
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
            analysis: parsedAnalysis,
            image_urls: images,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {
        // non-fatal
      }
    }

    return res.status(200).json({
      success: true,
      data: parsedAnalysis,
      images_processed: base64Images.length,
      session_id,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

/* -------------------------------------------------------
   Dynamic, policy-safe mapper
------------------------------------------------------- */
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

  // Build broad candidate set once
  const globalCandidates = buildCandidates(det, title || '', description || '', categoryPath || '');

  const out: any[] = [];

  for (const aspect of ebayAspects) {
    const name: string = aspect?.name || '';
    const n = norm(name);
    const options: string[] = aspect?.values || [];
    const required = !!aspect?.required;
    const selectionOnly = !!aspect?.selectionOnly || aspect?.type === 'SelectionOnly';
    const multi = !!aspect?.multi;
    const freeTextAllowed = aspect?.freeTextAllowed !== false && !selectionOnly;

    // Prepare specific candidates by aspect name
    const specificCandidates: string[] = [];

    // pre-seed with known fields when names match
    if (n.includes('brand') && det.brand) specificCandidates.push(det.brand);
    if ((n === 'size' || n.includes('waist') || n.includes('length')) && det.size) specificCandidates.push(det.size);
    if ((n.includes('color') || n.includes('colour')) && det.colors?.length) specificCandidates.push(...det.colors);
    if ((n.includes('material') || n.includes('fabric')) && det.materials?.length) specificCandidates.push(...det.materials);
    if (n.includes('department') && dept) specificCandidates.push(dept);
    if (n.includes('size type') && sizeType) specificCandidates.push(sizeType);
    if (n === 'style' && det.style) specificCandidates.push(det.style);
    if (n === 'type' && det.type) specificCandidates.push(det.type);
    if (n.includes('product line') && det.productLine) specificCandidates.push(det.productLine);
    if (n.includes('feature') && Array.isArray(det.features)) specificCandidates.push(...det.features);

    // Combine with global candidates for robustness
    const candidates = Array.from(new Set([...specificCandidates, ...globalCandidates]));

    let value = '';
    let reason = 'unset';

    // Handle multi-select (e.g., Features)
    if (multi) {
      if (selectionOnly) {
        const picks = chooseMultiOptions(candidates, options, leaf, 5);
        value = picks.join(', ');
        reason = 'multi/selectionOnly: top-scoring options';
      } else {
        // Prefer options but can also free-text; keep options for consistency
        const picks = chooseMultiOptions(candidates, options, leaf, 5);
        value = picks.join(', ');
        reason = 'multi/freeTextAllowed: preferred options';
      }
    } else {
      // Single-value
      if (selectionOnly) {
        // Policy-safe: choose closest option (never type free text)
        value = chooseSingleOption(candidates, options, leaf);
        reason = 'single/selectionOnly: best-scoring option';
      } else {
        // Free text allowed: if we have a strong literal (e.g., brand "Quince"), prefer it
        // else also allow closest option when it clearly matches
        // Heuristic: if a direct literal exists in specificCandidates, use it
        const literal = specificCandidates.find(s => !!s);
        if (literal) {
          // If literal also matches an option closely, we can still snap to option
          const bestOpt = chooseSingleOption([literal], options, leaf);
          const bestScore = scoreOption(bestOpt, [literal], leaf);
          if (bestScore >= 0.85) {
            value = bestOpt;
            reason = 'single/freeTextAllowed: snapped literal to option';
          } else {
            value = literal;
            reason = 'single/freeTextAllowed: literal value';
          }
        } else if (options?.length) {
          value = chooseSingleOption(candidates, options, leaf);
          reason = 'single/freeTextAllowed: best-scoring option (no literal)';
        } else {
          value = '';
          reason = 'single/freeTextAllowed: no options and no literal';
        }
      }
    }

    // Backfill for required aspects if still blank
    if (required && !value) {
      if (selectionOnly && options?.length) {
        value = chooseSingleOption(candidates, options, leaf);
        reason += ' | required backfill: selectionOnly best option';
      } else {
        // free text: only set if we have some reasonable candidate
        const cand = specificCandidates[0] || candidates[0] || '';
        if (cand) {
          value = cand;
          reason += ' | required backfill: freeText literal';
        } else {
          // leave blank but flag
          needs_review[n] = 'required but unmatched';
          reason += ' | required still empty (flagged)';
        }
      }
    }

    // Brand policy: if selection-only and brand literal not in options → leave blank + flag
    if (n.includes('brand') && selectionOnly) {
      const literalBrand = det.brand || '';
      if (literalBrand && !options.some(o => norm(o) === norm(literalBrand))) {
        // Only override if we accidentally set a wrong option by scoring
        if (!options.some(o => norm(o) === norm(value))) {
          value = ''; // do not guess brands
          needs_review['brand'] = `Detected brand "${literalBrand}" not in allowed list`;
          reason += ' | brand policy: cleared & flagged';
        }
      }
    }

    debug.decisions[name] = {
      selectionOnly, multi, required, freeTextAllowed,
      chosen: value, reason,
      sampleCandidates: candidates.slice(0, 10),
      optionsPreview: options.slice(0, 10)
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
