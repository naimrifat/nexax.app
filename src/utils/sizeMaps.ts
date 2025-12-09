// src/utils/sizeMaps.ts

export type SizeTypeLabel =
  | 'Regular'
  | 'Plus'
  | 'Petites'
  | 'Tall'
  | 'Juniors'
  | 'Maternity'
  | 'Big & Tall';

export type SizeFamilyKey = 'WOMEN_CLOTHING' | 'MEN_TOPS' | 'MEN_PANTS';

/**
 * IMPORTANT:
 * These are exact eBay size VALUES, without the item counts.
 * For overlapping values (like 2XL that appear under Regular AND Plus on eBay),
 * I treat them as belonging to BOTH buckets. The reverse map will use a priority
 * order so we can decide what Size Type we prefer when auto-detecting.
 */

const WOMEN_REGULAR = [
  '2XS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '0',
  '2',
  '4',
  '6',
  '8',
  '10',
  '12',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '22',
  '30',
  '32',
  '34',
  '36',
  '38',
  '40',
  '42',
  '44',
  '46',
  '48',
  '50',
  'One Size',
];

const WOMEN_PLUS = [
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '18',
  '20',
  '22',
  '24',
  '26',
  '28',
  '30',
  '32',
  '34',
  '36',
  '38',
  '40',
  '42',
  '44',
  '46',
  '48',
  '50',
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
  '0X',
  '1X',
  '2X',
  '3X',
  '4X',
  '5X',
  '6X',
];

const WOMEN_PETITES = [
  'P2XS',
  'PXS',
  'PP',
  'PS',
  'PM',
  'PL',
  'PXL',
  'P2XL',
  '00P',
  '0P',
  '2P',
  '4P',
  '6P',
  '8P',
  '10P',
  '12P',
  '14P',
  '16P',
  '18P',
  '20P',
  '0XP',
  '1XP',
  '2XP',
  '3XP',
  '4XP',
];

const WOMEN_TALL = [
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
];

const WOMEN_JUNIORS = [
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
];

const WOMEN_MATERNITY = [
  '2XS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '0',
  '2',
  '4',
  '6',
  '8',
  '10',
  '12',
  '14',
  '16',
  '18',
  '20',
  '22',
  '0X',
  '1X',
  '2X',
  '3X',
  '4X',
  '5X',
  '6X',
];

const MEN_TOPS_REGULAR = [
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '7XL',
  '30',
  '32',
  '34',
  '36',
  '38',
  '40',
  '42',
  '44',
  '46',
  '48',
  '50',
];

const MEN_TOPS_BIGTALL = [
  'XL',
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
];

const MEN_SUIT_REGULAR = [
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '30',
  '32',
  '34',
  '36',
  '38',
  '40',
  '41',
  '42',
  '43',
  '44',
  '46',
  '48',
  '50',
];

const MEN_SUIT_BIGTALL = [
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '36',
  '38',
  '40',
  '41',
  '42',
  '43',
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
  'XLT',
  '2XLT',
  '3XLT',
  '4XLT',
];

const MEN_PANTS_REGULAR = [
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
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
  '42',
  '44',
  '46',
  'One Size',
];

const MEN_PANTS_BIGTALL = [
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
];

type SizeMap = Record<SizeTypeLabel, string[]>;

const WOMEN_CLOTHING_SIZE_MAP: SizeMap = {
  Regular: WOMEN_REGULAR,
  Plus: WOMEN_PLUS,
  Petites: WOMEN_PETITES,
  Tall: WOMEN_TALL,
  Juniors: WOMEN_JUNIORS,
  Maternity: WOMEN_MATERNITY,
  'Big & Tall': [], // not relevant for women
};

const MEN_TOPS_SIZE_MAP: SizeMap = {
  Regular: MEN_TOPS_REGULAR,
  Plus: [], // plus handled via Big & Tall for men
  Petites: [],
  Tall: [], // tall is encoded in Big & Tall labels (XLT etc)
  Juniors: [],
  Maternity: [],
  'Big & Tall': MEN_TOPS_BIGTALL,
};

const MEN_PANTS_SIZE_MAP: SizeMap = {
  Regular: MEN_PANTS_REGULAR,
  Plus: [],
  Petites: [],
  Tall: [],
  Juniors: [],
  Maternity: [],
  'Big & Tall': MEN_PANTS_BIGTALL,
};

export const SIZE_MAP: Record<SizeFamilyKey, SizeMap> = {
  WOMEN_CLOTHING: WOMEN_CLOTHING_SIZE_MAP,
  MEN_TOPS: MEN_TOPS_SIZE_MAP,
  MEN_PANTS: MEN_PANTS_SIZE_MAP,
};

/**
 * Build reverse lookup: for each size value, which Size Type should we prefer?
 * Priority order is important when a value appears in multiple buckets.
 * For women I bias Plus/Petites/Juniors over Regular; for men I bias Big & Tall
 * over Regular when the size clearly belongs there.
 */
const SIZE_TYPE_PRIORITY: SizeTypeLabel[] = [
  'Petites',
  'Juniors',
  'Maternity',
  'Plus',
  'Tall',
  'Big & Tall',
  'Regular',
];

type ReverseSizeMap = Record<SizeFamilyKey, Record<string, SizeTypeLabel>>;

export const REVERSE_SIZE_MAP: ReverseSizeMap = (() => {
  const out: Partial<ReverseSizeMap> = {};

  (Object.keys(SIZE_MAP) as SizeFamilyKey[]).forEach((family) => {
    const famMap = SIZE_MAP[family];
    const rev: Record<string, SizeTypeLabel> = {};

    SIZE_TYPE_PRIORITY.forEach((label) => {
      const sizes = famMap[label] || [];
      sizes.forEach((sz) => {
        if (!rev[sz]) {
          rev[sz] = label;
        }
      });
    });

    out[family] = rev;
  });

  return out as ReverseSizeMap;
})();

/**
 * Normalize size type strings coming from eBay / AI / user into our labels.
 */
export function normalizeSizeTypeLabel(raw: string | undefined | null): SizeTypeLabel | '' {
  if (!raw) return '';
  const v = raw.toString().toLowerCase();

  if (v.includes('petite')) return 'Petites';
  if (v.includes('junior')) return 'Juniors';
  if (v.includes('maternity')) return 'Maternity';
  if (v.includes('big') || v.includes('husky') || v.includes('tall')) return 'Big & Tall';
  if (v.includes('plus')) return 'Plus';
  if (v.includes('regular') || v.includes('standard') || v.includes('misses')) return 'Regular';

  return '';
}

/**
 * Map a category path to a size family.
 * This is where we decide which map to use for a given eBay category path.
 */
export function getSizeFamilyForCategoryPath(path: string): SizeFamilyKey | null {
  const p = path.toLowerCase();

  // Women clothing (tops, dresses, outerwear, bottoms)
  if (
    p.includes("women") &&
    (p.includes("dress") ||
      p.includes("dresses") ||
      p.includes("tops") ||
      p.includes("shirt") ||
      p.includes("blouse") ||
      p.includes("sweater") ||
      p.includes("coat") ||
      p.includes("jacket") ||
      p.includes("jeans") ||
      p.includes("pants") ||
      p.includes("leggings") ||
      p.includes("shorts") ||
      p.includes("skirts") ||
      p.includes("activewear") ||
      p.includes("intimates") ||
      p.includes("swimwear"))
  ) {
    return 'WOMEN_CLOTHING';
  }

  // Men – tops, outerwear, etc.
  if (
    p.includes("men") &&
    (p.includes("shirt") ||
      p.includes("t-shirt") ||
      p.includes("tshirt") ||
      p.includes("tops") ||
      p.includes("sweater") ||
      p.includes("hoodie") ||
      p.includes("coat") ||
      p.includes("jacket") ||
      p.includes("sport coats") ||
      p.includes("blazers"))
  ) {
    return 'MEN_TOPS';
  }

  // Men – pants/jeans/shorts
  if (
    p.includes("men") &&
    (p.includes("jeans") ||
      p.includes("pants") ||
      p.includes("trousers") ||
      p.includes("shorts"))
  ) {
    return 'MEN_PANTS';
  }

  return null;
}

/**
 * Given a category path, selected Size Type and all eBay options,
 * return the subset of options valid for that combo.
 */
export function filterSizesForFamilyAndSizeType(
  categoryPath: string,
  sizeTypeRaw: string,
  allOptions: string[] = []
): string[] {
  const family = getSizeFamilyForCategoryPath(categoryPath);
  if (!family) return allOptions;

  const map = SIZE_MAP[family];
  if (!map) return allOptions;

  const st = normalizeSizeTypeLabel(sizeTypeRaw) || 'Regular';
  const allowed = new Set(map[st] || []);

  // If for some reason that type has no entries in our map, don't over-filter.
  if (allowed.size === 0) return allOptions;

  return allOptions.filter((opt) => allowed.has(opt));
}

/**
 * Auto-detect Size Type for a given size value, within a category family.
 */
export function detectSizeTypeForFamily(
  categoryPath: string,
  sizeValue: string | string[] | undefined
): SizeTypeLabel | '' {
  const family = getSizeFamilyForCategoryPath(categoryPath);
  if (!family || !sizeValue) return '';

  const v = Array.isArray(sizeValue) ? sizeValue[0] : sizeValue;
  if (!v) return '';

  const rev = REVERSE_SIZE_MAP[family];
  return rev[v] || '';
}
