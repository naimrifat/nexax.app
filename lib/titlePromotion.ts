export type TitleParts = {
  brand?: string | null;
  productName: string;
  identifiers?: string[];
  meaningTokens?: string[];
  intentTokens?: string[];
  attributeTokens?: string[];
  colors?: string[];
  sizeToken?: string | null;
  condition?: string | null;
  attributes?: string[];
};

const normalizeToken = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();

function normalizeTitleSizeToken(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';

  // Normalize common bilingual/alias size formats for titles.
  // Examples:
  // - "3XL (3XG/3TG)" -> "3XL"
  // - "XL (TG)" -> "XL"
  // - "L/G" -> "L"
  // Keep conversions like "(EU 44)" by only removing specific alias codes.

  // Drop a trailing parenthetical if it looks like a size alias code block.
  s = s.replace(/\s*\(([^)]+)\)\s*$/g, (_m, inner) => {
    const v = String(inner || '').trim();
    if (!v) return '';
    if (/\b(?:EU|UK|US|CM|MM|IN|INCH|INCHES)\b/i.test(v)) return ` (${v})`;

    const alias = v.replace(/\s+/g, '').toUpperCase();
    // French/CA apparel size aliases commonly seen on tags.
    // TP/P/M/G/TG/TTG and variants like 3TG, 2TG, 3XG, etc.
    const looksLikeAliasOnly = /^[0-9]*?(?:XG|TG|TTG|TP|P|M|G)(?:\/[0-9]*?(?:XG|TG|TTG|TP|P|M|G))*$/.test(alias);
    if (looksLikeAliasOnly) return '';
    return ` (${v})`;
  });

  // Drop a trailing "/ALIAS" pattern when it is clearly redundant (e.g. "XL/TG", "L/G").
  s = s.replace(/\s*\/?\s*(?:TP|TTG|TG|XG|G)\s*$/i, (m) => {
    // Only remove if the string still contains a usable size before the alias.
    const before = s.slice(0, Math.max(0, s.length - m.length)).trim();
    return before ? '' : m;
  });

  return s.trim();
}

const addToken = (parts: string[], token: string, maxLen: number): void => {
  const clean = normalizeToken(token);
  if (!clean) return;
  const current = parts.join(' ');
  const currentLower = current.toLowerCase();
  if (currentLower.includes(clean.toLowerCase())) return;
  const next = current ? `${current} ${clean}` : clean;
  if (next.length > maxLen) return;
  parts.push(clean);
};

const pickBestColor = (colors: string[]): string | null => {
  const list = colors.filter(Boolean).map((c) => String(c).trim()).filter(Boolean);
  if (!list.length) return null;
  const multi = list.find((c) => c.toLowerCase() === 'multicolor');
  return multi || list[0];
};

export function buildPromotedTitle(parts: TitleParts): string {
  const maxLen = 80;
  const tokens: string[] = [];

  addToken(tokens, parts.brand || '', maxLen);
  addToken(tokens, parts.productName || '', maxLen);

  const meaning = Array.isArray(parts.meaningTokens) ? parts.meaningTokens : [];
  if (meaning.length) {
    addToken(tokens, meaning[0], maxLen);
    if (meaning[1] && normalizeToken(meaning[1]).length <= 20) {
      addToken(tokens, meaning[1], maxLen);
    }
  }

  const identifiers = Array.isArray(parts.identifiers) ? parts.identifiers : [];
  for (const id of identifiers) {
    addToken(tokens, id, maxLen);
    break;
  }

  const intents = Array.isArray(parts.intentTokens) ? parts.intentTokens : [];
  let intentCount = 0;
  for (const t of intents) {
    if (intentCount >= 3) break;
    const beforeLen = tokens.join(' ').length;
    addToken(tokens, t, maxLen);
    const afterLen = tokens.join(' ').length;
    if (afterLen !== beforeLen) intentCount += 1;
  }

  const attributeTokens = Array.isArray(parts.attributeTokens) ? parts.attributeTokens : [];
  let attributeCount = 0;
  for (const t of attributeTokens) {
    if (attributeCount >= 2) break;
    const beforeLen = tokens.join(' ').length;
    addToken(tokens, t, maxLen);
    const afterLen = tokens.join(' ').length;
    if (afterLen !== beforeLen) attributeCount += 1;
  }

  const color = pickBestColor(Array.isArray(parts.colors) ? parts.colors : []);
  if (color) addToken(tokens, color, maxLen);

  if (parts.sizeToken) {
    const normalizedSize = normalizeTitleSizeToken(parts.sizeToken);
    if (normalizedSize) addToken(tokens, normalizedSize, maxLen);
  }

  const attributes = Array.isArray(parts.attributes) ? parts.attributes : [];
  const stretch = attributes.find((a) => normalizeToken(a).toLowerCase() === 'stretch') || '';
  if (stretch) addToken(tokens, stretch, maxLen);

  if (parts.condition) addToken(tokens, parts.condition, maxLen);

  // Example:
  // buildPromotedTitle({ brand: 'Nike', productName: 'Air Max', meaningTokens: ['Friends'], intentTokens: ['Bohemian','Floral'], colors: ['Black', 'Red'] })
  // => "Nike Air Max Friends Bohemian Floral Black"

  return tokens.join(' ').trim();
}
