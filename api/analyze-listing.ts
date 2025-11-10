// api/analyze-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: { sizeLimit: '50mb' },
  },
  maxDuration: 60,
};

/* =========================
   Generic helpers
   ========================= */
function norm(s: string) {
  return (s || '').toLowerCase().trim();
}
function tokens(s: string) {
  return norm(s).split(/[\s\/,&-]+/).filter(Boolean);
}
function includesAny(hay: string, needles: string[]) {
  const h = norm(hay);
  return needles.some((n) => h.includes(norm(n)));
}

/* =========================
   Snap/normalize helpers
   ========================= */
function softNorm(s: string) {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/’/g, "'");
}
function snapOne(raw: string, options: string[] = [], selectionOnly = false) {
  if (!raw) return '';
  const nraw = softNorm(raw);
  if (!options?.length) return selectionOnly ? '' : raw;

  // exact
  let found = options.find((o) => softNorm(o) === nraw);
  if (found) return found;

  // starts-with (both ways)
  found = options.find(
    (o) => softNorm(o).startsWith(nraw) || nraw.startsWith(softNorm(o)),
  );
  if (found) return found;

  // contains (both ways)
  found = options.find(
    (o) => softNorm(o).includes(nraw) || nraw.includes(softNorm(o)),
  );
  if (found) return found;

  return selectionOnly ? '' : raw;
}
function snapMany(candidates: string[], options: string[], selectionOnly: boolean) {
  const out: string[] = [];
  for (const c of candidates) {
    const v = snapOne(c, options, selectionOnly);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/* =========================
   Domain inference helpers
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
  if (includesAny(hay, ['plus', 'extended'])) return 'Plus';
  return 'Regular';
}
function parseMaterialsFromText(text: string) {
  const tokensSet = new Set<string>();
  if (!text) return Array.from(tokensSet);

  const MAT_MAP: Record<string, string> = {
    cotton: 'Cotton',
    polyester: 'Polyester',
    spandex: 'Spandex',
    elastane: 'Elastane',
    rayon: 'Rayon',
    nylon: 'Nylon',
    wool: 'Wool',
    acrylic: 'Acrylic',
    linen: 'Linen',
    silk: 'Silk',
    leather: 'Leather',
    viscose: 'Viscose',
    modal: 'Modal',
    cashmere: 'Cashmere',
  };

  // pattern: 60% cotton, 40% polyester
  const re = /(\d{1,3})\s*%\s*([a-z][a-z\s\-]+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const mat = softNorm(m[2]).replace(/[^a-z\s]/g, '').trim();
    const key = mat.split(' ')[0];
    if (MAT_MAP[key]) tokensSet.add(MAT_MAP[key]);
  }

  // fallback: plain mentions (e.g., “cotton blend”)
  for (const k of Object.keys(MAT_MAP)) {
    if (new RegExp(`\\b${k}\\b`, 'i').test(text)) tokensSet.add(MAT_MAP[k]);
  }

  return Array.from(tokensSet);
}
function inferPattern(text: string) {
  const t = softNorm(text);
  const PAT: Record<string, string> = {
    plaid: 'Plaid',
    stripe: 'Striped',
    striped: 'Striped',
    floral: 'Floral',
    camo: 'Camouflage',
    camouflage: 'Camouflage',
    solid: 'Solid',
    polka: 'Polka Dot',
    dot: 'Polka Dot',
    animal: 'Animal Print',
    houndstooth: 'Houndstooth',
    geometric: 'Geometric',
    graphic: 'Graphic',
    'tie dye': 'Tie-Dye',
    'tie-dye': 'Tie-Dye',
  };
  for (const k of Object.keys(PAT)) {
    if (new RegExp(`\\b${k}\\b`, 'i').test(t)) return PAT[k];
  }
  return '';
}
function inferSeason(text: string) {
  const t = softNorm(text);
  const out: string[] = [];
  const add = (s: string) => !out.includes(s) && out.push(s);

  if (/\bwool|fleece|down|thermal|insulated|winter\b/.test(t)) add('Winter');
  if (/\bcozy|sweater|hoodie\b/.test(t)) add('Fall');
  if (/\bbreathable|lightweight|shorts|tank|summer\b/.test(t)) add('Summer');
  if (/\bflannel|rain|wind|spring\b/.test(t)) add('Spring');
  return out;
}
function inferFeatures(text: string) {
  const t = softNorm(text);
  const features: string[] = [];
  const add = (s: string) => { if (!features.includes(s)) features.push(s); };

  if (/\bzip|zipper\b/.test(t)) add('Zip');
  if (/\bpockets?\b/.test(t)) add('Pockets');
  if (/\bdrawstring\b/.test(t)) add('Drawstring');
  if (/\belastic waist\b/.test(t)) add('Elastic Waist');
  if (/\bmoisture|wicking\b/.test(t)) add('Moisture Wicking');
  if (/\bbreathable\b/.test(t)) add('Breathable');
  if (/\blined\b/.test(t)) add('Lined');
  if (/\binsulated\b/.test(t)) add('Insulated');
  if (/\blightweight\b/.test(t)) add('Lightweight');
  if (/\bheavyweight\b/.test(t)) add('Heavyweight');
  return features;
}

/* =========================
   Main handler
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

    // 1) Download/convert to base64 (max 12)
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

    // 2) OpenAI Vision → raw JSON
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
    {"name": "Product Line", "value": ""},
    {"name": "Features", "value": "", "values": ["array of feature words if helpful"]}
  ],
  "detected": {
    "brand": "visible brand name or null",
    "size": "visible size or null",
    "colors": ["primary color", "secondary color if any"],
    "materials": ["visible materials or composition text if readable"],
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

    // 3) eBay: suggested category → specifics
    try {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const ebayApiUrl = `${origin}/api/ebay-categories`;

      // get suggested category
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

        // fetch specifics for chosen category
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
          parsedAnalysis.category_specifics_schema = aspects;

          // Build a single merged text signal for inference
          const signalText = [
            parsedAnalysis.title || '',
            parsedAnalysis.description || '',
            (parsedAnalysis.detected?.brand || ''),
            (parsedAnalysis.detected?.size || ''),
            (parsedAnalysis.detected?.materials || []).join(' '),
            (parsedAnalysis.detected?.colors || []).join(' '),
          ].join(' . ');

          // ——— Map AI + inference → eBay specifics ———
          const det = parsedAnalysis.detected || {};
          const dept = inferDepartmentFromPath(
            parsedAnalysis.category?.path || parsedAnalysis.ebay_category_path || ''
          );
          const sizeType = inferSizeType({
            size: det.size,
            title: parsedAnalysis.title,
            categoryPath: parsedAnalysis.category?.path || parsedAnalysis.ebay_category_path || '',
          });

          const leafType = (() => {
            const leaf = (parsedAnalysis.category?.path || parsedAnalysis.ebay_category_path || '')
              .split('>')
              .pop()?.trim() || '';
            const segments = (leaf || '').split('/').map((s) => s.trim()).filter(Boolean);
            return segments.length ? segments[segments.length - 1] : leaf;
          })();

          const outSpecifics: any[] = [];

          for (const aspect of aspects) {
            const name: string = aspect.name;
            const options: string[] = aspect.values || [];
            const selectionOnly: boolean = !!aspect.selectionOnly;
            const multi: boolean = !!aspect.multi;

            let candidates: string[] = [];
            let single = '';

            switch (softNorm(name)) {
              case 'material':
              case 'fabric type': {
                const fromDetected = Array.isArray(det.materials) ? det.materials : [];
                const fromText = parseMaterialsFromText(signalText);
                const pool = Array.from(new Set([
                  ...fromDetected,
                  ...fromText,
                  /blend/i.test(signalText) ? 'Blend' : '',
                ].filter(Boolean)));
                candidates = pool;
                break;
              }

              case 'size type': {
                single = sizeType;
                break;
              }

              case 'pattern': {
                single = inferPattern(signalText);
                break;
              }

              case 'season': {
                candidates = inferSeason(signalText);
                break;
              }

              case 'features': {
                const aiFeat = Array.isArray(det.features) ? det.features : [];
                const inferred = inferFeatures(signalText);
                candidates = Array.from(new Set([...aiFeat, ...inferred]));
                break;
              }

              case 'department': {
                single = dept;
                break;
              }

              case 'brand': {
                single = det.brand || '';
                break;
              }

              case 'color':
              case 'colour': {
                single = Array.isArray(det.colors) ? det.colors[0] : det.colors || '';
                break;
              }

              case 'size':
              case 'waist size':
              case 'inseam': {
                single = det.size || '';
                break;
              }

              case 'style': {
                single = det.style || '';
                break;
              }

              case 'type': {
                single = det.type || leafType;
                break;
              }

              case 'product line': {
                single = det.productLine || '';
                break;
              }

              default: {
                // Fall back to AI "item_specifics" for this exact name
                const aiVal = (parsedAnalysis.item_specifics || [])
                  .find((s: any) => softNorm(s.name) === softNorm(name))?.value;
                if (Array.isArray(aiVal)) candidates = aiVal;
                else if (typeof aiVal === 'string') single = aiVal;
              }
            }

            let value: any = '';
            if (multi) {
              const snapped = snapMany(candidates, options, selectionOnly);
              if (!snapped.length && single) {
                const one = snapOne(single, options, selectionOnly);
                if (one) snapped.push(one);
              }
              value = snapped;
            } else {
              value = snapOne(single || candidates[0] || '', options, selectionOnly);
            }

            // Respect selectionOnly constraints strictly
            if (selectionOnly) {
              if (multi) value = (value || []).filter((v: string) => options.includes(v));
              else if (value && !options.includes(value)) value = '';
            }

            outSpecifics.push({
              name,
              value,
              required: !!aspect.required,
              options,
              multi,
              selectionOnly,
              freeTextAllowed: !!aspect.freeTextAllowed,
            });
          }

          parsedAnalysis.item_specifics = outSpecifics;
        } else {
          parsedAnalysis.category_specifics_schema = [];
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
      // taxonomy failure fallback
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

    // 4) Optional Make.com webhook (non-fatal)
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
      } catch { /* ignore */ }
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
