// /api/analyze-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: { sizeLimit: '50mb' },
  },
  maxDuration: 60,
};

/* ----------------------------- *
 * Utilities
 * ----------------------------- */
const norm = (s: string) => (s || '').toLowerCase().trim();
const tokens = (s: string) => norm(s).split(/[\s\/,&-]+/).filter(Boolean);
const includesAny = (hay: string, needles: string[]) =>
  needles.some((n) => norm(hay).includes(norm(n)));

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
  if (includesAny(hay, ['plus', 'extended', 'big & tall', 'big and tall'])) return 'Plus';
  return 'Regular';
}

/* ----------------------------- *
 * Main handler
 * ----------------------------- */
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

    // 1) Download & convert images to base64 data URLs (up to 12)
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

    // 2) First pass: open analysis (free form, JSON only) to get detected signals
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert eBay product lister. Analyze ALL provided photos together. Return ONLY valid JSON.',
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
                text: `Return:

{
  "title": "SEO title, <=80 chars",
  "description": "Concise description (condition, materials, notable features).",
  "keywords": ["array","of","relevant","search","terms"],

  "detected": {
    "brand": "brand or null",
    "size": "size text if visible or null",
    "colors": ["primary","secondary?"],
    "materials": ["shell/outer","lining","insulation? if seen on tag"],
    "type": "type guess, e.g., puffer jacket",
    "style": "style words if any",
    "features": ["zipper","hood","pockets","maxi","floral","etc"],
    "tagText": "verbatim text snippets from care/brand tags if readable"
  }
}`,
              },
            ],
          },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      throw new Error(`OpenAI API error: ${openaiResponse.status} ${errorData}`);
    }

    const openaiResult = await openaiResponse.json();
    const analysisContent = openaiResult.choices?.[0]?.message?.content || '{}';

    let parsedAnalysis: any;
    try {
      parsedAnalysis = JSON.parse(analysisContent);
    } catch {
      throw new Error('Invalid response format from OpenAI');
    }

    // 3) Get suggested category & eBay specifics schema
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const ebayApiUrl = `${origin}/api/ebay-categories`;

    try {
      // suggested category from title/keywords
      const ebayResponse = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getSuggestedCategories',
          title: parsedAnalysis.title,
          keywords: parsedAnalysis.keywords || [],
        }),
      });

      if (!ebayResponse.ok) throw new Error(await ebayResponse.text());
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

      // fetch specifics (aspects)
      const specificsResponse = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getCategorySpecifics',
          categoryId: ebayData.categoryId,
        }),
      });

      if (!specificsResponse.ok) throw new Error(await specificsResponse.text());
      const specificsData = await specificsResponse.json();
      const aspects: any[] = specificsData?.aspects ?? [];
      parsedAnalysis.category_specifics_schema = aspects;

      /* ----------------------------------------------------
       * 4) Grounded pass: give the model the REAL options and
       *    forbid anything outside those lists.
       * ---------------------------------------------------- */
      const aspectSchema = aspects.map((a) => ({
        name: a.name,
        required: !!a.required,
        multi: !!a.multi,
        selectionOnly: a.type === 'SelectionOnly',
        options: (a.values || []).slice(0, 200), // keep prompt compact
      }));

      const leafCategory =
        parsedAnalysis.category?.path || parsedAnalysis.ebay_category_path || '';

      const groundedResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          max_tokens: 1400,
          messages: [
            {
              role: 'system',
              content: [
                "You are mapping product signals to eBay 'item specifics'.",
                'You MUST ONLY choose values from the allowed options per aspect.',
                'If unsure and selectionOnly=true, leave value empty.',
                'If multi=true, you may choose multiple allowed options.',
                'Base choices on visual cues, tag text, title, and description; include lightweight reasoning.',
                'Never invent options not in the list.',
                // light, category-agnostic heuristics:
                'Simple rules: puffer/insulated → Closure=Zipper if present in options; maxi → Length=Long; floral pattern → Theme=Floral/Flowers if present; "lining polyester" → Lining Material=Polyester; "shell nylon" → Outer Shell=Nylon; down present → Insulation=Down.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    categoryPath: leafCategory,
                    aspectSchema,
                    title: parsedAnalysis.title,
                    description: parsedAnalysis.description,
                    detected: parsedAnalysis.detected || {},
                  }),
                },
              ],
            },
          ],
        }),
      });

      if (!groundedResp.ok) {
        throw new Error(`OpenAI grounded mapping failed: ${groundedResp.status} ${await groundedResp.text()}`);
      }

      const groundedJson = await groundedResp.json();
      let grounded: any = {};
      try {
        grounded = JSON.parse(groundedJson.choices?.[0]?.message?.content || '{}');
      } catch {
        grounded = {};
      }

      // 5) Post-constraints & sanitizer (category-agnostic, no hardcoding to specific category)
      function sanitizeAndConstrain(groundedSpecs: any[], schema: any[], detected: any) {
        const byName = new Map(schema.map((s: any) => [String(s.name).toLowerCase(), s]));
        const out: any[] = [];

        for (const it of groundedSpecs || []) {
          const name = String(it?.name || '');
          const s = byName.get(name.toLowerCase());
          if (!s) continue;

          const opts: string[] = s.options || [];
          const selOnly = !!s.selectionOnly;
          const multi = !!s.multi;

          // normalize values
          let vals: string[] = [];
          if (Array.isArray(it?.values)) vals = it.values;
          else if (typeof it?.value === 'string' && it.value.trim()) vals = [it.value.trim()];

          // enforce selectionOnly
          if (selOnly) vals = vals.filter((v) => opts.includes(v));

          // dedupe
          vals = Array.from(new Set(vals));
          if (!multi && vals.length > 1) vals = [vals[0]];

          // light relational nudges
          const lc = name.toLowerCase();
          const detectedText = JSON.stringify(detected || {}).toLowerCase();
          const allText =
            `${parsedAnalysis.title || ''} ${parsedAnalysis.description || ''} ${detectedText}`.toLowerCase();

          if (lc === 'closure' && !vals.length) {
            // puffer/insulated → zipper if available
            if (opts.includes('Zipper') && /(puffer|down|insulat)/.test(allText)) vals = ['Zipper'];
          }

          if (
            (lc.includes('dress length') || lc.includes('coat length') || lc.includes('jacket/coat length')) &&
            !vals.length
          ) {
            if (opts.includes('Long') && /maxi/.test(allText)) vals = ['Long'];
            if (opts.includes('Short') && /\bmini\b/.test(allText)) vals = ['Short'];
            if (opts.includes('Midi') && /\bmidi\b/.test(allText)) vals = ['Midi'];
          }

          if (/lining material/.test(lc) && !vals.length) {
            if (opts.includes('Polyester') && /(lining).*(polyester)/.test(allText)) vals = ['Polyester'];
          }

          if ((/outer shell material|shell material/.test(lc) || /outer shell/.test(lc)) && !vals.length) {
            if (opts.includes('Nylon') && /(shell).*(nylon)/.test(allText)) vals = ['Nylon'];
          }

          if (/insulation material|fill/.test(lc) && !vals.length) {
            if (opts.includes('Down') && /\bdown\b/.test(allText)) vals = ['Down'];
          }

          out.push({
            name,
            required: !!s.required,
            multi,
            selectionOnly: selOnly,
            options: opts,
            value: multi ? vals : vals[0] || '',
          });
        }

        // ensure required aspects exist
        for (const s of schema) {
          if (!s.required) continue;
          if (!out.find((x) => x.name.toLowerCase() === String(s.name).toLowerCase())) {
            out.push({
              name: s.name,
              required: true,
              multi: !!s.multi,
              selectionOnly: !!s.selectionOnly,
              options: s.options || [],
              value: s.multi ? [] : '',
            });
          }
        }

        return out;
      }

      parsedAnalysis.item_specifics = sanitizeAndConstrain(
        grounded?.item_specifics || [],
        aspectSchema,
        parsedAnalysis.detected || {}
      );

      // Add a few safe, derived fields when schema exists (still respecting options)
      const dept = inferDepartmentFromPath(parsedAnalysis.category?.path || '');
      const sizeType = inferSizeType({
        size: parsedAnalysis.detected?.size,
        title: parsedAnalysis.title,
        categoryPath: parsedAnalysis.category?.path,
      });

      // If Department / Size Type appear in schema and empty, gently set them (only if option exists)
      const ensureIfInSchema = (name: string, proposed: string) => {
        if (!proposed) return;
        const s = aspectSchema.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!s) return;
        const has = (parsedAnalysis.item_specifics || []).find(
          (x: any) => String(x.name).toLowerCase() === name.toLowerCase()
        );
        if (has && (has.value && (Array.isArray(has.value) ? has.value.length : String(has.value).trim()))) return;
        if (s.selectionOnly && !s.options.includes(proposed)) return;
        parsedAnalysis.item_specifics.push({
          name: s.name,
          required: !!s.required,
          multi: !!s.multi,
          selectionOnly: !!s.selectionOnly,
          options: s.options || [],
          value: proposed,
        });
      };

      ensureIfInSchema('Department', dept);
      ensureIfInSchema('Size Type', sizeType);
    } catch (err) {
      // Hard failover if taxonomy or schema fails
      parsedAnalysis.ebay_category_id = parsedAnalysis.ebay_category_id || '11450';
      parsedAnalysis.ebay_category_name = parsedAnalysis.ebay_category_name || 'Clothing, Shoes & Accessories';
      parsedAnalysis.ebay_category_path =
        parsedAnalysis.ebay_category_path || 'Clothing, Shoes & Accessories';
      parsedAnalysis.category = parsedAnalysis.category || {
        id: '11450',
        name: 'Clothing, Shoes & Accessories',
        path: 'Clothing, Shoes & Accessories',
      };
      parsedAnalysis.category_specifics_schema = parsedAnalysis.category_specifics_schema || [];
      // leave item_specifics as-is (may be empty)
    }

    // 6) Optional: forward to Make.com
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
