// api/analyze-listing.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
  maxDuration: 60,
};

/* =========================
   Small utilities
   ========================= */
const norm = (s: string) => (s || '').toLowerCase().trim();
const toks = (s: string) => norm(s).split(/[\s\/,&\-]+/).filter(Boolean);
const includesAny = (hay: string, needles: string[]) => {
  const h = norm(hay);
  return needles.some((n) => h.includes(norm(n)));
};

/** token overlap score (0..n) */
function overlapScore(a: string, b: string) {
  const ta = new Set(toks(a));
  const tb = new Set(toks(b));
  let score = 0;
  for (const t of ta) if (tb.has(t)) score++;
  return score;
}

/** Confidence-scored snap to one option (0..1) */
function snapToOption(target: string, options: string[], aliases?: Record<string, string[]>) {
  if (!target || !options?.length) return { value: '', score: 0 };
  const t = norm(target);

  // 1) exact (case insensitive)
  for (const opt of options) if (norm(opt) === t) return { value: opt, score: 1 };

  // 2) aliases (category-specific vocab)
  if (aliases) {
    for (const [canon, alts] of Object.entries(aliases)) {
      if (alts.some((a) => norm(a) === t)) {
        const hit = options.find((o) => norm(o) === norm(canon)) || options.find((o) => norm(o).includes(norm(canon)));
        if (hit) return { value: hit, score: 0.95 };
      }
    }
  }

  // 3) symmetric contains/starts with
  for (const opt of options) {
    const o = norm(opt);
    if (o.startsWith(t) || t.startsWith(o) || o.includes(t) || t.includes(o)) {
      return { value: opt, score: 0.85 };
    }
  }

  // 4) token overlap
  let best = '';
  let bestScore = 0;
  for (const opt of options) {
    const s = overlapScore(opt, target);
    if (s > bestScore) {
      bestScore = s;
      best = opt;
    }
  }
  if (best) return { value: best, score: Math.min(0.75, bestScore / Math.max(1, toks(target).length)) };

  return { value: '', score: 0 };
}

/** Multi snap (returns array of allowed options) */
function snapMany(targets: string[] | string, options: string[], aliases?: Record<string, string[]>) {
  const arr = Array.isArray(targets) ? targets : (targets ? [targets] : []);
  const picked: string[] = [];
  for (const t of arr) {
    const { value, score } = snapToOption(t, options, aliases);
    if (value && score >= 0.6 && !picked.includes(value)) picked.push(value);
  }
  return picked;
}

/* =========================
   Light inference helpers
   ========================= */
function inferDepartment(path: string, title: string) {
  const hay = `${path} ${title}`.toLowerCase();
  if (hay.includes("women")) return "Women";
  if (hay.includes("men")) return "Men";
  if (hay.includes("girls")) return "Girls";
  if (hay.includes("boys")) return "Boys";
  if (hay.includes("unisex")) return "Unisex Adult";
  return "";
}

function inferSizeType({ size, title, categoryPath }: { size?: string; title?: string; categoryPath?: string }) {
  const hay = [size, title, categoryPath].filter(Boolean).join(" ").toLowerCase();
  if (includesAny(hay, ["maternity"])) return "Maternity";
  if (includesAny(hay, ["petite"])) return "Petite";
  if (includesAny(hay, ["tall", "long"])) return "Tall";
  if (includesAny(hay, ["plus", "extended"])) return "Plus";
  if (includesAny(hay, ["juniors"])) return "Juniors";
  if (includesAny(hay, ["misses"])) return "Misses";
  if (includesAny(hay, ["big & tall", "big and tall"])) return "Big & Tall";
  return "Regular";
}

/** category-aware alias vocab for Size Type */
function sizeTypeAliasesForOptions(opts: string[]) {
  // Build aliases only for values present in this category’s options.
  const has = (name: string) => opts.some((o) => norm(o) === norm(name));
  const map: Record<string, string[]> = {};
  if (has("Regular")) map["Regular"] = ["regular", "standard", "classic"];
  if (has("Misses")) map["Misses"] = ["misses", "regular women", "womens regular"];
  if (has("Juniors")) map["Juniors"] = ["juniors", "jr", "teen"];
  if (has("Petite")) map["Petite"] = ["petite"];
  if (has("Tall")) map["Tall"] = ["tall", "long"];
  if (has("Plus")) map["Plus"] = ["plus", "extended"];
  if (has("Big & Tall")) map["Big & Tall"] = ["big & tall", "big and tall"];
  if (has("Maternity")) map["Maternity"] = ["maternity"];
  if (has("Infant & Toddler")) map["Infant & Toddler"] = ["infant", "toddler", "baby"];
  if (has("Boys")) map["Boys"] = ["boys", "boy's"];
  if (has("Girls")) map["Girls"] = ["girls", "girl's"];
  return map;
}

/* =========================
   CORS + handler shell
   ========================= */
export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    // ---- 1) Download + base64 (cap 12)
    const base64Images = await Promise.all(
      images.slice(0, 12).map(async (url: string) => {
        const optimized = url.includes('cloudinary.com')
          ? url.replace('/upload/', '/upload/w_1024,h_1024,c_limit,q_auto,f_jpg/')
          : url;
        const r = await fetch(optimized);
        if (!r.ok) throw new Error(`Failed to download image: ${r.status}`);
        const buf = await r.arrayBuffer();
        const mime = r.headers.get('content-type') || 'image/jpeg';
        return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
      })
    );

    // ---- 2) OpenAI Vision (ask for richer "detected")
    const oa = await fetch('https://api.openai.com/v1/chat/completions', {
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
              "You are an expert eBay product lister. Analyze ALL photos together. Return ONLY valid JSON (no markdown). Be conservative—do not invent facts. If unsure, leave empty.",
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
                text: `Return JSON with:
{
  "title": "...(<=80 chars)",
  "description": "...",
  "category": "Most specific path (e.g., Clothing, Shoes & Accessories > Men > Shirts > Dress Shirts)",
  "item_specifics": [],
  "detected": {
    "brand": "...", "size": "...", "colors": ["..."],
    "materials": ["..."],
    "style": "...", "type": "...", "productLine": "...",
    "features": ["..."],

    /* additional neutral hints to maximize fill */
    "pattern": "...",
    "sleeve_length": "...",
    "dress_length": "...",
    "jacket_length": "...",
    "collar_style": "...",
    "neckline": "...",
    "closure": "...",
    "garment_care": "...",
    "model": "...",
    "season": "...",
    "country_of_origin": "..."
  },
  "keywords": ["..."], "suggested_price": "29.99", "confidence_score": 0.95
}`,
              },
            ],
          },
        ],
      }),
    });
    if (!oa.ok) throw new Error(`OpenAI error: ${oa.status} ${await oa.text()}`);
    const oaJson = await oa.json();
    const content = oaJson.choices?.[0]?.message?.content ?? '{}';
    const parsedAnalysis = JSON.parse(content || '{}');

    // ---- 3) eBay category + aspects
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const ebayUrl = `${origin}/api/ebay-categories`;

    const sugg = await fetch(ebayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'getSuggestedCategories',
        title: parsedAnalysis.title,
        keywords: parsedAnalysis.keywords || [],
      }),
    });

    if (!sugg.ok) throw new Error(`Taxonomy suggestion failed: ${sugg.status}`);
    const suggData = await sugg.json();

    parsedAnalysis.ebay_category_id = suggData.categoryId;
    parsedAnalysis.ebay_category_name = suggData.categoryName;
    parsedAnalysis.ebay_category_path = suggData.categoryPath || suggData.categoryName;
    parsedAnalysis.category = {
      id: suggData.categoryId,
      name: suggData.categoryName,
      path: suggData.categoryPath || suggData.categoryName,
    };
    parsedAnalysis.category_suggestions = (suggData.suggestions || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      path: s.path || s.name,
    }));

    const aspectsResp = await fetch(ebayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getCategorySpecifics', categoryId: suggData.categoryId }),
    });
    if (!aspectsResp.ok) throw new Error(`Aspects fetch failed: ${aspectsResp.status}`);
    const aspectsData = await aspectsResp.json();
    const ebayAspects: any[] = aspectsData.aspects || [];

    // ---- 4) map (two-pass w/ dependencies)
    const mapped = mapWithDependencies(
      parsedAnalysis.detected || {},
      ebayAspects,
      parsedAnalysis.category?.path || '',
      parsedAnalysis.title || ''
    );

    parsedAnalysis.category_specifics_schema = ebayAspects;
    parsedAnalysis.item_specifics = mapped;

    // ---- 5) Optional Make webhook
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
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
    });
  }
}

/* =========================================================
   Dependency-aware mapper
   ========================================================= */
function mapWithDependencies(
  detected: any,
  ebayAspects: any[],
  categoryPath: string,
  title: string
) {
  const dep = inferDepartment(categoryPath, title);
  const sizeTypeGuess = inferSizeType({ size: detected?.size, title, categoryPath });

  // Build aliases where helpful (especially for Size Type)
  const sizeTypeOpts = getOptionsFor(ebayAspects, 'size type');
  const sizeTypeAlias = sizeTypeAliasesForOptions(sizeTypeOpts);

  // PASS 1: map everything conservatively (no dependency enforcement yet)
  const pass1 = mapLoose(detected, ebayAspects, {
    department: dep,
    sizeTypeGuess,
    sizeTypeAlias,
    title,
    categoryPath,
  });

  // PASS 2: enforce dependencies & re-snap where needed
  enforceDependencies(pass1, ebayAspects, {
    department: dep,
    sizeTypeGuess,
    sizeTypeAlias,
    detected,
    title,
    categoryPath,
  });

  return pass1;
}

function getAspect(ary: any[], nameSubstr: string) {
  const n = norm(nameSubstr);
  return ary.find((a) => norm(a?.name || '').includes(n));
}
function getOptionsFor(ary: any[], nameSubstr: string) {
  const a = getAspect(ary, nameSubstr);
  return (a?.values || []) as string[];
}

/** pass 1: independent, conservative mapping */
function mapLoose(
  det: any,
  ebayAspects: any[],
  ctx: {
    department: string;
    sizeTypeGuess: string;
    sizeTypeAlias: Record<string, string[]>;
    title: string;
    categoryPath: string;
  }
) {
  const {
    department, sizeTypeGuess, sizeTypeAlias,
  } = ctx;

  const color = Array.isArray(det?.colors) ? det.colors[0] : det?.colors || '';
  const featuresArr: string[] = det?.features || [];
  const material = Array.isArray(det?.materials) ? det.materials[0] : det?.materials || '';

  const mapped: any[] = [];

  for (const a of ebayAspects) {
    const name = a?.name || '';
    const n = norm(name);
    const opts: string[] = a?.values || [];
    const selectionOnly = !!a?.selectionOnly;
    const multi = !!a?.multi;

    let value = '';
    let useAliases: Record<string, string[]> | undefined;

    if (n === 'department') {
      const { value: v, score } = snapToOption(department, opts);
      value = score >= 0.6 ? v : '';
    } else if (n.includes('size type')) {
      useAliases = sizeTypeAlias;
      const { value: v, score } = snapToOption(sizeTypeGuess, opts, useAliases);
      value = score >= 0.6 ? v : '';
    } else if (n === 'size' || n.includes('waist size') || n.includes('inseam') || n.includes('neck size') || n.includes('chest size')) {
      const { value: v, score } = snapToOption(det?.size || '', opts);
      value = selectionOnly ? (score >= 0.6 ? v : '') : (det?.size || '');
    } else if (n.includes('color') || n.includes('colour')) {
      const { value: v, score } = snapToOption(color, opts);
      value = selectionOnly ? (score >= 0.6 ? v : '') : color;
    } else if (n.includes('material') || n.includes('fabric')) {
      const { value: v, score } = snapToOption(material, opts);
      value = selectionOnly ? (score >= 0.6 ? v : '') : material;
    } else if (n.includes('features')) {
      const picked = snapMany(featuresArr, opts);
      value = multi ? picked.join(', ') : (picked[0] || '');
    } else {
      // generic: try to use detected[name-like] if present
      const guess =
        det?.[camelLike(n)] ||
        det?.[n.replace(/\s+/g, '_')] ||
        '';

      if (multi) {
        const chosen = snapMany(Array.isArray(guess) ? guess : [guess], opts);
        value = chosen.join(', ');
      } else {
        const { value: v, score } = snapToOption(String(guess || ''), opts);
        value = selectionOnly ? (score >= 0.6 ? v : '') : (guess || (score >= 0.7 ? v : ''));
      }
    }

    mapped.push({
      name,
      value,
      required: !!a?.required,
      type: a?.type,
      options: opts,
      selectionOnly,
      multi,
      freeTextAllowed: !!a?.freeTextAllowed,
    });
  }

  return mapped;
}

/** pass 2: enforce dependencies (Size Type ➜ Size) and re-snap */
function enforceDependencies(
  specs: any[],
  ebayAspects: any[],
  ctx: {
    department: string;
    sizeTypeGuess: string;
    sizeTypeAlias: Record<string, string[]>;
    detected: any;
    title: string;
    categoryPath: string;
  }
) {
  // ——— Size Type ➜ Size ———
  const sizeTypeIdx = specs.findIndex((s) => norm(s.name).includes('size type'));
  const sizeIdx = specs.findIndex((s) => {
    const n = norm(s.name);
    return n === 'size' || n.includes('waist size') || n.includes('inseam') || n.includes('neck size') || n.includes('chest size');
  });

  if (sizeTypeIdx !== -1) {
    const st = specs[sizeTypeIdx];
    // If Size Type is empty but options exist, choose a conservative default using guess + aliases
    if (!st.value && st.options?.length) {
      const { value: v, score } = snapToOption(ctx.sizeTypeGuess, st.options, ctx.sizeTypeAlias);
      if (score >= 0.6) st.value = v;
      else {
        // fallback: pick a neutral standard if present to keep form valid
        const defaults = ['Regular', 'Misses', 'Men', 'Women'];
        const pick = st.options.find((o: string) => defaults.includes(o));
        if (pick) st.value = pick;
      }
    }

    // If size exists but selectionOnly and we didn't confidently snap it, re-snap now with Size Type fixed
    if (sizeIdx !== -1) {
      const size = specs[sizeIdx];
      if (size.selectionOnly && size.options?.length) {
        const { value: v, score } = snapToOption(size.value || ctx.detected?.size || '', size.options);
        size.value = score >= 0.6 ? v : ''; // avoid invalid combos
      }
    }
  }
}

/* =========================
   helpers
   ========================= */
function camelLike(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+([a-z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/[^a-z0-9]/g, '');
}
