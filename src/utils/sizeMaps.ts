// utils/sizeMaps.ts

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
const norm = (s: string) => s.trim().toLowerCase();

function normalizeSizeTypeKey(label: string): string {
  const s = norm(label);
  if (!s) return '';

  if (s.includes('regular')) return 'Regular';
  if (s.includes('plus')) return 'Plus';
  if (s.includes('petite')) return 'Petites';
  if (s.includes('tall')) return 'Tall';
  if (s.includes('junior')) return 'Juniors';
  if (s.includes('maternity')) return 'Maternity';
  if (s.includes('big') && s.includes('tall')) return 'Big & Tall';
  if (s === 'husky') return 'Husky';
  if (s === 'slim') return 'Slim';

  return label;
}

// -------------------------------------------------------------
// Category → family detection
// -------------------------------------------------------------
type SizeFamily =
  | 'women_all'
  | 'men_top'
  | 'men_bottom'
  | 'boys_all'
  | 'girls_all'
  | 'toddler_all'
  | null;

function getSizeFamily(categoryPath: string): SizeFamily {
  const p = norm(categoryPath || '');

  // Toddler / baby first so they don't get caught by "boys/girls"
  if (p.includes('toddler') || p.includes('baby')) return 'toddler_all';

  const hasWomen = p.includes('women');
  const hasMen = p.includes('men');
  const hasBoys = p.includes('boys');
  const hasGirls = p.includes('girls');

  if (hasWomen) return 'women_all';

  if (hasMen) {
    const isBottom =
      p.includes('pants') ||
      p.includes('jeans') ||
      p.includes('shorts') ||
      p.includes('trousers') ||
      p.includes('chinos') ||
      p.includes('slacks');

    return isBottom ? 'men_bottom' : 'men_top';
  }

  if (hasBoys) return 'boys_all';
  if (hasGirls) return 'girls_all';

  return null;
}

// Regular: XS–XL + numeric 0–14 ONLY (no Plus overlap!)
const WOMEN_REGULAR = new Set<string>([
  '2XS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '0',
  '2',
  '4',
  '6',
  '8',
  '10',
  '12',
  '14',
  'One Size',
]);

// Plus: 2XL+, X-sizes, 16+, W-sizes ONLY
const WOMEN_PLUS = new Set<string>([
  // Lettered plus (2XL and up)
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '0X',
  '1X',
  '2X',
  '3X',
  '4X',
  '5X',
  '6X',
  
  // Numeric plus (16 and up)
  '16',
  '18',
  '20',
  '22',
  '24',
  '26',
  '28',
  '30',
  '32',
  '34',
  
  // W-sizes (women's plus)
  '14W',
  '16W',
  '18W',
  '20W',
  '22W',
  '24W',
  '26W',
  '28W',
  '30W',
  '32W',
  '34W',
]);

// Petites: Standard petite sizes only (up to 14P)
const WOMEN_PETITES = new Set<string>([
  'P2XS',
  'PXS',
  'PP',
  'PS',
  'PM',
  'PL',
  'PXL',
  '00P',
  '0P',
  '2P',
  '4P',
  '6P',
  '8P',
  '10P',
  '12P',
  '14P',
  // Removed: 16P, 18P, 20P (those are Plus Petite)
  // Removed: 0XP-4XP (those are X-size Petites, rare on eBay)
]);

// Tall
const WOMEN_TALL = new Set<string>([
  '2XS Tall',
  'XS Tall',
  'S Tall',
  'M Tall',
  'L Tall',
  'XL Tall',
  '2XL Tall',
  '00 Tall',
  '0 Tall',
  '2 Tall',
  '4 Tall',
  '6 Tall',
  '8 Tall',
  '10 Tall',
  '12 Tall',
  '14 Tall',
  '16 Tall',
  '18 Tall',
  '20 Tall',
  '0XT',
  '1XT',
  '2XT',
  '3XT',
  '4XT',
]);

// Juniors
const WOMEN_JUNIORS = new Set<string>([
  '2XS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '00',
  '0',
  '1',
  '3',
  '5',
  '7',
  '9',
  '11',
  '13',
  '15',
  '17',
  '19',
  '21',
]);

// Maternity: Uses same sizes as Regular/Plus, so keep them separate
// This is the "Regular Maternity" range
const WOMEN_MATERNITY = new Set<string>([
  '2XS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '0',
  '2',
  '4',
  '6',
  '8',
  '10',
  '12',
  '14',
  // Maternity Plus would be 16+ and 2XL+, but eBay typically doesn't separate them
  // If a user selects "Maternity" size type, show all maternity sizes
  '2XL',
  '3XL',
  '16',
  '18',
  '20',
  '22',
  '24',
  '0X',
  '1X',
  '2X',
  '3X',
  '4X',
]);

const WOMEN_MAP: Record<string, Set<string>> = {
  Regular: WOMEN_REGULAR,
  Plus: WOMEN_PLUS,
  Petites: WOMEN_PETITES,
  Tall: WOMEN_TALL,
  Juniors: WOMEN_JUNIORS,
  Maternity: WOMEN_MATERNITY,
};

// Men's Tops – Regular (XS-XL only, no 2XL+)
const MEN_TOP_REGULAR = new Set<string>([
  'XS',
  'S',
  'M',
  'L',
  'XL',
  // Removed: 2XL-7XL (those are Big & Tall)
  // Numeric sizes for dress shirts
  '30',
  '32',
  '34',
  '36',
  '38',
  '40',
  '42',
  '44',
]);

// Tops / jackets – Big & Tall
const MEN_TOP_BIGTALL = new Set<string>([
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '7XL',
  '40',
  '42',
  '44',
  '46',
  '48',
  '50',
  '52',
  '54',
  '56',
  '58',
  '60',
  '62',
  'ST',
  'MT',
  'LT',
  'XLT',
  '2XLT',
  '3XLT',
  '4XLT',
  '5XLT',
  '6XLT',
  'Big 1X',
  'Big 2X',
  'Big 3X',
  'Big 4X',
]);

// Men's Pants – Regular (waists up to 40)
const MEN_BOTTOM_REGULAR = new Set<string>([
  'XS',
  'S',
  'M',
  'L',
  'XL',
  // Waist sizes (regular range)
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
  // Removed: 42-46 (those are Big & Tall)
  'One Size',
]);

// Pants – Big & Tall
const MEN_BOTTOM_BIGTALL = new Set<string>([
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
  '42',
  '44',
  '46',
  '48',
  '50',
  '52',
  '54',
  '56',
  '58',
  '60',
  '62',
  '64',
  '66',
  '68',
  'ST',
  'MT',
  'LT',
  'XLT',
  '2XLT',
  '3XLT',
  '4XLT',
  'Big 1X',
  'Big 2X',
  'Big 3X',
  'Big 4X',
]);

const MEN_TOP_MAP: Record<string, Set<string>> = {
  Regular: MEN_TOP_REGULAR,
  'Big & Tall': MEN_TOP_BIGTALL,
};

const MEN_BOTTOM_MAP: Record<string, Set<string>> = {
  Regular: MEN_BOTTOM_REGULAR,
  'Big & Tall': MEN_BOTTOM_BIGTALL,
};

// -------------------------------------------------------------
// BOYS
// -------------------------------------------------------------
const BOYS_HUSKY = new Set<string>([
  '4 Husky',
  '5 Husky',
  '6 Husky',
  '7 Husky',
  '8 Husky',
  '10 Husky',
  '12 Husky',
  '14 Husky',
  '16 Husky',
  '18 Husky',
  '20 Husky',
]);

const BOYS_SLIM = new Set<string>([
  '4 Slim',
  '5 Slim',
  '6 Slim',
  '7 Slim',
  '8 Slim',
  '9 Slim',
  '10 Slim',
  '12 Slim',
  '14 Slim',
  '16 Slim',
  '18 Slim',
  '20 Slim',
]);

const BOYS_MAP: Record<string, Set<string>> = {
  Husky: BOYS_HUSKY,
  Slim: BOYS_SLIM,
  // Regular → we deliberately do NOT filter so kids' core sizes stay flexible
};

// -------------------------------------------------------------
// GIRLS
// -------------------------------------------------------------
const GIRLS_PLUS = new Set<string>([
  '4 Plus',
  '5 Plus',
  '6 Plus',
  '7 Plus',
  '8 Plus',
  '10 Plus',
  '12 Plus',
  '14 Plus',
  '16 Plus',
  '18 Plus',
  '20 Plus',
]);

const GIRLS_SLIM = new Set<string>([
  '4 Slim',
  '5 Slim',
  '6 Slim',
  '7 Slim',
  '8 Slim',
  '10 Slim',
  '12 Slim',
  '14 Slim',
  '16 Slim',
]);

const GIRLS_MAP: Record<string, Set<string>> = {
  Plus: GIRLS_PLUS,
  Slim: GIRLS_SLIM,
  // Regular → again, no hard filter
};

// -------------------------------------------------------------
// TODDLER
// -------------------------------------------------------------
const TODDLER_ALL = new Set<string>([
  'Newborn',
  'Preemie',
  '0-3 Months',
  '3-6 Months',
  '6-9 Months',
  '9-12 Months',
  '12-18 Months',
  '18-24 Months',
  '2T',
  '3T',
  '4T',
  '5T',
  'One Size',
]);

// -------------------------------------------------------------
// Public API
// -------------------------------------------------------------

/**
 * Return filtered size options for a given category path + size type.
 * If we don't have a mapping for that combination, we simply return the
 * original list so nothing breaks.
 */
export function filterSizesForFamilyAndSizeType(
  categoryPath: string,
  sizeType: string,
  allOptions: string[] = []
): string[] {
  if (!sizeType || !allOptions.length) return allOptions;

  const family = getSizeFamily(categoryPath);
  if (!family) return allOptions;

  const key = normalizeSizeTypeKey(sizeType);

  let allowed: Set<string> | undefined;

  if (family === 'women_all') {
    allowed = WOMEN_MAP[key];
  } else if (family === 'men_top') {
    allowed = MEN_TOP_MAP[key];
  } else if (family === 'men_bottom') {
    allowed = MEN_BOTTOM_MAP[key];
  } else if (family === 'boys_all') {
    allowed = BOYS_MAP[key];
  } else if (family === 'girls_all') {
    allowed = GIRLS_MAP[key];
  } else if (family === 'toddler_all') {
    // toddler has only one implicit size type, so we don't care what label is
    allowed = TODDLER_ALL;
  }

  if (!allowed) {
    // no strict rule → leave as-is
    return allOptions;
  }

  return allOptions.filter((o) => allowed!.has(o.trim()));
}

/**
 * Given the detected Size value and category, infer the correct Size Type.
 * This is used to auto-set Size Type when Size is chosen/AI-detected.
 */
export function detectSizeTypeForFamily(
  categoryPath: string,
  sizeValue: string | string[] | undefined
): string {
  if (!sizeValue) return '';
  const v = Array.isArray(sizeValue)
    ? String(sizeValue[0] ?? '').trim()
    : String(sizeValue ?? '').trim();
  if (!v) return '';

  const family = getSizeFamily(categoryPath);
  if (!family) return '';

  const mapsByFamily: Record<
    SizeFamily,
    Record<string, Set<string>> | undefined
  > = {
    women_all: WOMEN_MAP,
    men_top: MEN_TOP_MAP,
    men_bottom: MEN_BOTTOM_MAP,
    boys_all: BOYS_MAP,
    girls_all: GIRLS_MAP,
    toddler_all: { Regular: TODDLER_ALL },
    null: undefined,
  };

  const map = mapsByFamily[family];
  if (!map) return '';

  const matches = Object.entries(map).filter(([_, set]) => set.has(v));

  if (matches.length === 1) {
    return matches[0][0]; // the size type label (e.g. "Plus")
  }

  // ambiguous or no match → let user pick
  return '';
}
