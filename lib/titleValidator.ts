type TitleFacts = {
  brand?: string | null;
  product_name: string;
};

const forbiddenRegex = /(🔥|✨|💯|free\s*shipping|authentic|rare)/i;

const normalize = (value: string): string => String(value || '').toLowerCase();

export function validateTitle(title: string, facts: TitleFacts): boolean {
  const t = String(title || '').trim();
  if (t.length < 45 || t.length > 80) return false;

  const productName = String(facts.product_name || '').trim();
  if (!productName) return false;
  if (!normalize(t).includes(normalize(productName))) return false;

  const brand = String(facts.brand || '').trim();
  if (brand && !normalize(t).includes(normalize(brand))) return false;

  if (forbiddenRegex.test(t)) return false;

  const words = t.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
  const seen = new Set<string>();
  for (const w of words) {
    if (seen.has(w)) return false;
    seen.add(w);
  }

  // Example:
  // validateTitle('Nike Air Max 90 Black Size 10', { brand: 'Nike', product_name: 'Air Max 90' }) => true

  return true;
}
