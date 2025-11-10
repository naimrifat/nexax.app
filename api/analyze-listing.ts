// api/analyze-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: { sizeLimit: '50mb' },
  },
  maxDuration: 60,
};

// -----------------------------
// Helpers (generic)
// -----------------------------
function norm(s: string) {
  return (s || '').toLowerCase().trim();
}

function includesAny(hay: string, needles: string[]) {
  const h = norm(hay);
  return needles.some((n) => h.includes(norm(n)));
}

function tokens(s: string) {
  return norm(s).split(/[\s\/,&-]+/).filter(Boolean);
}

// choose closest option for selection-only aspects
function pickBestOption(target: string, options: string[] = []) {
  if (!target) return '';
  if (!options?.length) return target;

  const t = norm(target);

  // 1) exact
  const exact = options.find((o) => norm(o) === t);
  if (exact) return exact;

  // 2) synonyms (common clothing fields)
  const synonyms: Record<string, string[]> = {
    regular: ['regular', 'standard'],
    petite: ['petite'],
    tall: ['tall', 'long'],
    plus: ['plus', 'plus size', 'extended'],
    men: ['men', "men's", 'male'],
    women: ['women', "women's", 'female'],
    unisex: ['unisex'],
    boys: ['boys', "boy's"],
    girls: ['girls', "girl's"],
    polyester: ['poly', 'polyester'],
    cotton: ['cotton'],
    leather: ['leather'],
    wool: ['wool'],
    silk: ['silk'],
    linen: ['linen'],
    nylon: ['nylon'],
    spandex: ['spandex', 'elastane', 'lycra'],
  };
  for (const opt of options) {
    const o = norm(opt);
    for (const [canon, alts] of Object.entries(synonyms)) {
      if (alts.includes(t) && o.includes(canon)) return opt;
      if (alts.some((a) => o.includes(a)) && t.includes(canon)) return opt;
    }
  }

  // 3) token-overlap score
  const tTokens = tokens(t);
  let best = '';
  let bestScore = -1;
  for (const opt of options) {
    const score = tTokens.filter((x) => tokens(opt).includes(x)).length;
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }
  return best || options[0] || target;
}

// infer department from breadcrumb
function inferDepartmentFromPath(path: string) {
  const p = norm(path);
  if (p.includes('men')) return 'Men';
  if (p.includes('women')) return 'Women';
  if (p.includes('boys')) return 'Boys';
  if (p.includes('girls')) return 'Girls';
  if (p.includes('unisex')) return 'Unisex Adult';
  return '';
}

// infer size type from hints
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

// -----------------------------
// Main handler
// -----------------------------
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

    // 1) Download/convert to base64 (12 max)
    const base64Images = await Promise.all(
      images.slice(0, 12).map(async (url: string, index: number) => {
        // Cloudinary optimization passthrough
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
    {"name": "Product Line", "value": ""},
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

    // 3) eBay category suggestion + specifics
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
          parsedAnalysis.category_specifics_schema = specificsData.aspects || [];

          // map AI → eBay aspects (ALL common fields)
          parsedAnalysis.item_specifics = mapAIToEbayFields(
            parsedAnalysis.detected,
            specificsData.aspects || [],
            parsedAnalysis.category?.path || parsedAnalysis.ebay_category_path || '',
            parsedAnalysis.title || ''
          );
        } else {
          // still return something
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
    } catch (err) {
      // safest default on taxonomy failure
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

    // 4) Optional Make.com webhook
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

// -------------------------------------------
// Rich mapper: fills ALL common clothing aspects
// -------------------------------------------
function mapAIToEbayFields(
  aiDetected: any,
  ebayAspects: any[],
  categoryPath?: string,
  title?: string
) {
  const det = aiDetected || {};

  const brand = det.brand || '';
  const size = det.size || '';
  const color = Array.isArray(det.colors) ? det.colors[0] : det.colors || '';
  const material = Array.isArray(det.materials) ? det.materials[0] : det.materials || '';
  const style = det.style || '';
  const typeGuess = det.type || '';
  const productLine = det.productLine || '';
  const featuresArr: string[] = det.features || [];

  const dept = inferDepartmentFromPath(categoryPath || '');
  const sizeType = inferSizeType({ size, title, categoryPath });

  const leafType = (() => {
    const leaf = (categoryPath || '').split('>').pop()?.trim() || '';
    // Sometimes leaf contains "Men's Clothing" etc. Prefer last non-generic token when possible.
    const segments = (leaf || '').split('/').map((s) => s.trim()).filter(Boolean);
    return segments.length ? segments[segments.length - 1] : leaf;
  })();

  const mapped: any[] = [];

  for (const aspect of ebayAspects) {
    const name = aspect.name || '';
    const n = norm(name);
    const opts: string[] = aspect.values || [];
    const selectionOnly = !!aspect.selectionOnly;
    const multi = !!aspect.multi;

    let value = '';

    if (n.includes('brand')) {
      value = selectionOnly ? pickBestOption(brand, opts) : brand;

    } else if (n === 'department') {
      value = selectionOnly ? pickBestOption(dept, opts) : dept;

    } else if (n.includes('size type')) {
      value = selectionOnly ? pickBestOption(sizeType, opts) : sizeType;

    } else if (n === 'size' || n.includes('waist size') || n.includes('inseam')) {
      value = selectionOnly ? pickBestOption(size, opts) : size;

    } else if (n.includes('color') || n.includes('colour')) {
      value = selectionOnly ? pickBestOption(color, opts) : color;

    } else if (n.includes('material') || n.includes('fabric')) {
      value = selectionOnly ? pickBestOption(material, opts) : material;

    } else if (n === 'style') {
      const guess = style;
      value = selectionOnly ? pickBestOption(guess, opts) : guess;

    } else if (n === 'type') {
      // Prefer AI guess, fallback to category leaf
      const guess = typeGuess || leafType;
      value = selectionOnly ? pickBestOption(guess, opts) : guess;

    } else if (n.includes('product line')) {
      value = selectionOnly ? pickBestOption(productLine, opts) : productLine;

    } else if (n.includes('features')) {
      if (featuresArr?.length) {
        if (selectionOnly || multi) {
          const chosen = featuresArr.map((f) => pickBestOption(f, opts)).filter(Boolean);
          value = chosen.join(', '); // keep UI simple (single string)
        } else {
          value = featuresArr[0];
        }
      } else {
        value = '';
      }

    } else {
      // unknown / less common aspects -> leave blank
      value = '';
    }

    mapped.push({
      name: aspect.name,
      value,
      required: !!aspect.required,
      type: aspect.type,
      options: opts,
      selectionOnly,
      multi,
      freeTextAllowed: !!aspect.freeTextAllowed,
    });
  }

  return mapped;
}
