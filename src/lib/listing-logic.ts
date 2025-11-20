// Helper regexes for size detection
const isTall = (v: string) => /(tall|long|\bLT\b|\bXLT\b|\b2XLT\b)/i.test(v);
const isPetite = (v: string) => /(petite|\bP\b|\bPS\b|\bPM\b)/i.test(v);
const isJunior = (v: string) => /(junior|jr\b|juniors)/i.test(v);
const isMaternity = (v: string) => /maternity/i.test(v);
const isPlus = (v: string) => /\b[1-6]X(L|LT)?\b/i.test(v) || /(big|plus)/i.test(v);

const isRegular = (v: string) => 
  !isTall(v) && !isPetite(v) && !isJunior(v) && !isMaternity(v);

// 1. Export for filtering options
export function filterSizeOptionsBySizeType(
  sizeType: string,
  allOptions: string[] = []
): string[] {
  const st = (sizeType || '').toLowerCase();
  if (!st) return allOptions;

  if (st.includes('big') || st.includes('tall')) return allOptions.filter(v => isTall(v) || isPlus(v));
  if (st.includes('petite')) return allOptions.filter(isPetite);
  if (st.includes('junior')) return allOptions.filter(isJunior);
  if (st.includes('maternity')) return allOptions; 
  if (st.includes('plus')) return allOptions.filter(v => isPlus(v));
  
  return allOptions.filter(isRegular);
}

// 2. Export for detecting if a field is a "Size" field
export function isSizeAspectName(name: string): boolean {
  return /^(size|waist size|neck size|chest size|inseam)$/i.test(name || '');
}

// 3. Export for finding the current "Size Type" value
export function getSizeTypeValue(specs: any[]): string {
  const st = specs?.find((s: any) => /size type/i.test(s?.name || ''));
  return Array.isArray(st?.value) ? st?.value[0] : st?.value || '';
}
