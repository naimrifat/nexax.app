type Detected = {
  brand?: string;
  size?: string;
  department?: string;
  colors?: string[] | string;
  materials?: string[] | string;
  outerShellMaterial?: string;
  liningMaterial?: string;
  insulationMaterial?: string;
  style?: string;
  type?: string;
  lengthHint?: string;
  closure?: string;
  features?: string[] | string;
  pattern?: string;
  theme?: string[] | string;
  countryOfOrigin?: string;
  model?: string;
  sleeveLength?: string;
  fit?: string;
  sizeTypeHint?: string;
};

type OptimizeInput = {
  rawTitle?: string;
  categoryPath?: string;
  detected?: Detected | null;
};

type OptimizeOutput = {
  title: string;
  debug: {
    mode: 'fashion' | 'general';
    tokensUsed: string[];
    removedTokens: string[];
    length: number;
  };
};

const GENERIC_COLORS = new Set(['multi', 'multicolor', 'assorted', 'various', 'mixed']);
const PREMIUM_MATERIALS = ['cashmere', 'silk', 'linen', 'merino', 'mohair', 'angora', 'leather', 'suede', 'wool'];
const LENGTH_HINT_BLOCKLIST = new Set(['hip', 'regular', 'standard', 'waist']);
const DEPARTMENT_TOKENS = new Set([
  'unisex',
  'adult',
  'men',
  'mens',
  'women',
  'womens',
  'boys',
  'girls',
  'kids',
  'youth',
]);
const FASHION_KEYWORDS = [
  'clothing',
  'shoes',
  'shoe',
  'footwear',
  'handbag',
  'handbags',
  'bag',
  'bags',
  'accessories',
  'accessory',
  'jewelry',
  'jewellery',
  'watch',
  'watches',
];

const normalizeToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const cleanToken = (value: string) =>
  String(value || '')
    .replace(/[|]+/g, ' ')
    .replace(/[,_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const firstString = (value?: string | string[]) => {
  if (!value) return '';
  if (Array.isArray(value)) return value.find((v) => String(v || '').trim().length > 0) || '';
  return String(value || '').trim();
};

const pickColor = (value?: string | string[]) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  for (const c of list) {
    const cleaned = cleanToken(c);
    const key = normalizeToken(cleaned);
    if (!key) continue;
    if (GENERIC_COLORS.has(key)) continue;
    return cleaned;
  }
  return '';
};

const pickMaterial = (detected: Detected) => {
  const candidates: string[] = [];
  if (detected.outerShellMaterial) candidates.push(detected.outerShellMaterial);
  if (detected.insulationMaterial) candidates.push(detected.insulationMaterial);
  if (detected.liningMaterial) candidates.push(detected.liningMaterial);
  if (detected.materials) {
    const list = Array.isArray(detected.materials) ? detected.materials : [detected.materials];
    candidates.push(...list);
  }

  const cleaned = candidates
    .map((c) => cleanToken(c))
    .filter((c) => c.length > 0);

  if (!cleaned.length) return '';

  for (const premium of PREMIUM_MATERIALS) {
    const match = cleaned.find((c) => normalizeToken(c).includes(premium));
    if (match) return match;
  }

  return cleaned[0];
};

const pickFeature = (value?: string | string[]) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return cleanToken(list.find((v) => String(v || '').trim().length > 0) || '');
};

const isFashionCategory = (categoryPath: string) => {
  const text = String(categoryPath || '').toLowerCase();
  return FASHION_KEYWORDS.some((k) => text.includes(k));
};

const isFashionContext = (categoryPath: string, typeValue: string) => {
  const cat = String(categoryPath || '').toLowerCase();
  const type = normalizeToken(typeValue);
  const categoryMatch = [
    'clothing',
    'shoes',
    'footwear',
    'accessories',
    'bags',
    'handbags',
    'jewelry',
    'watches',
  ].some((k) => cat.includes(k.toLowerCase()));

  const typeMatch = [
    'shirt',
    't-shirt',
    'tee',
    'blouse',
    'sweater',
    'hoodie',
    'jacket',
    'coat',
    'dress',
    'skirt',
    'pants',
    'jeans',
    'shorts',
    'shoes',
    'boots',
    'sneakers',
    'sandals',
    'bag',
    'handbag',
    'purse',
    'wallet',
    'belt',
    'hat',
    'cap',
  ].some((k) => type.includes(normalizeToken(k)));

  if (categoryMatch || typeMatch) return true;
  return false;
};

const stripDepartmentTokens = (value: string) => {
  const tokens = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const filtered = tokens.filter((t) => {
    const key = normalizeToken(t);
    if (!key) return false;
    return !DEPARTMENT_TOKENS.has(key);
  });
  return filtered.join(' ').trim();
};

const dedupeTokens = (tokens: string[]) => {
  const seen = new Set<string>();
  const kept: string[] = [];
  const removed: string[] = [];

  for (const token of tokens) {
    const cleaned = cleanToken(token);
    const key = normalizeToken(cleaned);
    if (!cleaned || !key) continue;
    if (seen.has(key)) {
      removed.push(cleaned);
      continue;
    }
    seen.add(key);
    kept.push(cleaned);
  }

  return { kept, removed };
};

const buildTitleFromTokens = (tokens: string[], maxLen: number, removed: string[]) => {
  const copy = [...tokens];
  let title = copy.join(' ').replace(/\s+/g, ' ').trim();
  while (title.length > maxLen && copy.length > 0) {
    const removedToken = copy.pop();
    if (removedToken) removed.push(removedToken);
    title = copy.join(' ').replace(/\s+/g, ' ').trim();
  }
  return { title, tokens: copy };
};

const cleanRawTitle = (rawTitle: string, stripDepartments: boolean) => {
  const cleaned = cleanToken(rawTitle);
  if (!cleaned) return '';
  const tokens = cleaned.split(' ').filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of tokens) {
    const key = normalizeToken(t);
    if (LENGTH_HINT_BLOCKLIST.has(key)) continue;
    if (stripDepartments && DEPARTMENT_TOKENS.has(key)) continue;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }
  return deduped.join(' ').trim();
};

const allowedLengthHint = (typeValue: string, hintValue: string) => {
  const type = normalizeToken(typeValue);
  const hint = normalizeToken(hintValue);
  if (!type || !hint) return '';

  if (LENGTH_HINT_BLOCKLIST.has(hint)) return '';

  const isDressOrSkirt = type.includes('dress') || type.includes('skirt');
  if (isDressOrSkirt) {
    if (['mini', 'midi', 'maxi'].some((k) => hint.includes(k))) return hintValue;
    return '';
  }

  const isCoatOrJacket = type.includes('coat') || type.includes('jacket');
  if (isCoatOrJacket) {
    if (['long', 'knee', 'thigh'].some((k) => hint.includes(k))) return hintValue;
    return '';
  }

  const isPantsOrShorts = type.includes('pant') || type.includes('pants') || type.includes('short');
  if (isPantsOrShorts) {
    if (['cropped', 'ankle'].some((k) => hint.includes(k))) return hintValue;
    return '';
  }

  const isJumpsuit = type.includes('jumpsuit');
  const isRomper = type.includes('romper');
  if (isJumpsuit || isRomper) {
    return '';
  }

  const isTop =
    type.includes('t-shirt') ||
    type.includes('tee') ||
    type.includes('shirt') ||
    type.includes('blouse') ||
    type.includes('sweater') ||
    type.includes('hoodie') ||
    type.includes('sweatshirt') ||
    type.includes('top') ||
    type.includes('tank') ||
    type.includes('polo');

  if (isTop) return '';

  return '';
};

export function optimizeEbayTitle({ rawTitle = '', categoryPath = '', detected = {} }: OptimizeInput): OptimizeOutput {
  const mode: 'fashion' | 'general' = isFashionCategory(categoryPath) ? 'fashion' : 'general';
  const removedTokens: string[] = [];
  const tokens: string[] = [];

  const addToken = (value?: string) => {
    const cleaned = cleanToken(value || '');
    if (!cleaned) return;
    tokens.push(cleaned);
  };

  const brand = firstString(detected.brand);
  const department = firstString(detected.department);
  const type = firstString(detected.type);
  const lengthHint = firstString(detected.lengthHint);
  const sizeTypeHint = firstString(detected.sizeTypeHint);
  const size = firstString(detected.size);
  const color = pickColor(detected.colors);
  const material = pickMaterial(detected);
  const style = firstString(detected.style);
  const pattern = firstString(detected.pattern);
  const fit = firstString(detected.fit);
  const sleeveLength = firstString(detected.sleeveLength);
  const closure = firstString(detected.closure);
  const feature = pickFeature(detected.features);
  const model = firstString(detected.model);

  const includeDepartment = isFashionContext(categoryPath, type);

  if (mode === 'fashion') {
    addToken(brand);
    if (includeDepartment) addToken(department);
    addToken(type);
    addToken(allowedLengthHint(type, lengthHint));
    if (sizeTypeHint) addToken(sizeTypeHint);
    addToken(size);
    addToken(color);
    addToken(material);
    addToken(style || pattern);

    const extra = fit || sleeveLength || closure || feature;
    addToken(extra);
  } else {
    addToken(brand);
    addToken(model);
    addToken(type);
    addToken(color || material || feature);
  }

  const { kept, removed } = dedupeTokens(tokens);
  removedTokens.push(...removed);

  const { title: builtTitle, tokens: finalTokens } = buildTitleFromTokens(kept, 80, removedTokens);
  const cleanedRaw = cleanRawTitle(rawTitle, !includeDepartment);

  let finalTitle = builtTitle;
  if (finalTokens.length < 2 && cleanedRaw) {
    finalTitle = cleanedRaw.slice(0, 80).trim();
  } else if (finalTitle.length < 40 && cleanedRaw && cleanedRaw.length > finalTitle.length) {
    finalTitle = cleanedRaw.slice(0, 80).trim();
  }

  if (!includeDepartment && finalTitle) {
    finalTitle = stripDepartmentTokens(finalTitle);
  }

  return {
    title: finalTitle,
    debug: {
      mode,
      tokensUsed: finalTitle ? finalTitle.split(' ').filter(Boolean) : [],
      removedTokens,
      length: finalTitle.length,
    },
  };
}
