// src/pages/ResultsPage.tsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import CategorySelector from '../components/CategorySelector';
import { filterSizesForFamilyAndSizeType } from '../utils/sizeMaps';
import { supabase } from '../../lib/supabaseClient';

type Category = {
  id: string;
  name: string;
  parentId?: string;
  level?: number;
};

type CategoryWithPath = Category & {
  path?: string;
  breadcrumbs?: string[];
};

type ItemSpecific = {
  name: string;
  value: string | string[];
  required?: boolean;
  type?: string; // "dropdown" | "text"
  options?: string[];
  multi?: boolean;
  selectionOnly?: boolean;
  freeTextAllowed?: boolean;
  allOptions?: string[];
};

type AiDetected = {
  brand?: string;
  size?: string;
  color?: string;
  condition?: string;
  material?: string;
  style?: string;
  department?: string;
  type?: string;
  [key: string]: any;
};

type AiData = {
  title?: string;
  description?: string;
  price_suggestion?: { optimal?: number | string };
  image_url?: string;
  images?: string[];
  image_urls?: string[];
  category?: CategoryWithPath;
  category_suggestions?: Category[];
  item_specifics?: ItemSpecific[] | Record<string, string>;
  keywords?: string[] | string;
  detected?: AiDetected;
};

/* ---------- Generic helpers ---------- */

function normalizeSpecifics(s: AiData['item_specifics']): ItemSpecific[] {
  if (!s) return [];
  if (Array.isArray(s)) {
    return s
      .filter((x) => x && typeof x.name === 'string')
      .map((x) => ({
        ...x,
        value: x.value ?? '',
      }));
  }
  if (typeof s === 'object') {
    return Object.entries(s).map(([name, value]) => ({
      name,
      value: String(value ?? ''),
    }));
  }
  return [];
}

function firstValue(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

/* ---------- Size / Size Type helpers ---------- */

function getSizeTypeValueFromSpecifics(specs: ItemSpecific[]): string {
  const st = specs.find((s) => /size type/i.test(s.name || ''));
  if (!st) return '';
  return firstValue(st.value);
}

function isSizeAspectName(name: string): boolean {
  return /^(size|waist size|neck size|chest size|inseam)$/i.test(name || '');
}

function filterSizeOptionsBySizeType(
  sizeType: string,
  allOptions: string[] = [],
  categoryPath: string = '',
): string[] {
  return filterSizesForFamilyAndSizeType(categoryPath, sizeType, allOptions);
}

function applySizeTypeFilterToSpecifics(
  specs: ItemSpecific[],
  categoryPath: string = '',
): ItemSpecific[] {
  const sizeTypeVal = getSizeTypeValueFromSpecifics(specs);
  if (!sizeTypeVal) return specs;

  return specs.map((spec) => {
    if (!isSizeAspectName(spec.name)) return spec;

    const fullOptions = spec.allOptions ?? spec.options ?? [];
    const filtered = filterSizeOptionsBySizeType(sizeTypeVal, fullOptions, categoryPath);

    let value = spec.value;
    const valueStr = firstValue(typeof value === 'string' || Array.isArray(value) ? value : '');

    if (valueStr && !filtered.includes(valueStr)) {
      value = spec.multi ? [] : '';
    }

    return {
      ...spec,
      options: filtered,
      allOptions: fullOptions,
      value,
    };
  });
}

/* ---------- Compact token selector ---------- */

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const lowerQuery = query.trim().toLowerCase();

  const filtered = options
    .filter((o) => (multi ? !selected.includes(o) : true))
    .filter((o) => (lowerQuery ? o.toLowerCase().includes(lowerQuery) : true))
    .slice(0, 80);

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
        className={`min-h-[38px] w-full flex flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-1 text-sm transition focus-within:ring-2 focus-within:ring-teal-500 ${
          disabled ? 'opacity-60 cursor-not-allowed border-gray-200' : 'border-gray-300'
        }`}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
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
              className="w-full text-left px-3 py-2 text-xs hover:bg-teal-50"
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

function ItemSpecificControl({
  spec,
  onChange,
}: {
  spec: ItemSpecific;
  onChange: (val: string | string[]) => void;
}) {
  const opts = Array.isArray(spec.options) ? spec.options : [];

  if (opts.length > 0 || spec.type === 'dropdown') {
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

  const valString = Array.isArray(spec.value) ? spec.value.join(', ') : spec.value ?? '';

  return (
    <input
      type="text"
      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
      placeholder={`Enter ${spec.name}`}
      value={valString}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ---------- Supabase / Draft helpers ---------- */

function getCategoryPathString(cat: CategoryWithPath | null): string {
  if (!cat) return '';
  if (cat.breadcrumbs && cat.breadcrumbs.length) return cat.breadcrumbs.join(' > ');
  if (cat.path) {
    return cat.path
      .split('>')
      .map((p) => p.trim())
      .filter(Boolean)
      .join(' > ');
  }
  return cat.name || '';
}

async function withTimeout<T>(p: Promise<T>, ms = 12000): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Save timed out')), ms)),
  ]);
}

function extractIdFromRpc(data: any): string | null {
  // handle: [{id:...}], {id:...}, or uuid string
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    const first = data[0];
    if (first?.id && typeof first.id === 'string') return first.id;
    return null;
  }
  if (data?.id && typeof data.id === 'string') return data.id;
  return null;
}

export default function ResultsPage() {
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.00');
  const [keywords, setKeywords] = useState('');
  const [category, setCategory] = useState<CategoryWithPath | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<Category[]>([]);
  const [specifics, setSpecifics] = useState<ItemSpecific[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [loadingSpecifics, setLoadingSpecifics] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [images, setImages] = useState<string[]>([]);
  const [mainImageIndex, setMainImageIndex] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Draft save state (ONLY here, not in TokenSelect)
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string>('');

  const [listingId, setListingId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('nexax.currentListingId');
    } catch {
      return null;
    }
  });

  const aiDetectedRef = useRef<AiDetected>({});
  const aiSpecificsRef = useRef<ItemSpecific[]>([]);

  const removePreviewPane = useCallback(() => {
    const heading = Array.from(document.querySelectorAll('h1, h2, h3, h4')).find((el) => {
      const text = el.textContent?.trim().toLowerCase();
      return text === 'listing preview' || text === 'preview';
    });

    if (!heading) return;

    const previewCard =
      heading.closest('.card') ||
      heading.closest('aside') ||
      heading.closest('section') ||
      heading.parentElement;

    previewCard?.remove();
  }, []);

  useEffect(() => {
    removePreviewPane();
    const observer = new MutationObserver(() => removePreviewPane());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [removePreviewPane]);

  const smartFillSpecifics = useCallback((newSpecifics: ItemSpecific[], aiData: AiDetected): ItemSpecific[] => {
    return newSpecifics.map((field) => {
      let current: string | string[] = field.value;
      let currentStr = firstValue(typeof current === 'string' || Array.isArray(current) ? current : '');

      const lower = field.name.toLowerCase();

      if (!currentStr) {
        let candidate = '';

        if (lower.includes('brand')) candidate = aiData.brand || '';
        else if (lower.includes('size type')) candidate = aiData.type || '';
        else if (lower === 'size' || lower.includes('size')) candidate = aiData.size || '';
        else if (lower.includes('color') || lower.includes('colour')) candidate = aiData.color || '';
        else if (lower.includes('condition')) candidate = aiData.condition || '';
        else if (lower.includes('material')) candidate = aiData.material || '';
        else if (lower.includes('style')) candidate = aiData.style || '';
        else if (lower.includes('department')) candidate = aiData.department || '';
        else if (lower === 'type' || lower.includes('type')) candidate = aiData.type || '';

        if (candidate) {
          current = field.multi ? [candidate] : candidate;
          currentStr = candidate;
        }
      }

      if (field.type === 'dropdown' && field.options?.length) {
        if (Array.isArray(current)) {
          const snapped = current
            .map((v) => {
              const exact = field.options!.find((opt) => opt.toLowerCase() === String(v).toLowerCase());
              return exact || v;
            })
            .filter(Boolean) as string[];
          current = snapped;
        } else if (typeof current === 'string' && current) {
          const exact = field.options.find((opt) => opt.toLowerCase() === String(current).toLowerCase());
          if (exact) current = exact;
        }
      }

      return { ...field, value: current };
    });
  }, []);

  const fetchCategorySpecifics = useCallback(
    async (categoryId: string) => {
      setLoadingSpecifics(true);
      try {
        const response = await fetch('/api/ebay-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getCategorySpecifics', categoryId }),
        });

        if (!response.ok) throw new Error('Failed to fetch category specifics');

        const data = await response.json();

        const baseSpecifics: ItemSpecific[] = (data.aspects || []).map((aspect: any) => ({
          name: aspect.name,
          value: aspect.multi ? [] : '',
          required: !!aspect.required,
          type: aspect.type === 'SelectionOnly' ? 'dropdown' : 'text',
          options: aspect.values || [],
          allOptions: aspect.values || [],
          multi: !!aspect.multi,
          selectionOnly: aspect.type === 'SelectionOnly',
          freeTextAllowed: aspect.type !== 'SelectionOnly',
        }));

        const aiSpecifics = aiSpecificsRef.current || [];
        const aiMap = new Map(aiSpecifics.map((s) => [s.name.toLowerCase(), s.value]));

        const withAiSpecifics: ItemSpecific[] = baseSpecifics.map((field) => {
          const lower = field.name.toLowerCase();
          const aiVal = aiMap.get(lower);
          if (aiVal == null || aiVal === '') return field;

          let value: string | string[];
          if (field.multi) {
            if (Array.isArray(aiVal)) value = aiVal.map((v) => String(v));
            else {
              value = String(aiVal)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            }
          } else {
            value = String(Array.isArray(aiVal) ? aiVal[0] ?? '' : aiVal);
          }

          if (field.type === 'dropdown' && field.options?.length) {
            if (Array.isArray(value)) {
              value = value.map((v) => {
                const exact = field.options!.find((opt) => opt.toLowerCase() === String(v).toLowerCase());
                return exact || v;
              });
            } else if (typeof value === 'string' && value) {
              const exact = field.options.find((opt) => opt.toLowerCase() === value.toLowerCase());
              if (exact) value = exact;
            }
          }

          return { ...field, value };
        });

        const filled = smartFillSpecifics(withAiSpecifics, aiDetectedRef.current || {});
        const sizeFiltered = applySizeTypeFilterToSpecifics(filled, category?.path || '');
        setSpecifics(sizeFiltered);
      } catch (err) {
        console.error('Error fetching specifics:', err);
      } finally {
        setLoadingSpecifics(false);
      }
    },
    [smartFillSpecifics, category?.path],
  );

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('session');

      try {
        let wrapper: any = null;
        let analysis: any = null;

        if (sessionId) {
          const res = await fetch(`/api/listing-data/${sessionId}`);
          if (!res.ok) throw new Error('Failed to fetch data from API');
          wrapper = await res.json();
          analysis = wrapper.data || wrapper.analysis || wrapper;
        } else {
          const raw = sessionStorage.getItem('aiListingData');
          if (!raw) {
            navigate('/create-listing', { replace: true });
            return;
          }
          wrapper = JSON.parse(raw);
          analysis = wrapper.data || wrapper.analysis || wrapper;
        }

        if (!isMounted) return;

        const normalizedAiSpecifics = normalizeSpecifics(analysis.item_specifics);
        aiSpecificsRef.current = normalizedAiSpecifics;
        aiDetectedRef.current = analysis.detected || {};

        setTitle(analysis.title ?? '');
        setDescription(analysis.description ?? '');

        const optimal = analysis.price_suggestion?.optimal;
        setPrice(typeof optimal === 'number' ? optimal.toFixed(2) : String(optimal ?? '0.00'));

        const imgs: string[] =
          analysis.images ||
          analysis.image_urls ||
          wrapper.images ||
          wrapper.image_urls ||
          (analysis.image_url ? [analysis.image_url] : []) ||
          [];
        setImages(imgs);
        setMainImageIndex(0);

        const kw = Array.isArray(analysis.keywords) ? analysis.keywords.join(', ') : String(analysis.keywords ?? '');
        setKeywords(kw);

        setCategorySuggestions(analysis.category_suggestions ?? []);

        const initialCategory: CategoryWithPath | null = analysis.category ?? null;
        setCategory(initialCategory);

        if (initialCategory && initialCategory.id) {
          await fetchCategorySpecifics(initialCategory.id);
        } else {
          const base = normalizeSpecifics(analysis.item_specifics);
          const filled = smartFillSpecifics(base, aiDetectedRef.current || {});
          const sizeFiltered = applySizeTypeFilterToSpecifics(filled, initialCategory?.path || '');
          setSpecifics(sizeFiltered);
        }

        setLoading(false);
      } catch (err: any) {
        console.error('Error loading listing data:', err);
        if (isMounted) {
          setError(err?.message || 'Failed to load data');
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [navigate, fetchCategorySpecifics, smartFillSpecifics]);

  const handleCategorySelect = async (newCategory: CategoryWithPath) => {
    setCategory(newCategory);
    setShowCategoryModal(false);
    await fetchCategorySpecifics(newCategory.id);
  };

  const updateSpecific = (idx: number, value: string | string[]) => {
    setSpecifics((prev) => {
      let next = [...prev];
      next[idx] = { ...next[idx], value };
      if (/size type/i.test(next[idx].name || '')) {
        next = applySizeTypeFilterToSpecifics(next, category?.path || '');
      }
      return next;
    });
  };

  const addSpecific = () => setSpecifics((prev) => [...prev, { name: '', value: '' }]);
  const removeSpecific = (idx: number) => setSpecifics((prev) => prev.filter((_, i) => i !== idx));

  const categoryBreadcrumb = useMemo(() => {
    if (!category) return 'No category selected';
    if (category.breadcrumbs && category.breadcrumbs.length) return category.breadcrumbs.join(' > ');
    if (category.path) {
      const parts = category.path
        .split('>')
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.join(' > ');
    }
    return category.name;
  }, [category]);

  const mainImageUrl = images[mainImageIndex] || '';

  const buildListingJson = () => {
    const categoryPath = getCategoryPathString(category);
    const orderedImages = images.length
      ? [images[mainImageIndex], ...images.filter((_, idx) => idx !== mainImageIndex)]
      : [];

    return {
      title: title.trim(),
      description: description.trim(),
      marketplace: 'ebay',
      category: category ? { id: category.id, name: category.name, path: categoryPath } : null,
      category_id: category?.id || null,
      category_path: categoryPath || null,
      item_specifics: specifics.map((s) => ({
        name: s.name,
        value: s.value,
        required: !!s.required,
        multi: !!s.multi,
        selectionOnly: !!s.selectionOnly,
        freeTextAllowed: s.freeTextAllowed !== false,
        options: s.options || [],
      })),
      keywords: keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      price_suggestion: {
        optimal: parseFloat(price || '0') || 0,
      },
      images: orderedImages,
    };
  };

  const handleSaveDraft = async () => {
    setSaveError(null);
    setDraftStatus('');
    setSavingDraft(true);

    try {
      const hasAnyContent =
        title.trim() ||
        description.trim() ||
        keywords.trim() ||
        specifics.some((s) => firstValue(s.value as any)) ||
        images.length > 0;

      if (!hasAnyContent) {
        setDraftStatus('Nothing to save yet.');
        return;
      }

      // Ensure the tenancy rows exist (idempotent). If this fails, saving drafts will fail too.
      const { error: ensureErr } = await supabase.rpc('ensure_user_and_workspace');
      if (ensureErr) throw ensureErr;

      const listingJson = buildListingJson();
      const orderedImages = (listingJson.images || []) as string[];

      const p_price = (() => {
        const n = parseFloat(price || '0');
        return Number.isFinite(n) ? n : 0;
      })();

      const rpcPromise = supabase.rpc('save_draft_listing', {
        p_listing_id: listingId, // null for insert, uuid for update
        p_title: listingJson.title || '',
        p_description: listingJson.description || '',
        p_category_id: category?.id || '',
        p_category_path: getCategoryPathString(category) || '',
        p_price,
        p_currency: 'USD',
        p_listing_json: listingJson,
        p_images: orderedImages, // jsonb array
      });

      const { data, error: rpcErr } = await withTimeout(rpcPromise, 12000);
      if (rpcErr) throw rpcErr;

      const newId = extractIdFromRpc(data);
      if (!newId) throw new Error('Draft save succeeded but no id was returned.');

      if (!listingId) {
        setListingId(newId);
        try {
          sessionStorage.setItem('nexax.currentListingId', newId);
        } catch {
          // ignore
        }
        setDraftStatus('Draft saved.');
      } else {
        setDraftStatus('Draft updated.');
      }
    } catch (err: any) {
      console.error('[Draft] Save failed:', err);
      const msg = err?.message || 'Failed to save draft.';
      setSaveError(msg);
      setDraftStatus('Failed to save draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  const handlePublish = async () => {
    if (!title.trim() || !description.trim() || !category) {
      alert('Title, description, and category are required.');
      return;
    }
    if (!images.length) {
      alert('At least one image is required.');
      return;
    }

    try {
      setPublishing(true);

      const orderedImages = [images[mainImageIndex], ...images.filter((_, idx) => idx !== mainImageIndex)];

      const listing_data = {
        title: title.trim(),
        description: description.trim(),
        category: { id: category.id, name: category.name },
        item_specifics: specifics.map((s) => ({
          name: s.name,
          value: s.value,
          required: !!s.required,
          multi: !!s.multi,
          selectionOnly: !!s.selectionOnly,
          freeTextAllowed: s.freeTextAllowed !== false,
          options: s.options || [],
        })),
        keywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
        price_suggestion: { optimal: parseFloat(price || '0') || 0 },
      };

      const res = await fetch('/api/publish-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_data, images: orderedImages }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('Publish error:', data);
        alert(`An error occurred: ${JSON.stringify(data, null, 2)}`);
        return;
      }

      alert('Your listing has been sent to eBay! It may take a minute to appear.');
    } catch (err: any) {
      console.error('Publish error:', err);
      alert(`An unexpected error occurred while publishing: ${err?.message || String(err)}`);
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h2>Loading listing data...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h2 style={{ color: 'red' }}>{error}</h2>
        <button onClick={() => navigate('/create-listing')}>Go Back</button>
      </div>
    );
  }

  const normalizedCategoryPathForSelector =
    (category?.breadcrumbs && category.breadcrumbs.length ? category.breadcrumbs.join(' > ') : '') ||
    (category?.path
      ? category.path
          .split('>')
          .map((p) => p.trim())
          .filter(Boolean)
          .join(' > ')
      : '');

  return (
    <div
      style={{
        padding: 24,
        display: 'grid',
        gridTemplateColumns: '1fr 360px',
        gap: 24,
      }}
    >
      <main>
        <h1>Create eBay Listing</h1>

        {/* IMAGES */}
        <section style={{ marginTop: 16 }}>
          <h3>Photos</h3>
          <div
            style={{
              marginTop: 8,
              marginBottom: 12,
              height: 320,
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid #ddd',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#f5f5f5',
            }}
          >
            {mainImageUrl ? (
              <img
                src={mainImageUrl}
                alt="Main"
                style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ color: '#999' }}>No image</div>
            )}
          </div>

          {images.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                justifyContent: 'center',
                marginTop: 8,
              }}
            >
              {images.map((img, idx) => (
                <div
                  key={idx}
                  draggable
                  onClick={() => setMainImageIndex(idx)}
                  onDragStart={(e) => {
                    setDragIndex(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(idx));
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex === null || dragIndex === idx) return;
                    setImages((prevImages) => {
                      const next = [...prevImages];
                      const [moved] = next.splice(dragIndex, 1);
                      next.splice(idx, 0, moved);

                      setMainImageIndex((prevMain) => {
                        const mainUrl = prevImages[prevMain];
                        const newIndex = next.findIndex((url) => url === mainUrl);
                        return newIndex >= 0 ? newIndex : 0;
                      });

                      return next;
                    });
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  style={{
                    borderRadius: 4,
                    overflow: 'hidden',
                    border: idx === mainImageIndex ? '2px solid #0064d2' : '1px solid #ddd',
                    cursor: 'grab',
                    background: '#fafafa',
                    height: 70,
                    width: 70,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <img
                    src={img}
                    alt={`thumb-${idx}`}
                    style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'cover' }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* TITLE */}
        <section style={{ marginTop: 24 }}>
          <h3>Title</h3>
          <input
            placeholder="Enter title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14 }}
            maxLength={80}
          />
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, textAlign: 'right' }}>
            {title.length}/80 characters
          </div>
        </section>

        {/* DESCRIPTION */}
        <section style={{ marginTop: 24 }}>
          <h3>Description</h3>
          <textarea
            placeholder="Enter description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        {/* CATEGORY */}
        <section style={{ marginTop: 24 }}>
          <h3>Category</h3>
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 4,
              padding: 12,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f9f9f9',
              marginTop: 8,
            }}
          >
            <div style={{ flex: 1, marginRight: 12, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Selected Category:</div>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 14,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {categoryBreadcrumb}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCategoryModal(true)}
              style={{
                padding: '8px 16px',
                background: '#0064d2',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              Change
            </button>
          </div>
        </section>

        {/* ITEM SPECIFICS */}
        <section style={{ marginTop: 24 }}>
          <h3>
            Item Specifics{' '}
            {loadingSpecifics && <span style={{ fontSize: 14, color: '#666' }}>(Loading…)</span>}
          </h3>

          {specifics.length === 0 && !loadingSpecifics && (
            <div style={{ opacity: 0.7, marginTop: 8 }}>No specifics loaded. Select a category first.</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-3" style={{ marginTop: 12 }}>
            {specifics.map((spec, i) => (
              <div key={`${spec.name}-${i}`} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 flex justify-between items-center">
                  <span>{spec.name}</span>
                  {spec.required && <span className="ml-1 text-red-500">*</span>}
                </label>
                <ItemSpecificControl spec={spec} onChange={(val) => updateSpecific(i, val)} />
              </div>
            ))}
          </div>

          <button type="button" onClick={addSpecific} style={{ marginTop: 12, padding: '8px 16px', fontSize: 14 }}>
            + Add Custom Specific
          </button>
        </section>

        {/* KEYWORDS */}
        <section style={{ marginTop: 24 }}>
          <h3>Keywords</h3>
          <input
            placeholder="e.g., vintage, designer, rare"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        {/* PRICE */}
        <section style={{ marginTop: 24 }}>
          <h3>Price</h3>
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ width: 240, padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        {/* BUTTONS */}
        <div style={{ marginTop: 32, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={savingDraft}
            style={{
              padding: '12px 32px',
              background: savingDraft ? '#999' : '#2f855a',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: savingDraft ? 'default' : 'pointer',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {savingDraft ? 'Saving…' : 'Save Draft'}
          </button>

          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing}
            style={{
              padding: '12px 32px',
              background: publishing ? '#999' : '#0064d2',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: publishing ? 'default' : 'pointer',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {publishing ? 'Publishing…' : 'Publish to eBay'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/create-listing')}
            style={{
              padding: '12px 32px',
              background: '#f0f0f0',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            Cancel
          </button>

          {saveError ? <span style={{ color: 'red', fontSize: 14 }}>{saveError}</span> : null}
          {draftStatus ? (
            <span style={{ fontSize: 14, color: draftStatus.toLowerCase().includes('fail') ? 'red' : '#2f855a' }}>
              {draftStatus}
            </span>
          ) : null}
        </div>
      </main>

      {/* PREVIEW SIDEBAR */}
      <aside>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, position: 'sticky', top: 24 }}>
          <h4 style={{ marginTop: 0, marginBottom: 12 }}>Preview</h4>
          <div
            style={{
              height: 200,
              background: '#f5f5f5',
              display: 'grid',
              placeItems: 'center',
              marginBottom: 12,
              borderRadius: 4,
            }}
          >
            {mainImageUrl ? (
              <img
                src={mainImageUrl}
                alt="preview"
                style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 4, objectFit: 'contain' }}
              />
            ) : (
              <div style={{ color: '#999' }}>No image</div>
            )}
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{title || 'Your Product Title'}</div>
          <div style={{ color: '#c93', fontWeight: 700, fontSize: 20 }}>US ${price || '0.00'}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
            Category: {category?.name || 'Not selected'}
          </div>
        </div>
      </aside>

      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="w-full max-w-3xl bg-white rounded-lg shadow p-5">
            <CategorySelector
              initialCategoryPath={normalizedCategoryPathForSelector}
              initialCategoryId={category?.id || ''}
              onCategorySelect={handleCategorySelect}
              onClose={() => setShowCategoryModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
