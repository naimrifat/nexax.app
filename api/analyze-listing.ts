// api/analyze-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

/* -----------------------------------------
   Small utilities
----------------------------------------- */
const norm = (s: string) => (s || '').toLowerCase().trim();
const toks = (s: string) => norm(s).split(/[^a-z0-9%]+/).filter(Boolean);
const uniq = <T,>(a: T[]) => Array.from(new Set(a));
const take = <T,>(a: T[] | undefined, n = 1) => (Array.isArray(a) ? a.slice(0, n) : []);

const softEq = (a: string, b: string) => norm(a) === norm(b);
const softStart = (a: string, b: string) =>
  norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a));
const softIncl = (a: string, b: string) =>
  norm(a).includes(norm(b)) || norm(b).includes(norm(a));

const tokenOverlap = (a: string, b: string) => {
  const A = new Set(toks(a));
  const B = new Set(toks(b));
  let score = 0;
  A.forEach((x) => {
    if (B.has(x)) score++;
  });
  return score;
};

const joinVals = (vals: string[]) => uniq(vals.filter(Boolean)).join(', ');

/* -----------------------------------------
   Synonyms / normalizers for common fields
----------------------------------------- */
const VALUE_SYNONYMS: Record<string, string[]> = {
  // size type
  Regular: ['regular', 'standard'],
  Petite: ['petite'],
  Tall: ['tall', 'long'],
  Plus: ['plus', 'plus-size', 'extended'],

  // departments
  Men: ["men", "men's", 'male'],
  Women: ["women", "women's", 'female'],
  Boys: ["boys", "boy's"],
  Girls: ["girls", "girl's"],
  'Unisex Adult': ['unisex', 'adult-unisex'],

  // fabrics / materials
  Cotton: ['cotton', '100% cotton', 'cotton 100%'],
  'Cotton Blend': ['cotton/poly', 'cotton blend'],
  Polyester: ['polyester', 'poly'],
  'Polyester Blend': ['polyester blend', 'poly blend'],
  Spandex: ['spandex', 'elastane', 'lycra'],
  Nylon: ['nylon'],
  Wool: ['wool'],
  Linen: ['linen'],
  Silk: ['silk'],
  Leather: ['leather'],

  // patterns
  Solid: ['solid', 'plain'],
  Striped: ['stripe', 'striped', 'pinstripe'],
  Plaid: ['plaid', 'checkered', 'tartan', 'gingham'],
  Floral: ['floral', 'flower'],
  Graphic: ['graphic', 'logo', 'print'],

  // features / closures (examples)
  'Button-Down Collar': ['button down collar', 'button-down collar'],
  Zipper: ['zip', 'zipper'],
  Buttons: ['button', 'buttons'], // generic
};

/* -----------------------------------------
   Guards for sensitive aspects (compliance)
----------------------------------------- */
const SENSITIVE_EXACT_ONLY = new Set(['brand']); // never guess brand

/* -----------------------------------------
   Option matching
----------------------------------------- */
function pickBestOption(target: string, options: string[] = []): { value: string; score: number } {
  const t = target || '';
  if (!t) return { value: '', score: 0 };
  if (!options?.length) return { value: t, score: 0 };

  // 1) exact
  for (const o of options) if (softEq(o, t)) return { value: o, score: 100 };

  // 2) synonyms
  for (const [canon, alts] of Object.entries(VALUE_SYNONYMS)) {
    if (alts.some((a) => softEq(a, t) || softIncl(a, t))) {
      const hit = options.find((o) => softEq(o, canon) || softIncl(o, canon));
      if (hit) return { value: hit, score: 90 };
    }
  }

  // 3) starts-with/contains
  for (const o of options) if (softStart(o, t)) return { value: o, score: 75 };
  for (const o of options) if (softIncl(o, t)) return { value: o, score: 65 };

  // 4) token overlap
  let best = '';
  let bestScore = -1;
  for (const o of options) {
    const sc = tokenOverlap(o, t);
    if (sc > bestScore) {
      bestScore = sc;
      best = o;
    }
  }
  return { value: best || '', score: best ? 50 : 0 };
}

function mapValuesToOptions(
  candidates: string[] | string,
  options: string[],
  multi: boolean,
  selectionOnly: boolean,
  sensitiveExactOnly = false
): { value: string; raw: string[] } {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);

  if (!list.length) return { value: '', raw: [] };

  // Sensitive fields (brand): only accept exact or OCR-confirmed matches
  if (sensitiveExactOnly) {
    const exact = list.find((c) => options.some((o) => softEq(o, c)));
    return { value: exact || '', raw: exact ? [exact] : [] };
  }

  // SelectionOnly: must pick from options
  if (selectionOnly) {
    if (multi) {
      const ranked = list
        .map((c) => pickBestOption(c, options))
        .filter((x) => x.value)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.value);
      return { value: joinVals(ranked), raw: ranked };
    } else {
      const best = list
        .map((c) => pickBestOption(c, options))
        .sort((a, b) => b.score - a.score)[0];
      return { value: best?.value || '', raw: best?.value ? [best.value] : [] };
    }
  }

  // Free text allowed
  if (multi) return { value: joinVals(list), raw: uniq(list) };
  return { value: list[0], raw: [list[0]] };
}

/* -----------------------------------------
   Department/size-type inference helpers
----------------------------------------- */
function inferDepartment(path: string) {
  const p = norm(path);
  if (p.includes('men')) return 'Men';
  if (p.includes('women')) return 'Women';
  if (p.includes('boys')) return 'Boys';
  if (p.includes('girls')) return 'Girls';
  if (p.includes('unisex')) return 'Unisex Adult';
  return '';
}

function inferSizeType(hay: string) {
  const h = norm(hay);
  if (h.includes('petite')) return 'Petite';
  if (h.includes('tall') || h.includes('long')) return 'Tall';
  if (h.includes('plus') || h.includes('extended')) return 'Plus';
  return 'Regular';
}

/* -----------------------------------------
   MAIN HANDLER
----------------------------------------- */
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

    // 1) Download -> base64 (max 12)
    const base64Images = await Promise.all(
      images.slice(0, 12).map(async (url: string) => {
        const optimizedUrl = url.includes('cloudinary.com')
          ? url.replace('/upload/', '/upload/w_1280,h_1280,c_limit,q_auto,f_jpg/')
          : url;
        const r = await fetch(optimizedUrl);
        if (!r.ok) throw new Error(`Failed to download image: ${r.status}`);
        const buf = await r.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        const mime = r.headers.get('content-type') || 'image/jpeg';
        return `data:${mime};base64,${b64}`;
      })
    );

    // 2) OpenAI – ask for a *fact graph* + normalized signals
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
        max_tokens: 2500,
        messages: [
          {
            role: 'system',
            content: [
              'You are an expert eBay lister.',
              'Return ONLY strict JSON (no markdown).',
              'Extract a *fact graph* from all photos: OCR brand/size/material/labels, visible features (collar, cuff, neckline, sleeve length, pattern, closures, fabric content with percentages), measurements if printed (inseam, chest, neck, sleeve).',
              'Normalize obvious synonyms (e.g., “poly”→“polyester”, “solid” pattern).',
              'Also output a curated list of canonical tokens that can help match against eBay aspect options.',
            ].join(' '),
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
  "title": "...(≤80 chars)",
  "description": "...",
  "category": "breadcrumb like 'Clothing, Shoes & Accessories > Men > Men's Clothing > Shirts > Dress Shirts'",
  "facts": {
    "brand": "literal brand text if visible, else null",
    "size": "single size if shown (e.g., 16, XL, 32x30), else null",
    "colors": ["primary", "secondary"],
    "materials": [
      {"name":"Cotton","percent":60},
      {"name":"Polyester","percent":40}
    ],
    "pattern": "solid/striped/plaid/graphic/... if visually clear",
    "collarStyle": "e.g., Button-Down, Spread",
    "neckSize": "if printed",
    "sleeveLength": "Short/Long/Three-Quarter, or numeric if shown",
    "cuffStyle": "e.g., French, Barrel",
    "closure": "e.g., Buttons, Zipper, Pullover",
    "fit": "e.g., Slim/Regular/Relaxed",
    "features": ["keywords like 'Moisture Wicking','Stretch','Adjustable Waist' etc],
    "measurements": {"inseam":"", "chest":"", "waist":"", "neck":"", "sleeve":""}
  },
  "tokens": ["short helpful tokens derived from text & visuals"],
  "keywords": ["search terms"]
}
Keep fields null/empty when uncertain—do NOT hallucinate brands.`,
              },
            ],
          },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const text = await openaiResponse.text();
      throw new Error(`OpenAI error: ${openaiResponse.status}: ${text}`);
    }
    const openaiJson = await openaiResponse.json();
    const content = openaiJson?.choices?.[0]?.message?.content || '{}';
    const analysis = JSON.parse(content || '{}');

    // Normalize the "facts" block
    const facts = analysis?.facts || {};
    const title = analysis?.title || '';
    const description = analysis?.description || '';
    const categoryPathText =
      analysis?.category ||
      analysis?.category_path ||
      analysis?.categoryName ||
      analysis?.detected?.category ||
      '';

    // 3) Taxonomy: suggest category + fetch aspects
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const taxonomyUrl = `${origin}/api/ebay-categories`;

    // Suggested category (based on title+keywords)
    let chosenCategoryId = '';
    let chosenCategoryPath = categoryPathText;

    try {
      const sugRes = await fetch(taxonomyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getSuggestedCategories',
          title,
          keywords: analysis?.keywords || [],
        }),
      });
      if (sugRes.ok) {
        const sug = await sugRes.json();
        chosenCategoryId = sug.categoryId;
        chosenCategoryPath = sug.categoryPath || sug.categoryName || chosenCategoryPath;
        analysis.category_suggestions = sug.suggestions || [];
      }
    } catch {
      // ignore; fallback below
    }

    if (!chosenCategoryId) {
      // conservative fallback
      chosenCategoryId = '11450';
      if (!chosenCategoryPath) chosenCategoryPath = 'Clothing, Shoes & Accessories';
    }

    // Fetch aspects for that category
    let aspects: any[] = [];
    try {
      const aspRes = await fetch(taxonomyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getCategorySpecifics',
          categoryId: chosenCategoryId,
        }),
      });
      if (aspRes.ok) {
        const aspData = await aspRes.json();
        aspects = aspData?.aspects || [];
      }
    } catch {
      aspects = [];
    }

    // 4) Build a robust candidate dictionary
    const candidates: Record<string, string[] | string> = {};
    const add = (key: string, val?: string | string[]) => {
      if (!val || (Array.isArray(val) && !val.length)) return;
      if (Array.isArray(val)) {
        candidates[key] = uniq([...(Array.isArray(candidates[key]) ? (candidates[key] as string[]) : []), ...val]);
      } else {
        candidates[key] = uniq([...(Array.isArray(candidates[key]) ? (candidates[key] as string[]) : []), val]);
      }
    };

    const tokensBag = uniq([...(analysis?.tokens || []), ...toks(title), ...toks(description)]);

    // Department / size type hints
    const depGuess = inferDepartment(chosenCategoryPath);
    const sizeTypeGuess = inferSizeType([title, description, chosenCategoryPath, facts?.size].filter(Boolean).join(' '));

    // Materials -> also derive blends
    const materialNames = (Array.isArray(facts?.materials) ? facts.materials : [])
      .map((m: any) => String(m?.name || ''))
      .filter(Boolean);
    const materialTokens: string[] = [];
    if (materialNames.length) {
      const lower = materialNames.map(norm);
      if (lower.includes('cotton') && lower.includes('polyester')) materialTokens.push('Cotton Blend', 'Polyester Blend');
    }
    add('Material', uniq([...materialNames, ...materialTokens]));

    add('Brand', facts?.brand || '');
    add('Size', facts?.size || '');
    add('Color', Array.isArray(facts?.colors) ? facts.colors : facts?.colors || '');
    add('Pattern', facts?.pattern || '');
    add('Collar Style', facts?.collarStyle || '');
    add('Neck Size', facts?.neckSize || facts?.measurements?.neck || '');
    add('Sleeve Length', facts?.sleeveLength || facts?.measurements?.sleeve || '');
    add('Cuff Style', facts?.cuffStyle || '');
    add('Closure', facts?.closure || '');
    add('Fit', facts?.fit || '');
    add('Features', Array.isArray(facts?.features) ? facts.features : facts?.features || '');
    add('Inseam', facts?.measurements?.inseam || '');
    add('Chest Size', facts?.measurements?.chest || '');
    add('Waist Size', facts?.measurements?.waist || '');

    // Category-derived hints
    const leaf = (chosenCategoryPath.split('>')[chosenCategoryPath.split('>').length - 1] || '').trim();
    add('Type', leaf);

    // Department / Size Type candidates
    add('Department', depGuess);
    add('Size Type', sizeTypeGuess);

    // 5) Map to aspects dynamically
    const mapped: any[] = [];
    const unmappedDebug: any[] = [];
    const evidence: Record<string, any> = {};

    for (const a of aspects) {
      const name: string = a?.name || '';
      const options: string[] = a?.values || [];
      const selectionOnly = !!a?.selectionOnly;
      const multi = !!a?.multi;
      const required = !!a?.required;

      const n = norm(name);

      // primary key lookup
      let sourceCandidates: string[] | string = candidates[name];

      // heuristic fallbacks by normalized name
      if (!sourceCandidates) {
        if (n === 'department') sourceCandidates = candidates['Department'];
        else if (n.includes('size type')) sourceCandidates = candidates['Size Type'];
        else if (n === 'size' || n.includes('waist size') || n.includes('inseam')) sourceCandidates = candidates['Size'] || candidates['Inseam'] || candidates['Waist Size'];
        else if (n.includes('color') || n.includes('colour')) sourceCandidates = candidates['Color'];
        else if (n.includes('material') || n.includes('fabric')) sourceCandidates = candidates['Material'];
        else if (n.includes('pattern')) sourceCandidates = candidates['Pattern'];
        else if (n.includes('collar')) sourceCandidates = candidates['Collar Style'];
        else if (n.includes('neck') && n.includes('size')) sourceCandidates = candidates['Neck Size'];
        else if (n.includes('sleeve')) sourceCandidates = candidates['Sleeve Length'];
        else if (n.includes('cuff')) sourceCandidates = candidates['Cuff Style'];
        else if (n.includes('closure')) sourceCandidates = candidates['Closure'];
        else if (n === 'fit') sourceCandidates = candidates['Fit'];
        else if (n.includes('feature')) sourceCandidates = candidates['Features'];
        else if (n === 'type') sourceCandidates = candidates['Type'];
        else if (n.includes('chest')) sourceCandidates = candidates['Chest Size'];
      }

      // if still nothing, try to synthesize from tokens for selectionOnly fields
      if (!sourceCandidates && selectionOnly) {
        // try to pick from options based on title/description tokens
        const ranked = options
          .map((o) => ({ o, sc: tokenOverlap(o, `${title} ${description} ${leaf}`) }))
          .sort((x, y) => y.sc - x.sc);
        if (ranked[0]?.sc > 0) sourceCandidates = ranked[0].o;
      }

      // map to allowed options (or keep free text)
      const sensitive = SENSITIVE_EXACT_ONLY.has(n);
      const mappedVal = mapValuesToOptions(sourceCandidates || '', options, multi, selectionOnly, sensitive);

      // Coverage pass for required selectionOnly fields still blank:
      if (required && selectionOnly && !mappedVal.value) {
        // conservative choice: pick option most related to title/leaf/tokens
        const best = options
          .map((o) => ({
            o,
            sc: Math.max(
              tokenOverlap(o, title),
              tokenOverlap(o, leaf),
              tokensBag.includes(norm(o)) ? 1 : 0
            ),
          }))
          .sort((a, b) => b.sc - a.sc)[0];
        if (best && best.sc > 0) {
          mappedVal.value = best.o;
          mappedVal.raw = [best.o];
        }
      }

      // Assemble
      mapped.push({
        name,
        value: mappedVal.value,
        required,
        type: a?.type,
        options,
        selectionOnly,
        multi,
        freeTextAllowed: !!a?.freeTextAllowed,
      });

      evidence[name] = {
        candidates: sourceCandidates || null,
        chosen: mappedVal.raw,
        selectionOnly,
        multi,
      };

      if (!mappedVal.value && required) {
        unmappedDebug.push({ name, optionsCount: options.length });
      }
    }

    // 6) Build final response object
    const responsePayload = {
      title,
      description,
      category: { id: chosenCategoryId, path: chosenCategoryPath },
      item_specifics: mapped,
      ebay_category_id: chosenCategoryId,
      ebay_category_path: chosenCategoryPath,
      category_specifics_schema: aspects,
      debug: {
        evidence,
        unmappedRequired: unmappedDebug,
        tokensUsed: tokensBag.slice(0, 60),
      },
    };

    // Optional webhook for Make.com
    if (process.env.VITE_MAKE_WEBHOOK_URL) {
      try {
        await fetch(process.env.VITE_MAKE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id,
            analysis: responsePayload,
            image_urls: images,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch { /* ignore */ }
    }

    return res.status(200).json({
      success: true,
      data: responsePayload,
      images_processed: base64Images.length,
      session_id,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
    });
  }
}
