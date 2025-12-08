import React, { useState, useRef, useEffect, startTransition } from 'react';
import { Upload, X, Image as ImageIcon, Sparkles, CheckCircle } from 'lucide-react';
import CategorySelector from '../components/CategorySelector';
import { useNavigate } from 'react-router-dom';

/* -------------------------------------------------------
   Listing style settings (optional)
------------------------------------------------------- */
type ListingStyleSettings = {
  titleExample?: string;
  titleRules?: string;
  descriptionExample?: string;
  descriptionRules?: string;
  keywordsRules?: string;
  extraInstructions?: string;
};

function loadListingStyleSettings(): ListingStyleSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('listingStyleSettings');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------
   Size / Size Type dependency helpers (DATA-DRIVEN)
------------------------------------------------------- */

type Dept = 'women' | 'men' | 'boys' | 'girls' | 'toddler' | 'unknown';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Infer department from eBay category path.
 */
function detectDeptFromCategoryPath(path: string): Dept {
  const p = norm(path || '');
  if (p.includes('women')) return 'women';
  if (p.includes('men')) return 'men';
  if (p.includes('girls')) return 'girls';
  if (p.includes('boys')) return 'boys';
  if (p.includes('baby') || p.includes('toddler')) return 'toddler';
  return 'unknown';
}

/**
 * Normalize Size Type labels to a canonical key.
 * We keep this simple because options come from eBay.
 */
function normalizeSizeTypeLabel(sizeType: string): string {
  const s = norm(sizeType || '');
  if (!s) return '';
  if (s.includes('regular')) return 'Regular';
  if (s.includes('plus')) return 'Plus';
  if (s.includes('petite')) return 'Petites';
  if (s.includes('maternity')) return 'Maternity';
  if (s.includes('junior')) return 'Juniors';
  if (s.includes('big') && s.includes('tall')) return 'Big & Tall';
  if (s.includes('tall')) return 'Tall';
  if (s.includes('husky')) return 'Husky';
  if (s.includes('slim')) return 'Slim';
  if (s.includes('toddler') || s.includes('baby')) return 'Toddler';
  return sizeType;
}

/**
 * WOMEN – size buckets
 * We deliberately avoid overlapping labels:
 *  - Regular: XS–XL + numeric 0–16 + One Size
 *  - Plus: 1X+, W-sizes, numeric 18+ and 2XL+
 *  - Petites: P*, *P, *XP, etc.
 *  - Tall: "* Tall", "*XT"
 *  - Juniors: Juniors numeric pattern + XS–2XL used in Juniors
 *  - Maternity: standard maternity ranges
 */

// Women Regular (non-plus, non-petite, non-tall)
const WOMEN_REGULAR_SIZES = new Set<string>([
  '2XS', 'XS', 'S', 'M', 'L', 'XL',
  // keep Regular numeric core 0–16
  '0', '2', '4', '6', '8', '10', '12', '14', '15', '16',
  // some extended numeric but still "regular" in many categories
  '17',
  // exclude 18+ from Regular to keep them in Plus bucket
  '30', '32', '34', '36', '38', '40', '42', '44', '46', '48', '50',
  'One Size',
]);

// Women Plus
const WOMEN_PLUS_SIZES = new Set<string>([
  // lettered plus
  '2XL', '3XL', '4XL', '5XL', '6XL',
  '0X', '1X', '2X', '3X', '4X', '5X', '6X',
  // numeric plus
  '18', '19', '20', '22', '24', '26', '28', '30', '32', '34', '36', '38', '40', '42', '44', '46', '48', '50',
  // W-sizes
  '14W', '16W', '18W', '20W', '22W', '24W', '26W', '28W', '30W', '32W', '34W',
]);

// Women Petites
const WOMEN_PETITE_SIZES = new Set<string>([
  'P2XS', 'PXS', 'PP', 'PS', 'PM', 'PL', 'PXL', 'P2XL',
  '00P', '0P', '2P', '4P', '6P', '8P', '10P', '12P', '14P', '16P', '18P', '20P',
  '0XP', '1XP', '2XP', '3XP', '4XP',
]);

// Women Tall
const WOMEN_TALL_SIZES = new Set<string>([
  '2XS Tall', 'XS Tall', 'S Tall', 'M Tall', 'L Tall', 'XL Tall', '2XL Tall',
  '00 Tall', '0 Tall', '2 Tall', '4 Tall', '6 Tall', '8 Tall',
  '10 Tall', '12 Tall', '14 Tall', '16 Tall', '18 Tall', '20 Tall',
  '0XT', '1XT', '2XT', '3XT', '4XT',
]);

// Women Juniors
const WOMEN_JUNIORS_SIZES = new Set<string>([
  '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL',
  '00', '0', '1', '3', '5', '7', '9', '11', '13', '15', '17', '19', '21',
]);

// Women Maternity
const WOMEN_MATERNITY_SIZES = new Set<string>([
  '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL',
  '0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20', '22',
  '0X', '1X', '2X', '3X', '4X', '5X', '6X',
]);

/**
 * MEN – size buckets
 * For men we let some overlap (e.g. 3XL can be Regular or Big & Tall in eBay),
 * but keep Tall-specific labels in Big & Tall only.
 */

// Men tops/jackets – Regular
const MEN_REGULAR_TOP_SIZES = new Set<string>([
  'XS', 'S', 'M', 'L', 'XL',
  '2XL', '3XL', '4XL', '5XL', '6XL', '7XL',
  '30', '32', '34', '36', '38', '40', '42', '44', '46', '48', '50',
]);

// Men tops/jackets – Big & Tall
const MEN_BIG_TALL_TOP_SIZES = new Set<string>([
  'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL',
  '40', '42', '44', '46', '48', '50', '52', '54', '56', '58', '60', '62',
  'ST', 'MT', 'LT', 'XLT', '2XLT', '3XLT', '4XLT', '5XLT', '6XLT',
  'Big 1X', 'Big 2X', 'Big 3X', 'Big 4X',
]);

// Men pants – Regular
const MEN_REGULAR_PANT_SIZES = new Set<string>([
  'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL',
  '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '42', '44', '46',
  'One Size',
]);

// Men pants – Big & Tall
const MEN_BIG_TALL_PANT_SIZES = new Set<string>([
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '42', '44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64', '66', '68',
  'ST', 'MT', 'LT', 'XLT', '2XLT', '3XLT', '4XLT',
  'Big 1X', 'Big 2X', 'Big 3X', 'Big 4X',
]);

/**
 * KIDS / BOYS / GIRLS – we split only where eBay does (Husky / Slim / Plus),
 * but otherwise leave most sizes as Regular.
 */

// Boys – Husky (tops & pants)
const BOYS_HUSKY_SIZES = new Set<string>([
  '4 Husky', '5 Husky', '6 Husky', '7 Husky',
  '8 Husky', '10 Husky', '12 Husky', '14 Husky',
  '16 Husky', '18 Husky', '20 Husky',
]);

// Boys – Slim
const BOYS_SLIM_SIZES = new Set<string>([
  '4 Slim', '5 Slim', '6 Slim', '7 Slim',
  '8 Slim', '9 Slim',
  '10 Slim', '12 Slim', '14 Slim', '16 Slim', '18 Slim', '20 Slim',
]);

// Girls – Plus
const GIRLS_PLUS_SIZES = new Set<string>([
  '4 Plus', '5 Plus', '6 Plus', '7 Plus',
  '8 Plus', '10 Plus', '12 Plus', '14 Plus',
  '16 Plus', '18 Plus', '20 Plus',
]);

// Girls – Slim
const GIRLS_SLIM_SIZES = new Set<string>([
  '4 Slim', '5 Slim', '6 Slim', '7 Slim',
  '8 Slim', '10 Slim', '12 Slim', '14 Slim', '16 Slim',
]);

// Toddler
const TODDLER_SIZES = new Set<string>([
  'Newborn', 'Preemie',
  '0-3 Months', '3-6 Months', '6-9 Months', '9-12 Months',
  '12-18 Months', '18-24 Months',
  '2T', '3T', '4T', '5T',
  'One Size',
]);

/**
 * Return the allowed size set for a given dept + sizeType.
 * NOTE: For men we don't try to distinguish top vs pants by code;
 * we use tops mapping for most "top" categories and pants mapping
 * will still mostly work because of overlapping labels.
 */
function getAllowedSizeSet(dept: Dept, sizeType: string, categoryPath: string): Set<string> | null {
  const st = normalizeSizeTypeLabel(sizeType);

  if (dept === 'women') {
    if (st === 'Regular') return WOMEN_REGULAR_SIZES;
    if (st === 'Plus') return WOMEN_PLUS_SIZES;
    if (st === 'Petites') return WOMEN_PETITE_SIZES;
    if (st === 'Tall') return WOMEN_TALL_SIZES;
    if (st === 'Juniors') return WOMEN_JUNIORS_SIZES;
    if (st === 'Maternity') return WOMEN_MATERNITY_SIZES;
    return null;
  }

  if (dept === 'men') {
    const p = norm(categoryPath);
    const isPants =
      p.includes('pants') ||
      p.includes('jeans') ||
      p.includes('shorts');

    if (st === 'Regular') {
      return isPants ? MEN_REGULAR_PANT_SIZES : MEN_REGULAR_TOP_SIZES;
    }
    if (st === 'Big & Tall') {
      return isPants ? MEN_BIG_TALL_PANT_SIZES : MEN_BIG_TALL_TOP_SIZES;
    }
    return null;
  }

  if (dept === 'boys') {
    if (st === 'Husky') return BOYS_HUSKY_SIZES;
    if (st === 'Slim') return BOYS_SLIM_SIZES;
    // Regular: don't filter aggressively – kids sizing is very mixed
    if (st === 'Regular') return null;
    return null;
  }

  if (dept === 'girls') {
    if (st === 'Plus') return GIRLS_PLUS_SIZES;
    if (st === 'Slim') return GIRLS_SLIM_SIZES;
    if (st === 'Regular') return null;
    return null;
  }

  if (dept === 'toddler') {
    return TODDLER_SIZES;
  }

  return null;
}

/**
 * Filter the Size options based on Size Type AND department.
 * If no match, we fall back to all options so nothing disappears silently.
 */
function filterSizeOptionsBySizeType(
  sizeType: string,
  allOptions: string[] = [],
  categoryPath: string = ''
): string[] {
  const dept = detectDeptFromCategoryPath(categoryPath);
  if (!sizeType || !allOptions.length) return allOptions;

  const allowedSet = getAllowedSizeSet(dept, sizeType, categoryPath);
  if (!allowedSet) {
    // no strict mapping for this combo → keep original options
    return allOptions;
  }

  return allOptions.filter((o) => allowedSet.has(o.trim()));
}

// detect the current "Size Type" selected value from item specifics
function getSizeTypeValue(specs: any[]): string {
  const st = specs?.find((s: any) => /size type/i.test(s?.name || ''));
  return st?.value || '';
}

// recognize size-like aspect names that should be filtered by Size Type
function isSizeAspectName(name: string): boolean {
  return /^(size|waist size|neck size|chest size|inseam)$/i.test(name || '');
}

/* -------------------------------------------------------
   Helper: snap an AI/free-text value to an allowed option
------------------------------------------------------- */
function chooseOptionValue(
  aiValue: string | string[] | undefined,
  options: string[] = [],
  selectionOnly = false
): string {
  if (!aiValue) return '';
  const raw = Array.isArray(aiValue) ? (aiValue[0] ?? '') : aiValue;
  const n = (s: string) => s.trim().toLowerCase().replace(/’/g, "'");

  const exactIdx = options.findIndex((o) => n(o) === n(raw));
  if (exactIdx >= 0) return options[exactIdx];

  const startsIdx = options.findIndex(
    (o) => n(o).startsWith(n(raw)) || n(raw).startsWith(n(o))
  );
  if (startsIdx >= 0) return options[startsIdx];

  const containsIdx = options.findIndex(
    (o) => n(o).includes(n(raw)) || n(raw).includes(n(o))
  );
  if (containsIdx >= 0) return options[containsIdx];

  return selectionOnly ? '' : raw;
}

/* -------------------------------------------------------
   Compact, searchable token selector for item specifics
------------------------------------------------------- */
function TokenSelect({
  value,
  options,
  placeholder,
  multi = false,
  disabled = false,
  onChange,
}: {
  value: string | string[];
  options: string[];
  placeholder?: string;
  multi?: boolean;
  disabled?: boolean;
  onChange: (v: string | string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = Array.isArray(value) ? value : (value ? [value] : []);
  const lowerQuery = query.trim().toLowerCase();
  const filtered = options
    .filter((o) => (multi ? !selected.includes(o) : true))
    .filter((o) => (lowerQuery ? o.toLowerCase().includes(lowerQuery) : true))
    .slice(0, 50);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const addOption = (opt: string) => {
    if (multi) {
      const next = Array.from(new Set([...selected, opt]));
      onChange(next);
    } else {
      onChange(opt);
      setOpen(false);
    }
    setQuery('');
    inputRef.current?.focus();
  };

  const removeOption = (opt: string) => {
    if (!multi) {
      onChange('');
      return;
    }
    onChange(selected.filter((s) => s !== opt));
  };

  const clearAll = () => {
    onChange(multi ? [] : '');
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`min-h-[38px] w-full flex flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-1 transition focus-within:ring-2 focus-within:ring-teal-500 ${
          disabled ? 'opacity-60 cursor-not-allowed' : 'border-gray-300'
        }`}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {/* Chips */}
        {multi &&
          selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-teal-50 text-teal-700 text-xs px-2 py-1"
            >
              {s}
              <button
                type="button"
                className="text-teal-700/70 hover:text-teal-900"
                onClick={(e) => {
                  e.stopPropagation();
                  removeOption(s);
                }}
              >
                ×
              </button>
            </span>
          ))}

        {/* Single pill */}
        {!multi && selected[0] && (
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 text-teal-700 text-xs px-2 py-1">
            {selected[0]}
            <button
              type="button"
              className="text-teal-700/70 hover:text-teal-900"
              onClick={(e) => {
                e.stopPropagation();
                removeOption(selected[0]);
              }}
            >
              ×
            </button>
          </span>
        )}

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => !disabled && setOpen(true)}
          disabled={disabled}
          placeholder={selected.length ? '' : placeholder || 'Search & select...'}
          className="flex-1 min-w-[120px] border-0 outline-none text-sm py-1 placeholder-gray-400"
        />

        {(multi ? selected.length > 0 : !!selected[0]) && !query && !disabled && (
          <button
            type="button"
            className="ml-auto text-gray-400 hover:text-gray-600"
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            aria-label="Clear"
          >
            ×
          </button>
        )}
      </div>

      {open && !disabled && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-gray-200 bg-white shadow">
          {filtered.map((o) => (
            <button
              type="button"
              key={o}
              className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addOption(o)}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------
   Wrapper control deciding between token select / text
------------------------------------------------------- */
function ItemSpecificControl({
  spec,
  onChange,
}: {
  spec: {
    name: string;
    value: string | string[];
    options?: string[];
    required?: boolean;
    multi?: boolean;
    selectionOnly?: boolean;
    freeTextAllowed?: boolean;
  };
  onChange: (val: string | string[]) => void;
}) {
  const opts = Array.isArray(spec.options) ? spec.options : [];

  if (opts.length > 0) {
    return (
      <TokenSelect
        multi={!!spec.multi}
        value={spec.value ?? (spec.multi ? [] : '')}
        options={opts}
        disabled={spec.freeTextAllowed === false && opts.length === 0}
        placeholder="Search & select..."
        onChange={(val) => onChange(val)}
      />
    );
  }

  // Free text fallback
  return (
    <input
      type="text"
      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
      placeholder={spec.freeTextAllowed === false ? 'Select from options' : ''}
      disabled={spec.freeTextAllowed === false}
      value={
        typeof spec.value === 'string'
          ? spec.value
          : Array.isArray(spec.value)
          ? spec.value.join(', ')
          : ''
      }
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* -------------------------------------------------------
   Page
------------------------------------------------------- */
export default function HomePage() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<any>(null);
  const [listingData, setListingData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCategorySelector, setShowCategorySelector] = useState(false);
  const [ebaySpecifics, setEbaySpecifics] = useState<any[]>([]);
  const [loadingSpecifics, setLoadingSpecifics] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const navigate = useNavigate();

  const specificsCacheRef = useRef<Map<string, any[]>>(new Map());
  const inFlightControllerRef = useRef<AbortController | null>(null);

  const normalizeAiToListing = (raw: any) => {
    const categoryId =
      raw?.category?.id || raw?.category_id || raw?.ebay_category_id || '';
    const categoryPath =
      raw?.category?.path ||
      raw?.category?.name ||
      raw?.category_path ||
      raw?.categoryName ||
      '';

    const specificsSource: any[] = Array.isArray(raw?.item_specifics)
      ? raw.item_specifics
      : raw?.itemSpecifics || [];

    const normalizedSpecifics = specificsSource.map((s: any) => ({
      name: s?.name ?? s?.Name ?? '',
      value: s?.value ?? s?.Value ?? '',
      options: s?.options ?? s?.Values ?? [],
      required: s?.required ?? false,
      multi: s?.multi ?? false,
      selectionOnly: s?.selectionOnly ?? false,
      freeTextAllowed: s?.freeTextAllowed ?? true,
    }));

    return {
      title: raw?.title ?? '',
      description: raw?.description ?? '',
      category: { id: categoryId, path: categoryPath },
      item_specifics: normalizedSpecifics,
      keywords: raw?.keywords ?? [],
    };
  };

  const fetchEbaySpecifics = async (categoryId: string, existingSpecifics?: any[]) => {
    if (!categoryId) return;

    if (specificsCacheRef.current.has(categoryId)) {
      const cachedAspects = specificsCacheRef.current.get(categoryId)!;
      const aiSpecificsMap = new Map(
        (existingSpecifics ?? listingData?.item_specifics ?? []).map((s: any) => [
          String(s?.name ?? '').toLowerCase(),
          s?.value ?? '',
        ])
      );

      const mergedSpecificsFromCache = cachedAspects.map((aspect) => {
        const key = String(aspect.name ?? '').toLowerCase();
        const previousValue = aiSpecificsMap.get(key);
        const value = chooseOptionValue(
          previousValue,
          aspect.options ?? [],
          Boolean(aspect.selectionOnly)
        );
        return { ...aspect, value };
      });

      startTransition(() => {
        setEbaySpecifics(mergedSpecificsFromCache);
        setListingData((prev: any) => ({
          ...(prev ?? {}),
          item_specifics: mergedSpecificsFromCache,
        }));
      });
      return;
    }

    if (inFlightControllerRef.current) inFlightControllerRef.current.abort();
    const ctrl = new AbortController();
    inFlightControllerRef.current = ctrl;

    setLoadingSpecifics(true);

    try {
      const response = await fetch('/api/ebay-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getCategorySpecifics', categoryId }),
        signal: ctrl.signal,
      });

      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const aspects: any[] = data?.aspects ?? [];

      const prevList = existingSpecifics ?? listingData?.item_specifics ?? [];
      const prevMap = new Map(
        prevList.map((s: any) => [String(s?.name ?? '').toLowerCase(), s?.value ?? ''])
      );

      const mergedSpecifics = aspects.map((aspect: any) => {
        const key = String(aspect.name ?? '').toLowerCase();
        const previous = prevMap.get(key);

        const isSelectionOnly = aspect.type === 'SelectionOnly';
        const allowsFreeText = aspect.type !== 'SelectionOnly';

        const value = chooseOptionValue(previous, aspect.values ?? [], isSelectionOnly);

        return {
          name: aspect.name,
          required: Boolean(aspect.required),
          multi: Boolean(aspect.multi),
          selectionOnly: isSelectionOnly,
          freeTextAllowed: allowsFreeText,
          options: aspect.values ?? [],
          value,
        };
      });

      specificsCacheRef.current.set(categoryId, mergedSpecifics);

      startTransition(() => {
        setEbaySpecifics(mergedSpecifics);
        setListingData((prev: any) => ({
          ...(prev ?? {}),
          item_specifics: mergedSpecifics,
        }));
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') console.error('Failed to fetch eBay specifics:', err);
    } finally {
      if (inFlightControllerRef.current === ctrl) inFlightControllerRef.current = null;
      setLoadingSpecifics(false);
    }
  };

  const handleCategoryChange = (newCategory: { path: string; id: string }) => {
    setShowCategorySelector(false);

    startTransition(() => {
      setListingData((prevData: any) => ({
        ...(prevData ?? {}),
        category: { path: newCategory.path, id: newCategory.id },
      }));
    });

    if (newCategory?.id) {
      fetchEbaySpecifics(newCategory.id, listingData?.item_specifics ?? []);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setListingData((prevData: any) => ({
      ...(prevData ?? {}),
      [field]: value,
    }));
  };

  // main change handler with dependency logic between Size Type and Size
  const handleItemSpecificsChange = (index: number, value: string | string[]) => {
    setListingData((prev: any) => {
      const next = [...(prev?.item_specifics ?? [])];
      if (!next[index]) return prev;

      // update field
      if (next[index]?.multi) {
        const arr = Array.isArray(value) ? value : value ? [String(value)] : [];
        next[index] = { ...next[index], value: arr };
      } else {
        next[index] = { ...next[index], value: String(Array.isArray(value) ? value[0] ?? '' : value) };
      }

      // if "Size Type" changed, we should re-filter Size options
      if (/size type/i.test(next[index].name || '')) {
        const sizeIdx = next.findIndex((s: any) => isSizeAspectName(s?.name || ''));
        if (sizeIdx !== -1) {
          const sizeSpec = next[sizeIdx];
          const newSizeTypeVal = String(next[index].value || '');
          const filtered = filterSizeOptionsBySizeType(
            newSizeTypeVal,
            sizeSpec?.options || [],
            prev?.category?.path || ''
          );
          // if current value is not allowed anymore → clear it
          if (!filtered.includes(sizeSpec?.value)) {
            next[sizeIdx] = { ...sizeSpec, options: filtered, value: '' };
          } else {
            next[sizeIdx] = { ...sizeSpec, options: filtered };
          }
        }
      }

      return { ...(prev ?? {}), item_specifics: next };
    });

    if (validationErrors.length > 0) {
      setValidationErrors([]);
    }
  };

  const handlePhotoUpload = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (photos.length + newFiles.length > 12) {
      alert('You can upload a maximum of 12 photos.');
      return;
    }
    const newUrls = newFiles.map((f) => URL.createObjectURL(f));
    setPhotos((prev) => [...prev, ...newFiles]);
    setPhotoPreviewUrls((prev) => [...prev, ...newUrls]);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handlePhotoUpload(e.target.files);
  };

  const removePhoto = (indexToRemove: number) => {
    const url = photoPreviewUrls[indexToRemove];
    if (url) URL.revokeObjectURL(url);
    setPhotos((prev) => prev.filter((_, i) => i !== indexToRemove));
    setPhotoPreviewUrls((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const triggerFileInput = () => fileInputRef.current?.click();
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handlePhotoUpload(e.dataTransfer.files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (photos.length === 0) {
      setStatus('Please upload at least one image.');
      return;
    }

    setIsLoading(true);
    setResults(null);
    setListingData(null);
    setStatus('Uploading images to Cloudinary...');

    try {
      // 1) Upload all images to Cloudinary
      const uploadedUrls = await Promise.all(
        photos.map(async (file) => {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('upload_preset', 'ebay_listings');

          const res = await fetch(
            'https://api.cloudinary.com/v1_1/dvhiftzlp/image/upload',
            {
              method: 'POST',
              body: formData,
            }
          );

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data?.error?.message ?? 'Image upload failed');
          }

          return data.secure_url as string;
        })
      );

      setStatus('Images uploaded! Analyzing with AI...');

      // Load listing style settings (if any)
      const listingStyle = loadListingStyleSettings();

      const analyzePayload: any = {
        session_id: Date.now().toString(),
        images: uploadedUrls,
      };

      if (listingStyle) {
        analyzePayload.listing_style = listingStyle;
      }

      const analysisResponse = await fetch('/api/analyze-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analyzePayload),
      });

      if (!analysisResponse.ok) {
        const errorData = await analysisResponse.json().catch(() => ({}));
        throw new Error(errorData?.error ?? 'Failed to analyze images');
      }

      const analysisResult = await analysisResponse.json();
      const aiData =
        analysisResult?.data ||
        analysisResult?.analysis ||
        analysisResult ||
        {};

      const normalized = normalizeAiToListing(aiData);

      setStatus('Listing generated successfully!');
      setResults(aiData);

      // Listing data for the on-page form
      let finalListingData = normalized;
      if (!normalized?.category?.id) {
        finalListingData = { ...normalized, item_specifics: [] };
        setEbaySpecifics([]);
      }

      setListingData(finalListingData);

      // Fetch eBay specifics for the detected category
      if (finalListingData?.category?.id) {
        const catId = finalListingData.category.id;

        if (specificsCacheRef.current.has(catId)) {
          const cached = specificsCacheRef.current.get(catId)!;
          const updatedSpecifics = cached.map((spec: any) => {
            const aiSpec = normalized.item_specifics.find(
              (s: any) => s.name === spec.name
            );
            return aiSpec ? { ...spec, value: aiSpec.value } : spec;
          });

          startTransition(() => {
            setEbaySpecifics(updatedSpecifics);
            setListingData((prev: any) => ({
              ...(prev ?? {}),
              item_specifics: updatedSpecifics,
            }));
          });
        } else {
          fetchEbaySpecifics(catId, normalized.item_specifics);
        }
      }

      // Save everything the Results page needs
      const aiListingPayload = {
        ...aiData,
        title: normalized.title,
        description: normalized.description,
        category: finalListingData.category,
        item_specifics: normalized.item_specifics,
        images: uploadedUrls,
        image_urls: uploadedUrls,
      };

      sessionStorage.setItem('aiListingData', JSON.stringify(aiListingPayload));
      navigate('/results');
    } catch (error: any) {
      console.error('Error:', error);
      setStatus(`Error: ${error?.message ?? 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Validates the listing data before publishing
   */
  const validateListing = (): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (!listingData?.title?.trim()) errors.push('Title is required');
    if (!listingData?.description?.trim()) errors.push('Description is required');
    if (!listingData?.category?.id) errors.push('Category must be selected');
    if (listingData?.title && listingData.title.length > 80) {
      errors.push('Title must be 80 characters or less');
    }

    const specifics = listingData?.item_specifics ?? [];
    for (const spec of specifics) {
      if (!spec.required) continue;
      const value = spec.value;
      if (Array.isArray(value)) {
        if (value.length === 0) errors.push(`${spec.name} is required (select at least one option)`);
      } else {
        if (!String(value ?? '').trim()) errors.push(`${spec.name} is required`);
      }
    }

    if (photos.length === 0) errors.push('At least one photo is required');

    return { valid: errors.length === 0, errors };
  };

  const handlePublishToEbay = async () => {
    if (!listingData) return;

    const validation = validateListing();
    setValidationErrors(validation.errors);
    if (!validation.valid) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setStatus('Publishing to eBay...');
    try {
      const response = await fetch('/api/publish-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_data: listingData,
          images: photoPreviewUrls,
        }),
      });

      if (!response.ok) {
        const msg = await response.text();
        throw new Error(msg || 'Failed to start the publishing process.');
      }

      setStatus('Listing sent to eBay for publishing!');
      setValidationErrors([]);
      alert('Your listing has been sent to eBay! It may take a minute to appear.');
    } catch (error: any) {
      console.error('Error publishing listing:', error);
      setStatus(`Error: ${error?.message ?? 'Unknown error'}`);
      alert(`An error occurred: ${error?.message ?? 'Unknown error'}`);
    }
  };

  // Build UI rows; for "Size" rows, filter options dynamically using current Size Type
  const renderSpecificRow = (spec: any, index: number) => {
    let effectiveSpec = spec;

    if (isSizeAspectName(spec?.name || '')) {
      const sizeTypeVal = getSizeTypeValue(listingData?.item_specifics || []);
      const filteredOpts = filterSizeOptionsBySizeType(
        sizeTypeVal,
        Array.isArray(spec?.options) ? spec.options : [],
        listingData?.category?.path || ''
      );

      if (spec?.value && !filteredOpts.includes(spec.value)) {
        effectiveSpec = { ...spec, options: filteredOpts, value: '' };
      } else {
        effectiveSpec = { ...spec, options: filteredOpts };
      }
    }

    return (
      <div key={`${spec?.name ?? 'spec'}-${index}`} className="grid grid-cols-2 gap-2 mb-3">
        <div className="flex items-center">
          <span className="text-sm text-gray-700">{spec?.name || 'Specific'}</span>
          {spec?.required ? <span className="ml-1 text-red-500">*</span> : null}
        </div>

        <ItemSpecificControl
          spec={effectiveSpec}
          onChange={(newValue) => handleItemSpecificsChange(index, newValue)}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      <section className="py-16 md:py-24 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Try It Now - Free Demo</h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Upload up to 12 photos and see how our AI creates professional listings instantly
              </p>
            </div>

            {validationErrors.length > 0 && (
              <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                <p className="font-semibold mb-2">Please fix the following before publishing:</p>
                <ul className="list-disc ml-5">
                  {validationErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {!listingData ? (
              <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Upload */}
                <div className="card p-6">
                  <h3 className="text-xl font-semibold mb-4 flex items-center">
                    <ImageIcon className="w-5 h-5 mr-2 text-teal-600" />
                    Upload Product Photos
                  </h3>

                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition-all cursor-pointer ${
                      isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 hover:border-teal-400'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={triggerFileInput}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*"
                      multiple
                      onChange={handleFileInputChange}
                    />
                    <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                    <p className="text-gray-700 font-medium">Drag and drop your photos here</p>
                    <p className="text-gray-500 text-sm">or click to browse</p>
                  </div>

                  {photoPreviewUrls.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {photoPreviewUrls.map((url, index) => (
                        <div key={index} className="relative group aspect-square">
                          <img src={url} alt={`Product ${index + 1}`} className="w-full h-full object-cover rounded-lg" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removePhoto(index);
                            }}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          {index === 0 && (
                            <span className="absolute bottom-1 left-1 bg-teal-500 text-white text-xs px-1.5 py-0.5 rounded">
                              Main
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-sm text-gray-500 text-center">{photos.length}/12 photos uploaded</p>
                </div>

                {/* AI Generation */}
                <div className="card p-6 bg-gradient-to-br from-teal-500 to-teal-600 text-white">
                  <h3 className="text-xl font-semibold mb-4 flex items-center">
                    <Sparkles className="w-5 h-5 mr-2" /> AI-Powered Generation
                  </h3>
                  <div className="space-y-4 mb-6">
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">Smart title optimization</span>
                    </div>
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">SEO-optimized descriptions</span>
                    </div>
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">Auto-categorization</span>
                    </div>
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-3 text-teal-200" />
                      <span className="text-sm">Analyzes up to 12 photos</span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || photos.length === 0}
                    className="btn bg-white text-teal-700 hover:bg-teal-50 w-full py-3 flex items-center justify-center"
                  >
                    <Sparkles className="w-5 h-5 mr-2" />
                    {isLoading ? 'Generating...' : 'Generate Listings'}
                  </button>

                  {status && (
                    <p
                      className={`mt-4 text-center font-medium ${
                        status.includes('Error') ? 'text-yellow-300' : 'text-teal-100'
                      }`}
                    >
                      {status}
                    </p>
                  )}
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                  <div className="card overflow-hidden">
                    <img src={photoPreviewUrls[0]} alt="Main product" className="w-full h-auto object-cover" />
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900">Your Generated Listing</h2>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handlePublishToEbay}
                        disabled={!listingData?.category?.id || loadingSpecifics}
                        className={`btn ${
                          !listingData?.category?.id || loadingSpecifics
                            ? 'opacity-50 cursor-not-allowed'
                            : 'bg-teal-600 text-white hover:bg-teal-700'
                        }`}
                      >
                        Publish to eBay
                      </button>
                      <button
                        onClick={() => {
                          setResults(null);
                          setListingData(null);
                          setPhotos([]);
                          setPhotoPreviewUrls([]);
                          setStatus('');
                        }}
                        className="btn btn-outline"
                      >
                        Create Another
                      </button>
                    </div>
                  </div>

                  {/* Editable form */}
                  <div className="bg-white rounded-lg shadow p-6 space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1">Title</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        value={listingData?.title ?? ''}
                        onChange={(e) => handleInputChange('title', e.target.value)}
                        maxLength={80}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {(listingData?.title?.length ?? 0)}/80 characters
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1">Category</label>
                      <div
                        onClick={() => setShowCategorySelector(true)}
                        className="mt-1 flex cursor-pointer items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm hover:bg-gray-50"
                      >
                        <span>{listingData?.category?.path || 'Click to select a category...'}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-gray-400"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-600 mb-1">Description</label>
                      <textarea
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        rows={5}
                        value={listingData?.description ?? ''}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                      />
                    </div>

                    {!!(listingData?.item_specifics?.length) && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-600 mb-2">
                          Item Specifics
                        </label>

                        {listingData.item_specifics.map((spec: any, index: number) =>
                          renderSpecificRow(spec, index)
                        )}
                      </div>
                    )}
                  </div>

                  {showCategorySelector && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                      <div className="w-full max-w-3xl bg-white rounded-lg shadow p-5">
                        <CategorySelector
                          initialCategoryPath={listingData?.category?.path || ''}
                          initialCategoryId={listingData?.category?.id || ''}
                          onCategorySelect={handleCategoryChange}
                          onClose={() => setShowCategorySelector(false)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
