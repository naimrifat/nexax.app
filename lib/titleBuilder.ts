type TitleFacts = {
  brand?: string | null;
  product_name: string;
  identifiers?: string[];
  attributes?: string[];
  condition?: string | null;
};

const normalizeToken = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();

const addIfFits = (parts: string[], token: string, maxLen: number): void => {
  const clean = normalizeToken(token);
  if (!clean) return;
  const current = parts.join(' ');
  const currentLower = current.toLowerCase();
  if (currentLower.includes(clean.toLowerCase())) return;
  const next = current ? `${current} ${clean}` : clean;
  if (next.length > maxLen) return;
  parts.push(clean);
};

export function buildFallbackTitle(facts: TitleFacts): string {
  const maxLen = 80;
  const parts: string[] = [];

  addIfFits(parts, facts.brand || '', maxLen);
  addIfFits(parts, facts.product_name || '', maxLen);

  const identifiers = Array.isArray(facts.identifiers) ? facts.identifiers : [];
  for (const id of identifiers) {
    addIfFits(parts, id, maxLen);
  }

  const attributes = Array.isArray(facts.attributes) ? facts.attributes : [];
  for (const attr of attributes) {
    addIfFits(parts, attr, maxLen);
  }

  addIfFits(parts, facts.condition || '', maxLen);

  // Example:
  // buildFallbackTitle({ brand: 'Sony', product_name: 'Discman', identifiers: ['D-141'], attributes: ['Black'], condition: 'Used' })
  // => "Sony Discman D-141 Black Used"

  return parts.join(' ').trim();
}
