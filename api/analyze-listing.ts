// api/analyze-listing.ts
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
  try { return JSON.parse(txt) as T; } catch { return fallback; }
}

function includesAny(hay: string, needles: string[]) {
  const h = norm(hay);
  return needles.some((n) => h.includes(norm(n)));
}

// lenient option snapper for selectionOnly aspects
function pickBestOption(target: string, options: string[] = []) {
  if (!target) return '';
  if (!options?.length) return target;

  const t = norm(target);

  // 1) exact
  const exact = options.find((o) => norm(o) === t);
  if (exact) return exact;

  // 2) starts-with / contains (both directions)
  const soft = options.find(
    (o) => norm(o).startsWith(t) || t.startsWith(norm(o)) || norm(o).includes(t) || t.includes(norm(o))
  );
  if (soft) return soft;

  // 3) token overlap
  const tTokens = tokens(t);
  let best = '';
  let bestScore = -1;
  for (const opt of options) {
    const score = tTokens.filter((x) => tokens(opt).includes(x)).length;
    if (score > bestScore) { bestScore = score; best = opt; }
  }
  return best || options[0] || '';
}

// infer dept quickly from breadcrumb
function inferDepartmentFromPath(path: string) {
  const p = norm(path);
  if (p.includes("women")) return "Women";
  if (p.includes("men")) return "Men";
  if (p.includes("girls")) return "Girls";
  if (p.includes("boys")) return "Boys";
  if (p.includes("unisex")) return "Unisex Adult";
  return "";
}

function inferSizeType({ size, title, categoryPath }: { size?: string; title?: string; categoryPath?: string; }) {
  const hay = [size, title, categoryPath].filter(Boolean).join(" ").toLowerCase();
  if (includesAny(hay, ["petite"])) return "Petite";
  if (includesAny(hay, ["tall", "long"])) return "Tall";
  if (includesAny(hay, ["plus", "extended", "big & tall", "big tall"])) return "Plus";
  return "Regular";
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
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            "You are an expert eBay lister. Read ALL photos together. Extract concrete facts (brand, size, color, materials, construction, features, closures, themes, patterns, lengths, fits, etc.). Return structured JSON only.",
        },
        {
          role: 'user',
          content: [
            ...base64Images.map((img) => ({ type: 'image_url' as const, image_url: { url: img, detail: 'low' as const } })),
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
    "materials": ["Polyester", "Cotton", "Down", ...],
    "outerShellMaterial": "...",
    "liningMaterial": "...",
    "insulationMaterial": "...",
    "style": "...",
    "type": "...",
    "lengthHint": "short|knee length|midi|maxi|long|cropped|hip|thigh|knee|mid-calf|ankle",
    "closure": "Zip|Buttons|Buckle|Pullover|Hook & Eye|... (or null)",
    "features": ["Hood", "Pockets", "Water Resistant", "Stretch", ...],
    "pattern": "Solid|Floral|Plaid|Striped|Animal Print|Logo|Graphic|Quilted|... (best guess)",
    "theme": ["Outdoor","Sports","Y2K","80s","90s","Animals","Floral", ...],
    "countryOfOrigin": "... if visible",
    "model": "... if visible",
    "sleeveLength": "Short|3/4|Long|Sleeveless|... if visible",
    "fit": "Regular|Slim|Relaxed|Classic|... if visible",
    "sizeTypeHint": "Regular|Plus|Petite|Tall|Big & Tall if visible"
  },
  "keywords": ["..."]
}`,
            },
          ],
        },
      ],
    });

    const visionJSON = safeJSON(vision.choices?.[0]?.message?.content || "{}", {});
    const detected = visionJSON.detected || {};
    const title = visionJSON.title || '';
    const description = visionJSON.description || '';

    // coarse, model-independent inferences
    const categoryGuessingText = `${title}\n${description}`;
    const department =
      detected.department || inferDepartmentFromPath(categoryGuessingText);
    const sizeType = detected.sizeTypeHint || inferSizeType({
      size: detected.size, title, categoryPath: categoryGuessingText,
    });

    /* ----------------------------------------
       eBay: category suggestion + aspects
    -----------------------------------------*/
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const ebayApiUrl = `${origin}/api/ebay-categories`;

    // Suggest category
    let category = { id: '11450', name: 'Clothing, Shoes & Accessories', path: 'Clothing, Shoes & Accessories' };
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
          id: s.id, name: s.name, path: s.path || s.name,
        }));
      }
    } catch {
      // keep defaults
    }

    // Pull aspects for the chosen category
    let aspects: any[] = [];
    try {
      const sp = await fetch(ebayApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCategorySpecifics', categoryId: category.id }),
      });
      if (sp.ok) {
        const data = await sp.json();
        aspects = data?.aspects ?? [];
      }
    } catch {
      aspects = [];
    }

    /* ----------------------------------------
       Stage B: Reconcile to eBay aspects
       (model picks legal options; we fall back if needed)
    -----------------------------------------*/
    // Prepare a compact aspects payload for the model
    const aspectsForModel = aspects.map(a => ({
      name: a.name,
      required: !!a.required,
      selectionOnly: a.type === 'SelectionOnly',
      multi: !!a.multi,
      freeTextAllowed: a.type !== 'SelectionOnly',
      options: Array.isArray(a.values) ? a.values.slice(0, 150) : [], // cap for token sanity
    }));

    const reconcile = await callOpenAIChat({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            "You are mapping product facts to eBay item specifics. For each aspect, choose *valid* option(s) from the given options when selectionOnly=true. If freeText is allowed and no option fits, return clear text. Use domain reasoning, e.g.: maxi ⇒ Long length; puffer ⇒ Down insulation; 65% polyester ⇒ Polyester (fabric); 60/40 cotton/poly ⇒ Cotton Blend + Polyester Blend; animal print ⇒ Theme: Animals; floral ⇒ Theme: Floral. Prefer common neutral choices when multiple are correct (e.g., Pattern: Solid when clearly solid). Return JSON only.",
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
`eBay Category: ${category.path}
Product title: ${title}
Description: ${description}

Facts detected from photos (free-text):
${JSON.stringify(detected, null, 2)}

Aspects to fill (choose options when provided):
${JSON.stringify(aspectsForModel, null, 2)}

Return:
{
  "final_specifics": [
    {"name": "...", "value": "string OR string[]"}
  ],
  "notes": "short note about any assumptions"
}
`
            }
          ]
        }
      ]
    });

    const recJSON = safeJSON(reconcile.choices?.[0]?.message?.content || "{}", {});
    let finalSpecifics: Array<{name: string; value: any}> = Array.isArray(recJSON.final_specifics) ? recJSON.final_specifics : [];

    // Hard fallback: if model returned nothing, do heuristic snapping instead of empty UI
    if (!finalSpecifics.length) {
      finalSpecifics = aspects.map((a) => {
        const n = norm(a.name);
        const options: string[] = a.values ?? [];
        const selOnly = a.type === 'SelectionOnly';
        let guess = '';

        // pull from detected
        if (n.includes('brand')) guess = detected.brand || '';
        else if (n === 'department') guess = department;
        else if (n.includes('size type')) guess = sizeType;
        else if (n === 'size' || n.includes('waist') || n.includes('inseam')) guess = detected.size || '';
        else if (n.includes('color') || n.includes('colour')) guess = (Array.isArray(detected.colors) ? detected.colors[0] : detected.colors) || '';
        else if (n.includes('outer') && n.includes('material')) guess = detected.outerShellMaterial || (detected.materials?.[0] || '');
        else if (n.includes('lining') && n.includes('material')) guess = detected.liningMaterial || '';
        else if (n.includes('insulation') && n.includes('material')) guess = detected.insulationMaterial || (includesAny(title+description, ['puffer','down']) ? 'Down' : '');
        else if (n === 'style') guess = detected.style || '';
        else if (n === 'type') guess = detected.type || '';
        else if (n.includes('pattern')) guess = detected.pattern || '';
        else if (n.includes('length')) {
          const h = norm(detected.lengthHint || '');
          if (h.includes('maxi') || h.includes('long') || h.includes('ankle')) guess = 'Long';
          else if (h.includes('midi') || h.includes('mid')) guess = 'Midi';
          else if (h.includes('knee')) guess = 'Knee Length';
          else if (h.includes('short') || h.includes('hip') || h.includes('cropped')) guess = 'Short';
        }
        else if (n.includes('closure')) guess = detected.closure || (includesAny(title+description, ['zip','zipper']) ? 'Zip' : '');
        else if (n.includes('theme')) guess = Array.isArray(detected.theme) ? detected.theme : detected.theme ? [detected.theme] : [];
        else if (n.includes('features')) guess = Array.isArray(detected.features) ? detected.features : (detected.features ? [detected.features] : []);
        else if (n.includes('country') && n.includes('origin')) guess = detected.countryOfOrigin || '';
        else if (n.includes('model')) guess = detected.model || '';
        else if (n.includes('sleeve') && n.includes('length')) guess = detected.sleeveLength || '';
        else if (n === 'fit') guess = detected.fit || '';

        // normalize through options if necessary
        if (Array.isArray(guess)) {
          const snapped = guess
            .map((g) => selOnly ? pickBestOption(String(g), options) : String(g))
            .filter(Boolean);
          return { name: a.name, value: snapped };
        } else {
          const snapped = selOnly ? pickBestOption(guess, options) : guess;
          return { name: a.name, value: snapped };
        }
      });
    }

    // Ensure every aspect is present (even if empty) so UI can render all rows
    const finalSpecificsMap = new Map(finalSpecifics.map(s => [norm(s.name), s]));
    for (const a of aspects) {
      if (!finalSpecificsMap.has(norm(a.name))) {
        finalSpecifics.push({ name: a.name, value: '' });
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
      // For UI: include full schema so you can show options in the dropdowns
      category_specifics_schema: aspects.map(a => ({
        name: a.name,
        required: !!a.required,
        type: a.type,
        multi: !!a.multi,
        selectionOnly: a.type === 'SelectionOnly',
        freeTextAllowed: a.type !== 'SelectionOnly',
        values: a.values ?? [],
      })),
      // What the UI should render as initial values:
      item_specifics: finalSpecifics.map(s => ({
        name: s.name,
        value: s.value,
        options: (aspects.find(a => norm(a.name) === norm(s.name))?.values) ?? [],
        required: !!(aspects.find(a => norm(a.name) === norm(s.name))?.required),
        multi: !!(aspects.find(a => norm(a.name) === norm(s.name))?.multi),
        selectionOnly: (aspects.find(a => norm(a.name) === norm(s.name))?.type) === 'SelectionOnly',
        freeTextAllowed: (aspects.find(a => norm(a.name) === norm(s.name))?.type) !== 'SelectionOnly',
      })),
      keywords: visionJSON.keywords || [],
      confidence_score: visionJSON.confidence_score ?? undefined,
      reconcile_notes: recJSON.notes ?? undefined,
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
      } catch { /* ignore */ }
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
