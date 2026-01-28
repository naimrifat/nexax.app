export type TitleParts = {
  brand?: string | null;
  productName: string;
  identifiers?: string[];
  meaningTokens?: string[];
  styleToken?: string | null;
  colors?: string[];
  sizeToken?: string | null;
  condition?: string | null;
  attributes?: string[];
};

const normalizeToken = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();

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

  if (parts.styleToken) {
    addToken(tokens, parts.styleToken, maxLen);
  }

  const color = pickBestColor(Array.isArray(parts.colors) ? parts.colors : []);
  if (color) addToken(tokens, color, maxLen);

  if (parts.sizeToken) addToken(tokens, parts.sizeToken, maxLen);

  const attributes = Array.isArray(parts.attributes) ? parts.attributes : [];
  const stretch = attributes.find((a) => normalizeToken(a).toLowerCase() === 'stretch') || '';
  if (stretch) addToken(tokens, stretch, maxLen);

  if (parts.condition) addToken(tokens, parts.condition, maxLen);

  // Example:
  // buildPromotedTitle({ brand: 'Nike', productName: 'Air Max', meaningTokens: ['Friends'], colors: ['Black', 'Red'] })
  // => "Nike Air Max Friends Black"

  return tokens.join(' ').trim();
}
