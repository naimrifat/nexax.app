// src/pages/ResultsPage.tsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './ResultsPage.css';
import CategorySelector from '../components/CategorySelector';
import { filterSizesForFamilyAndSizeType } from '../utils/sizeMaps';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../context/AuthContext'; // adjust if different

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
  sizeTypeHint?: string;
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

type PolicyOption = { id: string; name: string };

/* ---------- Timeout helper ---------- */
async function withTimeout<T>(p: Promise<T>, ms = 15000, label = 'operation'): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`[Timeout] ${label} exceeded ${ms}ms`)), ms);
  });

  try {
    return (await Promise.race([p, timeoutPromise])) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ---------- Generic helpers ---------- */
function normalizeSpecifics(s: AiData['item_specifics']): ItemSpecific[] {
  if (!s) return [];
  if (Array.isArray(s)) {
    return s
      .filter((x) => x && typeof (x as any).name === 'string')
      .map((x: any) => ({
        ...x,
        value: x.value ?? (x.multi ? [] : ''),
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

function isHostedImageUrl(u: string): boolean {
  const s = String(u || '').trim();
  if (!s) return false;
  if (s.startsWith('blob:')) return false;
  if (s.startsWith('data:')) return false;
  return /^https?:\/\//i.test(s);
}

function sanitizeHostedImages(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((u) => typeof u === 'string')
    .map((u) => u.trim())
    .filter(Boolean)
    .filter(isHostedImageUrl);
}

function toIntOrNull(v: string): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toNumOrNull(v: string): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isNetworkLikeError(err: any): boolean {
  const msg = String(err?.message || '');
  return err?.name === 'TypeError' || /failed to fetch/i.test(msg) || /network/i.test(msg);
}

function extractRequestId(json: any): string | undefined {
  const v =
    json?.requestId ??
    json?.request_id ??
    json?.requestID ??
    json?.meta?.requestId ??
    json?.meta?.request_id;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function extractEbayErrorId(json: any): string | undefined {
  const v = json?.ebayErrorId ?? json?.ebay_error_id ?? json?.errorId ?? json?.error_id;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function extractApiMessage(json: any): string {
  const direct = json?.message ?? json?.error ?? json?.detail ?? json?.details;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  if (Array.isArray(json?.errors) && json.errors.length) {
    const first = json.errors[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
  }

  return '';
}

/* ---------- Size helpers ---------- */
function getSizeTypeValueFromSpecifics(specs: ItemSpecific[]): string {
  const st = specs.find((s) => /size type/i.test(s.name || ''));
  if (!st) return '';
  return firstValue(st.value);
}

function isSizeAspectName(name: string): boolean {
  return /^(size|waist size|neck size|chest size|inseam)$/i.test(name || '');
}

function filterSizeOptionsBySizeType(sizeType: string, allOptions: string[] = [], categoryPath: string = ''): string[] {
  return filterSizesForFamilyAndSizeType(categoryPath, sizeType, allOptions);
}

function applySizeTypeFilterToSpecifics(specs: ItemSpecific[], categoryPath: string = ''): ItemSpecific[] {
  const sizeTypeVal = getSizeTypeValueFromSpecifics(specs);
  if (!sizeTypeVal) return specs;

  return specs.map((spec) => {
    if (!isSizeAspectName(spec.name)) return spec;

    const fullOptions = spec.allOptions ?? spec.options ?? [];
    const filtered = filterSizeOptionsBySizeType(sizeTypeVal, fullOptions, categoryPath);

    let value = spec.value;
    const valueStr = firstValue(typeof value === 'string' || Array.isArray(value) ? (value as any) : '');

    if (valueStr && !filtered.includes(valueStr)) {
      value = spec.multi ? [] : '';
    }

    return { ...spec, options: filtered, allOptions: fullOptions, value };
  });
}

/* ---------- Compact token selector ---------- */
function TokenSelect({
  value,
  options,
  placeholder,
  multi = false,
  disabled = false,
  hasError = false,
  onChange,
}: {
  value: string | string[];
  options: string[];
  placeholder?: string;
  multi?: boolean;
  disabled?: boolean;
  hasError?: boolean;
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
    if (multi) onChange(Array.from(new Set([...selected, opt])));
    else {
      onChange(opt);
      setOpen(false);
    }
    setQuery('');
    inputRef.current?.focus();
  };

  const removeOption = (opt: string) => {
    if (!multi) onChange('');
    else onChange(selected.filter((s) => s !== opt));
  };

  const clearAll = () => {
    onChange(multi ? [] : '');
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`min-h-[32px] w-full flex flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-0.5 text-sm transition focus-within:ring-2 ${
          hasError ? 'border-red-500 focus-within:ring-red-500' : 'focus-within:ring-teal-500'
        } ${disabled ? 'opacity-60 cursor-not-allowed border-gray-200' : hasError ? 'border-red-500' : 'border-gray-300'}`}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {multi &&
          selected.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-teal-50 text-teal-700 text-xs px-2 py-0.5">
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
          className="flex-1 min-w-[120px] border-0 outline-none text-sm py-0.5 placeholder-gray-400"
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
  hasError,
}: {
  spec: ItemSpecific;
  onChange: (val: string | string[]) => void;
  hasError?: boolean;
}) {
  const opts = Array.isArray(spec.options) ? spec.options : [];
  if (opts.length > 0 || spec.type === 'dropdown') {
    return (
      <TokenSelect
        multi={!!spec.multi}
        value={spec.value ?? (spec.multi ? [] : '')}
        options={opts}
        disabled={spec.freeTextAllowed === false && opts.length === 0}
        hasError={!!hasError}
        placeholder="Search & select..."
        onChange={(val) => onChange(val)}
      />
    );
  }

  const valString = Array.isArray(spec.value) ? spec.value.join(', ') : spec.value ?? '';
  return (
    <input
      type="text"
      className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 text-sm ${
        hasError ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-teal-500'
      }`}
      placeholder={`Enter ${spec.name}`}
      value={valString}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ---------- Category path helper ---------- */
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

/* ---------- Tenancy from AuthContext (single source of truth) ---------- */
type Tenancy = { workspaceId: string; internalUserId: string; authUserId: string };

export default function ResultsPage() {
  const navigate = useNavigate();
  const { user, workspaceId, internalUserId, isLoading: authLoading, refreshTenancy } = useAuth();

  // ----------------------------
  // State
  // ----------------------------
  const [category, setCategory] = useState<CategoryWithPath | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<Category[]>([]);
  const [specifics, setSpecifics] = useState<ItemSpecific[]>([]);
  const [images, setImages] = useState<string[]>([]);

  const [conditionOptions, setConditionOptions] = useState<{ conditionId: number; conditionName: string }[]>([]);
  const [conditionRequired, setConditionRequired] = useState(false);
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [conditionId, setConditionId] = useState<string>('');
  const [conditionName, setConditionName] = useState<string>('');
  const [conditionDescription, setConditionDescription] = useState<string>('');
  const [mainImageIndex, setMainImageIndex] = useState(0);

  const conditionIntentRef = useRef<string>('');
  const autoSelectConditionKeyRef = useRef<string>('');

  const [title, setTitle] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0.00');
  const [keywords, setKeywords] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [loadingSpecifics, setLoadingSpecifics] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string>('');
  const [draftSavedSuccessfully, setDraftSavedSuccessfully] = useState(false);

  const [uiError, setUiError] = useState<null | {
    title: string;
    message: string;
    requestId?: string;
    ebayErrorId?: string;
    status?: number;
  }>(null);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [publishSuccess, setPublishSuccess] = useState<{ ebay_item_id?: string | null; ebay_listing_url?: string | null } | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightPassed, setPreflightPassed] = useState<boolean | null>(null);
  const [preflightMessage, setPreflightMessage] = useState<string | null>(null);
  const [lastPreflightCode, setLastPreflightCode] = useState<string | null>(null);
  const [lastPublishCode, setLastPublishCode] = useState<string | null>(null);
  const [ebayReconnectRequired, setEbayReconnectRequired] = useState(false);
  const [ebayReconnectLoading, setEbayReconnectLoading] = useState(false);
  const [ebayReconnectError, setEbayReconnectError] = useState<string | null>(null);
  const [showTitleInlineError, setShowTitleInlineError] = useState(false);
  const [highlightMissing, setHighlightMissing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [autosaveErrorMessage, setAutosaveErrorMessage] = useState<string | null>(null);
  const autosaveTimerRef = useRef<any>(null);
  const lastAutosaveResultKeyRef = useRef<string>('');

  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveIndicatorTimeoutRef = useRef<number | null>(null);

  // DB listing id
  const [listingId, setListingId] = useState<string | null>(null);

  // Shipping & Policies (per listing)
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const [paymentPolicies, setPaymentPolicies] = useState<PolicyOption[]>([]);
  const [returnPolicies, setReturnPolicies] = useState<PolicyOption[]>([]);
  const [fulfillmentPolicies, setFulfillmentPolicies] = useState<PolicyOption[]>([]);

  const [ebayPaymentPolicyId, setEbayPaymentPolicyId] = useState<string>('');
  const [ebayReturnPolicyId, setEbayReturnPolicyId] = useState<string>('');
  const [ebayFulfillmentPolicyId, setEbayFulfillmentPolicyId] = useState<string>('');

  const [packageWeightLb, setPackageWeightLb] = useState<string>('');
  const [packageWeightOz, setPackageWeightOz] = useState<string>('');
  const [packageLengthIn, setPackageLengthIn] = useState<string>('');
  const [packageWidthIn, setPackageWidthIn] = useState<string>('');
  const [packageHeightIn, setPackageHeightIn] = useState<string>('');
  const [irregularPackage, setIrregularPackage] = useState<boolean>(false);

  // ----------------------------
  // Refs
  // ----------------------------
  const aiDetectedRef = useRef<AiDetected>({});
  const aiSpecificsRef = useRef<ItemSpecific[]>([]);
  const didInitialLoadRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const photosSectionRef = useRef<HTMLElement | null>(null);
  const categorySectionRef = useRef<HTMLElement | null>(null);
  const conditionSectionRef = useRef<HTMLElement | null>(null);
  const conditionSelectRef = useRef<HTMLSelectElement | null>(null);
  const conditionDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const specificsSectionRef = useRef<HTMLElement | null>(null);
  const priceSectionRef = useRef<HTMLElement | null>(null);
  const policiesSectionRef = useRef<HTMLElement | null>(null);

  // ----------------------------
  // Tenancy guard
  // ----------------------------
  const ensureTenancy = useCallback(async (): Promise<Tenancy> => {
    if (authLoading) throw new Error('Auth still loading');
    if (!user?.id) throw new Error('Not authenticated');

    // If tenancy isn't ready yet, try one refresh (AuthContext runs the RPC).
    if (!workspaceId || !internalUserId) {
      try {
        await refreshTenancy();
      } catch {
        // ignore; next check will throw a clear error
      }
    }

    if (!workspaceId || !internalUserId) throw new Error('Tenancy not ready');
    return { authUserId: user.id, workspaceId, internalUserId };
  }, [authLoading, user?.id, workspaceId, internalUserId, refreshTenancy]);

  // ----------------------------
  // Policy lists loader
  // ----------------------------
  const fetchPolicyLists = useCallback(
    async (wsId: string) => {
      setPolicyLoading(true);
      setPolicyError(null);

      try {
        const {
          data: { session },
          error: sessionErr,
        } = await supabase.auth.getSession();

        if (sessionErr || !session?.access_token) {
          throw new Error('Not logged in. Please sign in again.');
        }

        // Keep these fixed for now (matches your current single-marketplace reality)
        const env = 'production';
        const marketplaceId = 'EBAY_US';

        const qs = new URLSearchParams({
          workspace_id: wsId,
          env,
          marketplace_id: marketplaceId,
        });

        const res = await fetch(`/api/ebay-policy-lists?${qs.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Failed to fetch eBay policy lists');

        setPaymentPolicies(Array.isArray(json.paymentPolicies) ? json.paymentPolicies : []);
        setReturnPolicies(Array.isArray(json.returnPolicies) ? json.returnPolicies : []);
        setFulfillmentPolicies(Array.isArray(json.fulfillmentPolicies) ? json.fulfillmentPolicies : []);

        // Prefill ONLY if empty (do not override existing values)
        if (!ebayPaymentPolicyId && Array.isArray(json.paymentPolicies) && json.paymentPolicies[0]?.id) {
          setEbayPaymentPolicyId(String(json.paymentPolicies[0].id));
        }
        if (!ebayReturnPolicyId && Array.isArray(json.returnPolicies) && json.returnPolicies[0]?.id) {
          setEbayReturnPolicyId(String(json.returnPolicies[0].id));
        }
        if (!ebayFulfillmentPolicyId && Array.isArray(json.fulfillmentPolicies) && json.fulfillmentPolicies[0]?.id) {
          setEbayFulfillmentPolicyId(String(json.fulfillmentPolicies[0].id));
        }
      } catch (e: any) {
        setPolicyError(e?.message || 'Failed to load policies');
        setPaymentPolicies([]);
        setReturnPolicies([]);
        setFulfillmentPolicies([]);
      } finally {
        setPolicyLoading(false);
      }
    },
    [ebayPaymentPolicyId, ebayReturnPolicyId, ebayFulfillmentPolicyId]
  );

  useEffect(() => {
    if (!workspaceId) return;
    void fetchPolicyLists(workspaceId);
  }, [workspaceId, fetchPolicyLists]);

  // ----------------------------
  // Helpers
  // ----------------------------
  const smartFillSpecifics = useCallback((newSpecifics: ItemSpecific[], aiData: AiDetected): ItemSpecific[] => {
    return newSpecifics.map((field) => {
      let current: string | string[] = field.value;
      const currentStr = firstValue(typeof current === 'string' || Array.isArray(current) ? (current as any) : '');
      const lower = (field.name || '').toLowerCase();

      if (!currentStr) {
        let candidate = '';

        if (lower.includes('brand')) candidate = aiData.brand || '';
        else if (lower.includes('size type')) candidate = aiData.sizeTypeHint || '';
        else if (
          lower === 'size' ||
          lower.includes('waist') ||
          lower.includes('inseam') ||
          lower.includes('neck') ||
          lower.includes('chest')
        )
          candidate = aiData.size || '';
        else if (lower.includes('color') || lower.includes('colour')) candidate = aiData.color || '';
        else if (lower.includes('condition')) candidate = aiData.condition || '';
        else if (lower.includes('material')) candidate = aiData.material || '';
        else if (lower.includes('style')) candidate = aiData.style || '';
        else if (lower.includes('department')) candidate = aiData.department || '';
        else if (lower === 'type') candidate = aiData.type || '';

        if (candidate) current = field.multi ? [candidate] : candidate;
      }

      if (field.type === 'dropdown' && field.options?.length) {
        if (Array.isArray(current)) {
          current = current
            .map((v) => field.options!.find((opt) => opt.toLowerCase() === String(v).toLowerCase()) || v)
            .filter(Boolean) as string[];
        } else if (typeof current === 'string' && current) {
          const exact = field.options.find((opt) => opt.toLowerCase() === String(current).toLowerCase());
          if (exact) current = exact;
        }
      }

      return { ...field, value: current };
    });
  }, []);

  const fetchCategorySpecifics = useCallback(
    async (categoryId: string, categoryPathForFilter: string) => {
      setLoadingSpecifics(true);
      try {
        setError(null);

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
        const aiMap = new Map(aiSpecifics.map((s) => [String(s.name || '').toLowerCase(), s.value]));

        const withAiSpecifics: ItemSpecific[] = baseSpecifics.map((field) => {
          const aiVal = aiMap.get(String(field.name || '').toLowerCase());
          if (aiVal == null || aiVal === '') return field;

          let value: string | string[];
          if (field.multi) {
            value = Array.isArray(aiVal)
              ? aiVal.map((v) => String(v))
              : String(aiVal)
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
          } else {
            value = String(Array.isArray(aiVal) ? aiVal[0] ?? '' : aiVal);
          }

          return { ...field, value };
        });

        const filled = smartFillSpecifics(withAiSpecifics, aiDetectedRef.current || {});
        setSpecifics(applySizeTypeFilterToSpecifics(filled, categoryPathForFilter));
      } catch (err: any) {
        console.error('[Specifics] Error:', err);
        setError(err?.message || 'Failed to load category specifics');
      } finally {
        setLoadingSpecifics(false);
      }
    },
    [smartFillSpecifics]
  );

  const fetchItemConditions = useCallback(
    async (categoryId: string) => {
      const cid = String(categoryId || '').trim();
      if (!cid) {
        setConditionOptions([]);
        setConditionRequired(false);
        setConditionId('');
        setConditionName('');
        setConditionDescription('');
        return;
      }

      setConditionsLoading(true);
      setConditionRequired(true);

      try {
        const {
          data: { session },
          error: sessionErr,
        } = await supabase.auth.getSession();

        if (sessionErr || !session?.access_token) {
          setConditionOptions([]);
          setConditionRequired(true);
          return;
        }

        const response = await fetch('/api/ebay-item-conditions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ category_id: cid }),
        });

        const data: any = await response.json().catch(() => ({}));

        if (!response.ok) {
          setConditionOptions([]);
          setConditionRequired(true);
          return;
        }

        const next = Array.isArray(data?.conditions) ? data.conditions : [];

        // Backend returns { conditions, rawCategoryId, marketplaceId }
        setConditionRequired(true);
        setConditionOptions(next);


        if (conditionId) {
          const stillValid = next.some((c: any) => String(c?.conditionId) === String(conditionId));
          if (!stillValid) {
            setConditionId('');
            setConditionName('');
            setConditionDescription('');
          }
        }
      } finally {
        setConditionsLoading(false);
      }
    },
    [conditionId]
  );

  useEffect(() => {
    void fetchItemConditions(String(category?.id || ''));
  }, [category?.id, fetchItemConditions]);

  function normalizeLabel(s: string): string {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Auto-select condition_id from condition_intent once the listing + category + options are ready.
  useEffect(() => {
    const listingIdStr = String(listingId || '').trim();
    const categoryId = String(category?.id || '').trim();

    // 1) Gate on required prerequisites
    if (!listingIdStr) return; // listing must be loaded
    if (!categoryId) return;
    if (conditionsLoading) return;

    if (!Array.isArray(conditionOptions) || conditionOptions.length === 0) return;

    // Do not override manual selection.
    if (String(conditionId || '').trim()) return;

    const intent = String(conditionIntentRef.current || '').trim().toUpperCase();
    if (!intent || intent === 'UNKNOWN') return;


    const key = `${listingIdStr}:${categoryId}`;
    if (autoSelectConditionKeyRef.current === key) return;

    // 2) Matching helpers
    const has = (label: string, needle: string) => normalizeLabel(label).includes(normalizeLabel(needle));

    const isNewWithDefects = (label: string) => {
      const l = normalizeLabel(label);
      return l.includes('defect') || l.includes('defects');
    };

    const findFirst = (needles: string[], opts?: { avoidDefects?: boolean }) => {
      const avoidDefects = opts?.avoidDefects !== false;

      // Pass 1: avoid defects
      for (const opt of conditionOptions) {
        const label = String(opt?.conditionName || '');
        if (!label) continue;
        if (avoidDefects && isNewWithDefects(label)) continue;
        if (needles.some((n) => has(label, n))) return opt;
      }

      // Pass 2: allow defects
      for (const opt of conditionOptions) {
        const label = String(opt?.conditionName || '');
        if (!label) continue;
        if (needles.some((n) => has(label, n))) return opt;
      }

      return null;
    };

    let chosen: { conditionId: number; conditionName: string } | null = null;

    // 3) Intent-specific priority
    if (intent === 'NEW_WITH_TAGS') {
      chosen = findFirst(['new with tags']);
      if (!chosen) chosen = findFirst(['new without tags']);
      if (!chosen) chosen = findFirst(['new']);
    } else if (intent === 'NEW_WITH_BOX') {
      chosen = findFirst(['new with box', 'new in box', 'new in original box']);
      if (!chosen) chosen = findFirst(['new']);
    } else if (intent === 'NEW_OTHER') {
      chosen = findFirst(['brand new', 'new other', 'new']);
    } else if (intent === 'USED_EXCELLENT') {
      chosen = findFirst(['used excellent', 'pre owned excellent', 'preowned excellent', 'used']);
      if (!chosen) chosen = findFirst(['pre owned', 'preowned', 'used']);
    } else if (intent === 'USED_GOOD') {
      chosen = findFirst(['used good', 'pre owned good', 'preowned good', 'used']);
      if (!chosen) chosen = findFirst(['pre owned', 'preowned', 'used']);
    } else if (intent === 'USED_FAIR') {
      chosen = findFirst(['used fair', 'acceptable', 'used']);
      if (!chosen) chosen = findFirst(['pre owned', 'preowned', 'used']);
    }

    if (!chosen) {
      console.log('[results] condition auto-select: no match', {
        listingId: listingIdStr,
        categoryId,
        intent,
        optionsCount: conditionOptions.length,
      });
      autoSelectConditionKeyRef.current = key;
      return;
    }

    autoSelectConditionKeyRef.current = key;

    const matchedId = (chosen as any)?.id ?? (chosen as any)?.conditionId ?? (chosen as any)?.condition_id;
    const matchedName = (chosen as any)?.name ?? (chosen as any)?.label ?? (chosen as any)?.conditionName ?? (chosen as any)?.condition_name;


    setConditionId(String((chosen as any).conditionId));
    setConditionName(String((chosen as any).conditionName || ''));
    // Do not auto-fill conditionDescription.
  }, [listingId, category?.id, conditionsLoading, conditionOptions, conditionId]);

  const mainImageUrl = images[mainImageIndex] || '';

  const preflightInputKey = useMemo(
    () =>
      JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        categoryId: category?.id || null,
        price,
        images,
        ebayPaymentPolicyId,
        ebayReturnPolicyId,
        ebayFulfillmentPolicyId,
        conditionId,
        conditionName,
        conditionDescription,
        specifics: (specifics || []).map((s) => ({ name: s?.name, value: s?.value })),
      }),
    [
      title,
      description,
      category?.id,
      price,
      images,
      ebayPaymentPolicyId,
      ebayReturnPolicyId,
      ebayFulfillmentPolicyId,
      conditionId,
      conditionName,
      conditionDescription,
      specifics,
    ]
  );

  const lastPreflightInputKeyRef = useRef<string>('');

  const autosaveKey = useMemo(
    () =>
      JSON.stringify({
        preflightInputKey,
        sku: sku.trim(),
        keywords,
        mainImageIndex,
        packageWeightLb,
        packageWeightOz,
        packageLengthIn,
        packageWidthIn,
        packageHeightIn,
        irregularPackage,
      }),
    [
      preflightInputKey,
      sku,
      keywords,
      mainImageIndex,
      packageWeightLb,
      packageWeightOz,
      packageLengthIn,
      packageWidthIn,
      packageHeightIn,
      irregularPackage,
    ]
  );

  const missingRequirements = useMemo(() => {
    const missingBasics: string[] = [];
    const missingPolicies: string[] = [];
    const missingAspects: string[] = [];

    if (!title.trim()) missingBasics.push('Title');
    if (!description.trim()) missingBasics.push('Description');
    if (!category?.id) missingBasics.push('Category');

    const priceNum = parseFloat(price || '0');
    if (!Number.isFinite(priceNum) || priceNum <= 0) missingBasics.push('Price');

    if (!images.length) missingBasics.push('Photos');

    const requiresCondition = !!category?.id && conditionRequired;

    const conditionIdNum = Number.parseInt(String(conditionId || '').trim() || '0', 10);
    if (requiresCondition && !String(conditionId || '').trim()) {
      missingBasics.push('Condition');
    }

    if (!String(ebayPaymentPolicyId || '').trim()) missingPolicies.push('Payment policy');
    if (!String(ebayReturnPolicyId || '').trim()) missingPolicies.push('Return policy');
    if (!String(ebayFulfillmentPolicyId || '').trim()) missingPolicies.push('Shipping policy');

    const hasValue = (v: any) => {
      if (Array.isArray(v)) return v.some((x) => String(x ?? '').trim().length > 0);
      return String(v ?? '').trim().length > 0;
    };

    const requiredSpecifics = (specifics || []).filter((s) => !!s?.required);
    if (category?.id && requiredSpecifics.length) {
      for (const s of requiredSpecifics) {
        if (!hasValue((s as any).value)) missingAspects.push(String((s as any).name || '').trim());
      }
    }

    const totalMissingCount = missingBasics.length + missingPolicies.length + missingAspects.length;

    return { missingBasics, missingPolicies, missingAspects, totalMissingCount };
  }, [
    title,
    description,
    category?.id,
    price,
    images,
    conditionRequired,
    conditionId,
    conditionDescription,
    ebayPaymentPolicyId,
    ebayReturnPolicyId,
    ebayFulfillmentPolicyId,
    specifics,
  ]);

  useEffect(() => {
    if (missingRequirements.totalMissingCount === 0) {
      setHighlightMissing(false);
    }
  }, [missingRequirements.totalMissingCount]);

  const lastUiErrorClearKeyRef = useRef<string>('');

  useEffect(() => {
    if (!uiError) {
      lastUiErrorClearKeyRef.current = preflightInputKey;
      return;
    }

    if (missingRequirements.totalMissingCount <= 0) {
      lastUiErrorClearKeyRef.current = preflightInputKey;
      return;
    }

    if (lastUiErrorClearKeyRef.current && lastUiErrorClearKeyRef.current !== preflightInputKey) {
      setUiError(null);
    }

    lastUiErrorClearKeyRef.current = preflightInputKey;
  }, [preflightInputKey, missingRequirements.totalMissingCount, uiError]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      if (publishing || preflightLoading || savingDraft) return;

      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, publishing, preflightLoading, savingDraft]);

  useEffect(() => {
    if (preflightPassed !== true) return;
    if (!lastPreflightInputKeyRef.current) return;
    if (lastPreflightInputKeyRef.current === preflightInputKey) return;

    setPreflightPassed(false);
    setPreflightMessage(null);
    setLastPreflightCode(null);
  }, [preflightInputKey, preflightPassed]);

  const buildListingJson = useCallback(() => {
    const categoryPath = getCategoryPathString(category);
    const orderedImages = images.length
      ? [images[mainImageIndex], ...images.filter((_, idx) => idx !== mainImageIndex)].filter(Boolean)
      : [];

    return {
      title: title.trim(),
      sku: sku.trim(),
      description: description.trim(),
      marketplace: 'ebay',
      category: category ? { id: category.id, name: category.name, path: categoryPath, breadcrumbs: category.breadcrumbs } : null,
      category_id: category?.id || null,
       category_path: categoryPath || null,
        condition_intent: conditionIntentRef.current || null,
        condition_id: toIntOrNull(conditionId),
       condition_name: conditionName || null,
       condition_description: (() => {
         const idNum = Number.parseInt(String(conditionId || '').trim() || '0', 10);
         if (!Number.isFinite(idNum) || idNum <= 1499) return null;
         const s = String(conditionDescription || '').trim();
         return s ? s : null;
       })(),
       item_specifics: specifics.map((s) => ({
         name: s.name,
         value: s.value,
         required: !!s.required,
         multi: !!s.multi,
         selectionOnly: !!s.selectionOnly,
         freeTextAllowed: s.freeTextAllowed !== false,
         options: s.options || [],
         allOptions: s.allOptions || undefined,
         type: s.type || undefined,
       })),

      keywords: keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      price_suggestion: { optimal: parseFloat(price || '0') || 0 },
      images: orderedImages,
      mainImageIndex: 0,
    };
  }, [category, images, mainImageIndex, price, specifics, keywords, title, sku, description, conditionId, conditionName, conditionDescription]);

  const assertHostedImagesOrThrow = (arr: string[]) => {
    const bad = (arr || []).filter((u) => !isHostedImageUrl(u));
    if (bad.length) throw new Error('Images must be hosted URLs (Cloudinary). Please go back and re-upload.');
  };

  const disableActions = authLoading || !user?.id || !workspaceId || !internalUserId;

  useEffect(() => {
    return () => {
      if (saveIndicatorTimeoutRef.current != null) {
        clearTimeout(saveIndicatorTimeoutRef.current);
        saveIndicatorTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isDirty) return;

    if (saveIndicatorTimeoutRef.current != null) {
      clearTimeout(saveIndicatorTimeoutRef.current);
      saveIndicatorTimeoutRef.current = null;
    }

    if (saveIndicator !== 'idle') {
      setSaveIndicator('idle');
    }
  }, [isDirty, saveIndicator]);

  const handleManualSaveDraft = async () => {
    if (saveIndicatorTimeoutRef.current != null) {
      clearTimeout(saveIndicatorTimeoutRef.current);
      saveIndicatorTimeoutRef.current = null;
    }

    setSaveIndicator('saving');
    const res = await handleSaveDraft();

    if (res.ok) {
      setSaveIndicator('saved');
      saveIndicatorTimeoutRef.current = window.setTimeout(() => {
        setSaveIndicator('idle');
        saveIndicatorTimeoutRef.current = null;
      }, 2000);
    } else {
      setSaveIndicator('idle');
    }
  };
  // ----------------------------
  // Initial load (run once; gated by auth + tenancy)
  // ----------------------------
  useEffect(() => {
    if (didInitialLoadRef.current) return;
    if (authLoading) return;

    if (!user?.id) {
      setLoading(false);
      setError('Not authenticated. Please log in again.');
      return;
    }

    // Wait until tenancy exists (or can be refreshed).
    if (!workspaceId || !internalUserId) return;

    didInitialLoadRef.current = true;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const t = await ensureTenancy();

        const urlParams = new URLSearchParams(window.location.search);
        const listingIdParam = urlParams.get('listingId');

        if (!listingIdParam) {
          setLoading(false);
          setError('No listing found. Please start from Dashboard.');
          return;
        }

        // Load listing from Supabase (single source of truth)
        {
          const { data, error: readErr } = await withTimeout(
            supabase
              .from('listings')
              .select(
                'id,title,description,category_id,category_path,price,currency,images,listing_json,status,marketplace,updated_at,created_at,' +
                  'ebay_payment_policy_id,ebay_return_policy_id,ebay_fulfillment_policy_id,' +
                  'package_weight_lb,package_weight_oz,package_length_in,package_width_in,package_height_in,irregular_package'
              )
              .eq('id', listingIdParam)
              .eq('workspace_id', t.workspaceId)
              .single(),
            20000,
            'read listing'
          );

          if (readErr) throw readErr;

           const row: any = data || {};
           const lj: any = row.listing_json || {};

            conditionIntentRef.current = String(lj?.condition_intent || '').trim();
            autoSelectConditionKeyRef.current = '';




          setListingId(row.id);

          setTitle((row.title ?? lj.title ?? '') as string);
          setSku(String(lj?.sku ?? ''));
          setDescription((row.description ?? lj.description ?? '') as string);

          const priceVal =
            typeof row.price === 'number'
              ? row.price.toFixed(2)
              : typeof lj?.price_suggestion?.optimal === 'number'
                ? lj.price_suggestion.optimal.toFixed(2)
                : String(lj?.price_suggestion?.optimal ?? '0.00');
          setPrice(priceVal);

          const imgsRaw: string[] = Array.isArray(row.images) ? row.images : Array.isArray(lj.images) ? lj.images : [];
          setImages(sanitizeHostedImages(imgsRaw));
          setMainImageIndex(0);

          const kws =
            Array.isArray(lj.keywords) ? lj.keywords.join(', ') : typeof lj.keywords === 'string' ? lj.keywords : '';
          setKeywords(kws);

          const catFromJson = lj.category || null;
          const cat: CategoryWithPath | null =
            catFromJson && (catFromJson.id || catFromJson.name)
              ? {
                  id: String(catFromJson.id ?? row.category_id ?? ''),
                  name: String(catFromJson.name ?? 'Selected Category'),
                  path: String(catFromJson.path ?? row.category_path ?? ''),
                  breadcrumbs: Array.isArray(catFromJson.breadcrumbs) ? catFromJson.breadcrumbs : undefined,
                }
              : row.category_id
                ? { id: String(row.category_id), name: 'Selected Category', path: String(row.category_path ?? '') }
                : null;

          setCategory(cat);

          const baseSpecs: ItemSpecific[] = Array.isArray(lj.item_specifics) ? lj.item_specifics : [];
          setSpecifics(applySizeTypeFilterToSpecifics(baseSpecs, getCategoryPathString(cat)));

          // Prefill Shipping & Policies from DB row
          setEbayPaymentPolicyId(String(row.ebay_payment_policy_id || ''));
          setEbayReturnPolicyId(String(row.ebay_return_policy_id || ''));
           setEbayFulfillmentPolicyId(String(row.ebay_fulfillment_policy_id || ''));

           setConditionId(String(lj?.condition_id ?? ''));
           setConditionName(String(lj?.condition_name ?? ''));
           setConditionDescription(String(lj?.condition_description ?? ''));
 
           setPackageWeightLb(row.package_weight_lb != null ? String(row.package_weight_lb) : '');

          setPackageWeightOz(row.package_weight_oz != null ? String(row.package_weight_oz) : '');

          setPackageLengthIn(row.package_length_in != null ? String(row.package_length_in) : '');
          setPackageWidthIn(row.package_width_in != null ? String(row.package_width_in) : '');
          setPackageHeightIn(row.package_height_in != null ? String(row.package_height_in) : '');

          setIrregularPackage(!!row.irregular_package);

          setLoading(false);
          return;
        }

        setLoading(false);
      } catch (err: any) {
        console.error('[ResultsPage] load error:', err);
        setError(err?.message || 'Failed to load data');
        setLoading(false);
      }
    };

    void run();
  }, [authLoading, user?.id, workspaceId, internalUserId, ensureTenancy, fetchCategorySpecifics, smartFillSpecifics, navigate]);

  const handleCategorySelect = async (newCategory: CategoryWithPath) => {
    setIsDirty(true);
    setCategory(newCategory);
    setConditionId('');
    setConditionName('');
    setConditionDescription('');
    setShowCategoryModal(false);
    await fetchCategorySpecifics(newCategory.id, getCategoryPathString(newCategory));
  };

  const updateSpecific = (idx: number, value: string | string[]) => {
    setIsDirty(true);
    setSpecifics((prev) => {
      let next = [...prev];
      next[idx] = { ...next[idx], value };

      if (/size type/i.test(next[idx].name || '')) {
        next = applySizeTypeFilterToSpecifics(next, getCategoryPathString(category));
      }
      return next;
    });
  };

  const addSpecific = () => {
    setIsDirty(true);
    setSpecifics((prev) => [...prev, { name: '', value: '' }]);
  };

  const categoryBreadcrumb = useMemo(() => {
    if (!category) return 'No category selected';
    if (category.breadcrumbs && category.breadcrumbs.length) return category.breadcrumbs.join(' > ');
    if (category.path) {
      return category.path
        .split('>')
        .map((p) => p.trim())
        .filter(Boolean)
        .join(' > ');
    }
    return category.name;
  }, [category]);

  const normalizedCategoryPathForSelector =
    (category?.breadcrumbs && category.breadcrumbs.length ? category.breadcrumbs.join(' > ') : '') ||
    (category?.path
      ? category.path
          .split('>')
          .map((p) => p.trim())
          .filter(Boolean)
          .join(' > ')
      : '');

  // ----------------------------
  // Save Draft (NO created_by sent; DB default auth.uid())
  // ----------------------------
  const handleSaveDraft = async (
    opts?: { silent?: boolean }
  ): Promise<
    | { ok: true; listingId: string }
    | { ok: false; errorMessage: string }
  > => {
    const silent = !!(opts as any)?.silent;

    if (!silent) {
      setSaveError(null);
      setDraftStatus('');
      setDraftSavedSuccessfully(false);
      setUiError(null);
    }

    setSavingDraft(true);
 
    try {
      const t = await ensureTenancy();
      const listingData = buildListingJson();

      const orderedImages: string[] = Array.isArray((listingData as any).images) ? (listingData as any).images : [];
      assertHostedImagesOrThrow(orderedImages);

      const categoryPath = listingData.category_path || '';
      const priceNum = Number(listingData.price_suggestion?.optimal ?? 0) || 0;

      const payload: any = {
        workspace_id: t.workspaceId,
        status: 'draft',
        marketplace: 'ebay',
        title: listingData.title || 'Untitled Listing',
        description: listingData.description || '',
        category_id: listingData.category_id ? String(listingData.category_id) : null,
        category_path: categoryPath || null,
        price: priceNum,
        currency: 'USD',
        images: orderedImages,
        listing_json: {
          ...listingData,
          internal_user_id: t.internalUserId,
        },

        // Per-listing Shipping & Policies columns
        ebay_payment_policy_id: ebayPaymentPolicyId || null,
        ebay_return_policy_id: ebayReturnPolicyId || null,
        ebay_fulfillment_policy_id: ebayFulfillmentPolicyId || null,

        package_weight_lb: toIntOrNull(packageWeightLb),
        package_weight_oz: toIntOrNull(packageWeightOz),

        package_length_in: toNumOrNull(packageLengthIn),
        package_width_in: toNumOrNull(packageWidthIn),
        package_height_in: toNumOrNull(packageHeightIn),

        irregular_package: !!irregularPackage,
      };

      let savedId = listingId;

      if (!listingId) {
        const { data, error: insertErr } = await withTimeout(
          supabase.from('listings').insert(payload).select('id').single(),
          20000,
          'insert draft'
        );
        if (insertErr) throw insertErr;
        savedId = (data as any)?.id;
      } else {
        const { data, error: updateErr } = await withTimeout(
          supabase
            .from('listings')
            .update(payload)
            .eq('id', listingId)
            .eq('workspace_id', t.workspaceId)
            .select('id')
            .single(),
          20000,
          'update draft'
        );
        if (updateErr) throw updateErr;
        savedId = (data as any)?.id ?? listingId;
      }

      if (!savedId) throw new Error('Draft saved but no id was returned');

      setListingId(savedId);

      if (!silent) {
        setDraftStatus('Draft saved.');
        setDraftSavedSuccessfully(true);
        setUiError(null);
      }

      setIsDirty(false);
      setAutosaveStatus('saved');
      setLastSavedAt(Date.now());
      setAutosaveErrorMessage(null);
      lastAutosaveResultKeyRef.current = autosaveKey;

      const url = new URL(window.location.href);
      url.searchParams.set('mode', 'edit');
      url.searchParams.set('listingId', savedId);
      window.history.replaceState({}, '', url.toString());

      return { ok: true, listingId: String(savedId) };
    } catch (err: any) {
      console.error('[Draft] save failed:', err);

      if (!silent) {
        setDraftSavedSuccessfully(false);
        setSaveError(null);

        if (isNetworkLikeError(err)) {
          setUiError({
            title: 'Network error',
            message: 'Failed to reach server. Check connection and try again.',
          });
        } else {
          const msg = String(err?.message || '').trim();
          setUiError({
            title: 'Save failed',
            message: msg || 'Failed to save draft. Please try again.',
            status: typeof err?.status === 'number' ? err.status : undefined,
          });
        }

        setDraftStatus('');
      }

      if (silent) {
        setAutosaveStatus('error');
        setAutosaveErrorMessage(
          isNetworkLikeError(err)
            ? 'Failed to reach server. Check connection and try again.'
            : String(err?.message || '').trim() || 'Failed to save draft. Please try again.'
        );
        lastAutosaveResultKeyRef.current = autosaveKey;
      }

      const msg = isNetworkLikeError(err)
        ? 'Failed to reach server. Check connection and try again.'
        : String(err?.message || '').trim() || 'Failed to save draft. Please try again.';

      return { ok: false, errorMessage: msg };
    } finally {
      setSavingDraft(false);
    }
  };

  useEffect(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    if (!isDirty) return;
    if (publishing || preflightLoading || savingDraft) return;
    if (disableActions) return;

    // New meaningful change: clear previous autosave result.
    if (lastAutosaveResultKeyRef.current && lastAutosaveResultKeyRef.current !== autosaveKey) {
      if (autosaveStatus === 'saved' || autosaveStatus === 'error') {
        setAutosaveStatus('idle');
      }
    }

    autosaveTimerRef.current = setTimeout(async () => {
      if (!isDirty) return;
      if (publishing || preflightLoading || savingDraft) return;
      if (disableActions) return;

      setAutosaveStatus('saving');

      if (saveIndicatorTimeoutRef.current != null) {
        clearTimeout(saveIndicatorTimeoutRef.current);
        saveIndicatorTimeoutRef.current = null;
      }
      setSaveIndicator('saving');

      const keyAtRun = autosaveKey;
      const res = await handleSaveDraft({ silent: true });
      if (res.ok) {
        setAutosaveStatus('saved');
        setLastSavedAt(Date.now());
        setAutosaveErrorMessage(null);

        setSaveIndicator('saved');
        saveIndicatorTimeoutRef.current = window.setTimeout(() => {
          setSaveIndicator('idle');
          saveIndicatorTimeoutRef.current = null;
        }, 2000);
      } else {
        setAutosaveStatus('error');
        setAutosaveErrorMessage(res.errorMessage || 'Autosave failed');
        setSaveIndicator('idle');
      }

      lastAutosaveResultKeyRef.current = keyAtRun;
    }, 3000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [autosaveKey, isDirty, publishing, preflightLoading, savingDraft, disableActions, autosaveStatus]);
 
  // ----------------------------
  // Publish
  // ----------------------------
  const validateBeforePublish = (): string[] => {
    const errors: string[] = [];

    if (!title.trim()) errors.push('Title is required.');
    if (!description.trim()) errors.push('Description is required.');
    if (!category?.id) errors.push('Category is required.');

    const priceNum = parseFloat(price || '0');
    if (!Number.isFinite(priceNum) || priceNum <= 0) errors.push('Price must be greater than 0.');

    if (!images.length) errors.push('At least one image is required.');

    const paymentPolicyId = String(ebayPaymentPolicyId || '').trim();
    const returnPolicyId = String(ebayReturnPolicyId || '').trim();
    const fulfillmentPolicyId = String(ebayFulfillmentPolicyId || '').trim();

    if (!paymentPolicyId) errors.push('Payment policy ID is required.');
    if (!returnPolicyId) errors.push('Return policy ID is required.');
    if (!fulfillmentPolicyId) errors.push('Fulfillment (shipping) policy ID is required.');

    const requiresCondition = !!category?.id && conditionRequired;
    const conditionIdNum = Number.parseInt(String(conditionId || '').trim() || '0', 10);
    if (requiresCondition && !String(conditionId || '').trim()) {
      errors.push('Condition is required.');
    }


    try {
      const orderedImages = [images[mainImageIndex], ...images.filter((_, idx) => idx !== mainImageIndex)].filter(Boolean);
      assertHostedImagesOrThrow(orderedImages);
    } catch (err: any) {
      errors.push(err?.message || 'Images must be hosted http(s) URLs.');
    }

    return errors;
  };

  const runEbayPreflight = async (listingIdOverride?: string): Promise<boolean> => {
    setPreflightLoading(true);
    setPreflightMessage(null);
    setPreflightPassed(null);
    setLastPreflightCode(null);
    setPublishErrors([]);
    setPublishSuccess(null);
    setEbayReconnectRequired(false);
    setEbayReconnectError(null);

    const listingIdForCall = String(listingIdOverride || listingId || '').trim();

    if (!listingIdForCall) {
      setPublishErrors(['Please click "Save Draft" first (we need a saved Draft ID before running checks).']);
      setPreflightLoading(false);
      setPreflightPassed(false);
      return false;
    }

    try {
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();

      if (sessionErr || !session?.access_token) {
        setPublishErrors(['You are not logged in. Please sign in again and retry.']);
        setPreflightPassed(false);
        return false;
      }

      const res = await fetch('/api/ebay-preflight', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ listing_id: listingIdForCall }),
      });

      const body: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLastPreflightCode(String(body?.code || 'ERROR'));
        setPublishErrors([]);
        setPreflightPassed(false);
        setUiError({
          title: 'eBay checks failed',
          message: extractApiMessage(body) || 'eBay checks failed. Please try again.',
          status: res.status,
          requestId: extractRequestId(body),
          ebayErrorId: extractEbayErrorId(body),
        });
        return false;
      }

      if (body?.ok === true) {
        setLastPreflightCode(String(body?.code || 'OK'));
        lastPreflightInputKeyRef.current = preflightInputKey;
        setPreflightPassed(true);
        setPreflightMessage('Checks passed');

        // Best-effort: persist preflight passed flag on the listing (no errors persisted).
        try {
          if (workspaceId) {
            const nowIso = new Date().toISOString();
            const { data: row } = await supabase
              .from('listings')
              .select('listing_json')
              .eq('id', listingIdForCall)
              .eq('workspace_id', workspaceId)
              .maybeSingle();

            const existing = (row as any)?.listing_json || {};
            const next = {
              ...(existing || {}),
              preflight_passed: true,
              preflight_passed_at: nowIso,
            };

            await supabase
              .from('listings')
              .update({ listing_json: next })
              .eq('id', listingIdForCall)
              .eq('workspace_id', workspaceId);
          }
        } catch {
          // ignore persistence failure
        }

        return true;
      }

      if (body?.code === 'NOT_CONNECTED') {
        setLastPreflightCode('NOT_CONNECTED');
        setEbayReconnectRequired(true);
        setEbayReconnectError('eBay not connected/expired. Reconnect to continue.');
        setPreflightPassed(false);
        return false;
      }

      if (body?.code === 'VALIDATION_ERROR' || body?.code === 'PREFLIGHT_FAILED') {
        setLastPreflightCode(String(body?.code || 'PREFLIGHT_FAILED'));
        setPublishErrors([]);
        setPreflightPassed(false);
        setUiError({
          title: 'eBay checks failed',
          message: extractApiMessage(body) || 'eBay checks failed. Please review and try again.',
          requestId: extractRequestId(body),
          ebayErrorId: extractEbayErrorId(body),
        });
        return false;
      }

      setLastPreflightCode(String(body?.code || 'UNEXPECTED'));
      setPublishErrors([]);
      setPreflightPassed(false);
      setUiError({
        title: 'eBay checks failed',
        message: extractApiMessage(body) || 'eBay checks failed. Please try again.',
        requestId: extractRequestId(body),
        ebayErrorId: extractEbayErrorId(body),
      });
      return false;
    } catch (err: any) {
      setPublishErrors([]);
      setPreflightPassed(false);

      if (isNetworkLikeError(err)) {
        setUiError({
          title: 'Network error',
          message: 'Failed to reach server. Check connection and try again.',
        });
      } else {
        const msg = String(err?.message || '').trim();
        setUiError({
          title: 'eBay checks failed',
          message: msg || 'Failed to run eBay checks. Please try again.',
        });
      }

      return false;
    } finally {
      setPreflightLoading(false);
    }
  };

  const handleReconnectEbay = async () => {
    setEbayReconnectLoading(true);
    setEbayReconnectError(null);

    try {
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();

      if (sessionErr || !session?.access_token) {
        setEbayReconnectError('You are not logged in. Please sign in again and retry.');
        return;
      }

      if (!workspaceId) {
        setEbayReconnectError('Workspace not ready yet. Try again in a moment.');
        return;
      }

      const res = await fetch('/api/ebay-oauth-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          return_to: window.location.href,
        }),
      });

      const data = await res.json().catch(() => ({}));
      const oauthUrl = data?.oauthUrl || data?.url;

      if (!res.ok || !oauthUrl) {
        setEbayReconnectError(data?.error || 'Failed to start eBay OAuth.');
        return;
      }

      window.location.href = String(oauthUrl);
    } finally {
      setEbayReconnectLoading(false);
    }
  };

  const handlePublish = async () => {
    setShowTitleInlineError(true);
    setHighlightMissing(false);
    setLastPublishCode(null);
    setPublishErrors([]);
    setPublishSuccess(null);
    setEbayReconnectRequired(false);
    setEbayReconnectError(null);
    setUiError(null);
 
    const clientErrors = validateBeforePublish();
    if (clientErrors.length) {
      setUiError(null);
      setPublishErrors(clientErrors);


      // Focus/scroll first invalid field (Title first)
      if (!title.trim()) {
        titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        titleInputRef.current?.focus();
        return;
      }

      if (!description.trim()) {
        descriptionInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        descriptionInputRef.current?.focus();
        return;
      }

      return;
    }

    const saveRes = await handleSaveDraft({ silent: true });
    if (!saveRes.ok) {
      setUiError({
        title: 'Save failed',
        message: saveRes.errorMessage || 'Failed to save draft. Please try again.',
      });
      return;
    }

    const savedListingId = String(saveRes.listingId || '').trim();
    if (!savedListingId) {
      setUiError({
        title: 'Save failed',
        message: 'Draft saved but no id was returned. Please try again.',
      });
      return;
    }

    if (savedListingId !== listingId) {
      setListingId(savedListingId);
    }

    const preflightOk = await runEbayPreflight(savedListingId);
    if (!preflightOk) return;
 
    setPublishing(true);

    try {
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();

      if (sessionErr || !session?.access_token) {
        setPublishErrors(['You are not logged in. Please sign in again and retry.']);
        return;
      }

      const res = await fetch('/api/publish-listing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ listing_id: savedListingId }),
      });

      let body: any = {};
      try {
        body = await res.json();
      } catch {
        body = {};
      }

      if (body?.code === 'EBAY_RECONNECT_REQUIRED' && res.status === 401) {
        setLastPublishCode('EBAY_RECONNECT_REQUIRED');
        setPublishing(false);
        setEbayReconnectRequired(true);
        setPublishErrors([]);
        setPublishSuccess(null);
        return;
      }

      if (body?.code === 'EBAY_RECONNECT_REQUIRED') {
        setLastPublishCode('EBAY_RECONNECT_REQUIRED');
        setPublishing(false);
        setEbayReconnectRequired(true);
        setPublishErrors([]);
        setPublishSuccess(null);
        return;
      }

      if (body?.code === 'EBAY_LISTING_FIX_REQUIRED') {
        setLastPublishCode('EBAY_LISTING_FIX_REQUIRED');
        setPublishing(false);
        setEbayReconnectRequired(false);
        setPublishSuccess(null);

        const errs = Array.isArray(body?.errors) ? body.errors : [];
        if (errs.length) {
          setPublishErrors(['Fix the listing details below before publishing.', ...errs.map((e: any) => String(e))]);
        } else {
          setPublishErrors(['Fix the listing details below before publishing.']);
        }
        return;
      }

      if (body?.code === 'EBAY_ACCOUNT_SETUP_REQUIRED') {
        setLastPublishCode('EBAY_ACCOUNT_SETUP_REQUIRED');
        setPublishing(false);
        setEbayReconnectRequired(false);
        setPublishSuccess(null);
        setPublishErrors([
          'Your eBay account requires additional setup before you can publish.',
          'This usually means shipping, payments, or business policies are not fully configured.',
        ]);
        return;
      }

      if (body?.code === 'EBAY_RETRYABLE_ERROR') {
        setLastPublishCode('EBAY_RETRYABLE_ERROR');
        setPublishing(false);
        setEbayReconnectRequired(false);
        setPublishSuccess(null);
        setPublishErrors(['Temporary eBay issue. Please try again in a few minutes.']);
        return;
      }

      if (res.ok && body?.ok === true) {
        setLastPublishCode(String(body?.code || 'OK'));
        setPublishErrors([]);
        setPublishSuccess({
          ebay_item_id: body?.ebay_item_id != null ? String(body.ebay_item_id) : null,
          ebay_listing_url: body?.ebay_listing_url != null ? String(body.ebay_listing_url) : null,
        });
        setIsDirty(false);
        setUiError(null);
        setPublishErrors([]);
        setHighlightMissing(false);
        setShowTitleInlineError(false);
        navigate('/dashboard');
        return;
      }

      if (res.status === 409 || body?.code === 'PUBLISH_IN_PROGRESS') {
        setPublishErrors([]);
        setUiError({
          title: 'Publish failed',
          message: 'Publishing in progress. Please wait and try again.',
          status: res.status,
          requestId: extractRequestId(body),
          ebayErrorId: extractEbayErrorId(body),
        });
        return;
      }

      const apiMsg = extractApiMessage(body);

      if (Array.isArray(body?.errors) && body.errors.length) {
        setPublishErrors([]);
        setUiError({
          title: 'Publish failed',
          message: apiMsg || String(body.errors[0] || '').trim() || 'Publishing failed. Please try again.',
          status: res.status,
          requestId: extractRequestId(body),
          ebayErrorId: extractEbayErrorId(body),
        });
        return;
      }

      setPublishErrors([]);
      setUiError({
        title: 'Publish failed',
        message: apiMsg || 'Publishing failed. Please try again.',
        status: res.status,
        requestId: extractRequestId(body),
        ebayErrorId: extractEbayErrorId(body),
      });
    } catch (err: any) {
      setPublishErrors([]);

      if (isNetworkLikeError(err)) {
        setUiError({
          title: 'Network error',
          message: 'Failed to reach server. Check connection and try again.',
        });
      } else {
        setUiError({
          title: 'Publish failed',
          message: 'Publishing failed. Please try again.',
        });
      }
    } finally {
      setPublishing(false);
    }
  };

  // ----------------------------
  // Render
  // ----------------------------
  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h2>Loading listing data...</h2>
      </div>
    );
  }

  if (error) {
    const noListing = /no listing found/i.test(error);
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h2 style={{ color: noListing ? '#111827' : 'red' }}>{error}</h2>
        <button onClick={() => navigate(noListing ? '/dashboard' : '/create-listing')}>{noListing ? 'Go to Dashboard' : 'Go Back'}</button>
      </div>
    );
  }

   return (
     <div className="results-page results-layout">
        <main className="results-main" style={{ minWidth: 0 }}>
        <h1>Generated Listing</h1>

        <section
          ref={photosSectionRef as any}
          style={{
            marginTop: 16,
            borderRadius: 6,
            boxShadow: highlightMissing && missingRequirements.missingBasics.includes('Photos') ? '0 0 0 2px #ef4444' : undefined,
          }}
        >
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
              <img src={mainImageUrl} alt="Main" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ color: '#999' }}>No image</div>
            )}
          </div>

          {images.length > 1 && (
            <div className="results-thumbs" style={{ marginTop: 8 }}>
              {images.map((img, idx) => (
                <div
                  key={idx}
                  draggable
                  onClick={() => {
                    setIsDirty(true);
                    setMainImageIndex(idx);
                  }}
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

                    setIsDirty(true);
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
                  <img src={img} alt={`thumb-${idx}`} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Title</h3>
          <input
            ref={titleInputRef}
            className="results-title-input"
            placeholder="Enter title..."
            value={title}
            onChange={(e) => {
              setIsDirty(true);
              setTitle(e.target.value);
            }}
              style={{
                width: '100%',
                padding: '8px 12px',
                marginTop: 8,
                fontSize: 14,
                borderRadius: 6,
                boxSizing: 'border-box',
               border:
                 highlightMissing && missingRequirements.missingBasics.includes('Title')
                   ? '1px solid #ef4444'
                   : showTitleInlineError && !title.trim()
                     ? '1px solid #ef4444'
                     : '1px solid #d1d5db',
               background:
                 highlightMissing && missingRequirements.missingBasics.includes('Title') ? '#fff7f7' : 'white',
               outline: 'none',
            }}
            maxLength={80}
          />
          {showTitleInlineError && !title.trim() ? (
            <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>Title is required.</div>
          ) : null}
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, textAlign: 'right' }}>{title.length}/80 characters</div>
        </section>

        <section style={{ marginTop: 24 }}>
          <div className="results-sku-row">
            <h4 style={{ margin: 0 }}>SKU</h4>
            <input
              placeholder="Enter SKU..."
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="results-sku-input"
              style={{ padding: 12, fontSize: 14 }}
            />
          </div>
        </section>

        <section
          ref={categorySectionRef as any}
          style={{
            marginTop: 24,
            borderRadius: 6,
            boxShadow: highlightMissing && missingRequirements.missingBasics.includes('Category') ? '0 0 0 2px #ef4444' : undefined,
          }}
        >
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

        {category?.id && conditionRequired ? (
          <section ref={conditionSectionRef as any} style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <h3 style={{ margin: 0 }}>Condition</h3>
              {conditionsLoading ? <span style={{ fontSize: 12, color: '#666' }}>Loading…</span> : null}
            </div>

            {(() => {
              const shouldHighlight = highlightMissing || showTitleInlineError;
              const isConditionMissing = !String(conditionId || '').trim();

              const options: { id: string; label: string }[] = (conditionOptions || []).map((c) => ({
                id: String(c.conditionId),
                label: String(c.conditionName),
              }));

              const selectedId = String(conditionId || '').trim();
              const conditionIdNum = Number.parseInt(selectedId || '0', 10);
              const needsDescription = Number.isFinite(conditionIdNum) && conditionIdNum > 1499;

              return (
                <div style={{ marginTop: 10 }}>
                  <select
                    ref={conditionSelectRef}
                    id="condition_id"
                    value={selectedId}
                    onChange={(e) => {
                      const nextId = String(e.target.value || '').trim();
                      const opt = options.find((o) => o.id === nextId) || null;
                      const nextNum = Number.parseInt(nextId || '0', 10);

                      setIsDirty(true);
                      setConditionId(nextId);
                      setConditionName(opt?.label || '');

                      if (!(Number.isFinite(nextNum) && nextNum > 1499)) {
                        setConditionDescription('');
                      }
                    }}
                    style={{
                      width: '100%',
                      maxWidth: 520,
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: shouldHighlight && isConditionMissing ? '1px solid #ef4444' : '1px solid #d1d5db',
                      background: 'white',
                      fontSize: 14,
                    }}
                  >
                    <option value="">Select…</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  {needsDescription ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Condition description</div>
                      <textarea
                        ref={conditionDescriptionRef}
                        id="condition_description"
                        value={conditionDescription}
                        onChange={(e) => {
                          setIsDirty(true);
                          setConditionDescription(e.target.value);
                        }}
                        rows={2}
                        style={{
                          width: '100%',
                          maxWidth: 520,
                          padding: 10,
                          borderRadius: 6,
                          border: '1px solid #d1d5db',
                          fontSize: 14,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </section>
        ) : null}

        <section ref={specificsSectionRef as any} style={{ marginTop: 24 }}>

          <h3>
            Item Specifics {loadingSpecifics && <span style={{ fontSize: 14, color: '#666' }}>(Loading…)</span>}
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
                {(() => {
                  const shouldHighlight = highlightMissing || showTitleInlineError;
                  const value = (spec as any)?.value;
                  const isMissing = Array.isArray(value)
                    ? value.filter((v: any) => String(v ?? '').trim().length > 0).length === 0
                    : String(value ?? '').trim().length === 0;
                  const hasError = shouldHighlight && !!(spec as any)?.required && isMissing;

                  return <ItemSpecificControl spec={spec} hasError={hasError} onChange={(val) => updateSpecific(i, val)} />;
                })()}
              </div>
            ))}
          </div>

          <button type="button" onClick={addSpecific} style={{ marginTop: 12, padding: '8px 16px', fontSize: 14 }}>
            + Add Custom Specific
          </button>
        </section>

        <section
          style={{
            marginTop: 24,
            borderRadius: 6,
            boxShadow: highlightMissing && missingRequirements.missingBasics.includes('Description') ? '0 0 0 2px #ef4444' : undefined,
          }}
        >
          <h3>Description</h3>
<textarea
  ref={descriptionInputRef}
  placeholder="Enter description..."
  className="results-description-textarea"
  value={description}
  onChange={(e) => {
    setIsDirty(true);
    setDescription(e.target.value);
  }}
  rows={2}
            style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Keywords</h3>
          <input
            placeholder="e.g., vintage, designer, rare"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        <section
          ref={priceSectionRef as any}
          style={{
            marginTop: 24,
            borderRadius: 6,
            boxShadow: highlightMissing && missingRequirements.missingBasics.includes('Price') ? '0 0 0 2px #ef4444' : undefined,
          }}
          >
          <h3>Price</h3>
          <input
            type="number"
            step="0.01"
             value={price}
             onChange={(e) => {
               setIsDirty(true);
               setPrice(e.target.value);
             }}

            className="results-price-input"
            style={{ padding: 12, marginTop: 8, fontSize: 14 }}
          />
        </section>

        {/* Shipping & Policies */}
        <section
          ref={policiesSectionRef as any}
          style={{
            marginTop: 24,
            borderTop: '1px solid #eee',
            paddingTop: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ margin: 0 }}>Shipping & Policies</h3>

            <button
              type="button"
              onClick={() => workspaceId && fetchPolicyLists(workspaceId)}
              disabled={policyLoading || !workspaceId}
              style={{
                padding: '8px 12px',
                background: policyLoading ? '#999' : '#f3f4f6',
                border: '1px solid #ddd',
                borderRadius: 6,
                cursor: policyLoading ? 'default' : 'pointer',
                fontSize: 12,
              }}
              title="Reload policy lists from eBay (if eligible)"
            >
              {policyLoading ? 'Loading…' : 'Reload policies'}
            </button>
          </div>

          {policyError ? <div style={{ marginTop: 10, color: '#b45309', fontSize: 13 }}>{policyError}</div> : null}

          {!paymentPolicies.length && !returnPolicies.length && !fulfillmentPolicies.length ? (
            <div style={{ marginTop: 10, fontSize: 13, color: '#666' }}>
              Policy lists are not available for this account (or could not be fetched). You can still paste policy IDs below.
            </div>
          ) : null}

          {/* Row 1: Shipping policy + package + irregular */}
          <div className="results-policy-row1" style={{ marginTop: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Shipping policy</label>
              {fulfillmentPolicies.length > 0 ? (
                <select
                  value={ebayFulfillmentPolicyId}
                  onChange={(e) => {
                    setIsDirty(true);
                    setEbayFulfillmentPolicyId(e.target.value);
                  }}
                  disabled={policyLoading}
                  style={{
                    width: '100%',
                    padding: 10,
                    border: highlightMissing && !String(ebayFulfillmentPolicyId || '').trim() ? '1px solid #ef4444' : undefined,
                    borderRadius: 6,
                  }}
                >
                  <option value="">Select…</option>
                  {fulfillmentPolicies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={ebayFulfillmentPolicyId}
                  onChange={(e) => {
                    setIsDirty(true);
                    setEbayFulfillmentPolicyId(e.target.value);
                  }}
                  placeholder="Enter shipping policy ID"
                  style={{
                    width: '100%',
                    padding: 10,
                    border: highlightMissing && !String(ebayFulfillmentPolicyId || '').trim() ? '1px solid #ef4444' : undefined,
                    borderRadius: 6,
                  }}
                />
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Package weight (optional)</label>
              <div className="results-subgrid-2">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    value={packageWeightLb}
                    onChange={(e) => {
                    setIsDirty(true);
                    setPackageWeightLb(e.target.value);
                  }}
                    inputMode="numeric"
                    placeholder="0"
                    style={{ width: '100%', padding: 10 }}
                  />
                  <span style={{ fontSize: 12, color: '#666' }}>lb</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    value={packageWeightOz}
                    onChange={(e) => {
                    setIsDirty(true);
                    setPackageWeightOz(e.target.value);
                  }}
                    inputMode="numeric"
                    placeholder="0–15"
                    style={{ width: '100%', padding: 10 }}
                  />
                  <span style={{ fontSize: 12, color: '#666' }}>oz</span>
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Package dimensions (optional)</label>
              <div className="results-subgrid-3">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    value={packageLengthIn}
                    onChange={(e) => {
                      setIsDirty(true);
                      setPackageLengthIn(e.target.value);
                    }}
                    inputMode="decimal"
                    placeholder="0"
                    style={{ width: '100%', padding: 10 }}
                  />
                  <span style={{ fontSize: 12, color: '#666' }}>in</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    value={packageWidthIn}
                    onChange={(e) => {
                      setIsDirty(true);
                      setPackageWidthIn(e.target.value);
                    }}
                    inputMode="decimal"
                    placeholder="0"
                    style={{ width: '100%', padding: 10 }}
                  />
                  <span style={{ fontSize: 12, color: '#666' }}>in</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    value={packageHeightIn}
                    onChange={(e) => {
                      setIsDirty(true);
                      setPackageHeightIn(e.target.value);
                    }}
                    inputMode="decimal"
                    placeholder="0"
                    style={{ width: '100%', padding: 10 }}
                  />
                  <span style={{ fontSize: 12, color: '#666' }}>in</span>
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Irregular package</label>
              {missingRequirements.totalMissingCount > 0 ? (
              <div style={{ display: 'flex', border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
             <button
               type="button"
               className="results-highlight-btn"
               onClick={() => {
                  setUiError(null);
                  setHighlightMissing(true);
 
 
                 const missingBasics = missingRequirements.missingBasics;
                const missingPolicies = missingRequirements.missingPolicies;
                const missingAspects = missingRequirements.missingAspects;

                if (missingBasics.includes('Title')) {
                  titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  titleInputRef.current?.focus();
                  return;
                }

                if (missingBasics.includes('Description')) {
                  descriptionInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  descriptionInputRef.current?.focus();
                  return;
                }

                if (missingBasics.includes('Category')) {
                  categorySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return;
                }

                if (missingBasics.includes('Condition')) {
                  conditionSelectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  conditionSelectRef.current?.focus();
                  return;
                }



                if (missingBasics.includes('Price')) {
                  priceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return;
                }

                if (missingBasics.includes('Photos')) {
                  photosSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return;
                }

                if (missingPolicies.length) {
                  policiesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return;
                }

                if (missingAspects.length) {
                  specificsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return;
                }
              }}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #ef4444',
                background: '#fff',
                color: '#991b1b',
                cursor: 'pointer',
                fontWeight: 700,
                whiteSpace: 'normal',
                fontSize: 14,
              }}
            >
              Highlight missing fields
            </button>
          </div>
        ) : null}

            </div>
          </div>

        </section>

          <div className="results-action-bar" style={{ marginTop: 32, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={handleManualSaveDraft}
              disabled={disableActions || publishing || preflightLoading || savingDraft}
              className="results-action-btn"
              style={{
                padding: '12px 24px',
                background: disableActions || publishing || preflightLoading || savingDraft ? '#999' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: disableActions || publishing || preflightLoading || savingDraft ? 'default' : 'pointer',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              Save Draft
            </button>

            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing || preflightLoading || savingDraft || disableActions}
              className="results-action-btn"
              style={{
                padding: '12px 32px',
                background: publishing || preflightLoading || savingDraft || disableActions ? '#999' : '#0064d2',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: publishing || preflightLoading || savingDraft || disableActions ? 'default' : 'pointer',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              {publishing || preflightLoading ? 'Publishing…' : 'Publish'}
            </button>

            {draftSavedSuccessfully ? (

              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="results-action-btn"
                style={{
                  padding: '12px 24px',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                Go to Dashboard
              </button>
            ) : null}

             <button
               type="button"
               onClick={() => navigate('/create-listing')}
               className="results-action-btn"
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

            <span
              className="results-action-status"
              style={{
                minWidth: 80,
                fontSize: 13,
                color: saveIndicator === 'saved' ? '#166534' : '#6b7280',
                fontWeight: saveIndicator === 'saved' ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {saveIndicator === 'saving' ? 'Saving…' : saveIndicator === 'saved' ? '✓ Saved' : ''}
            </span>
 
         </div>



        {uiError ? (
          <div
            style={{
              marginTop: 12,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              borderRadius: 8,
              padding: 12,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{uiError.title}</div>
              <div style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{uiError.message}</div>
              {uiError.requestId || uiError.ebayErrorId ? (
                <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280', overflowWrap: 'anywhere' }}>
                  {uiError.requestId ? <div>Request ID: {uiError.requestId}</div> : null}
                  {uiError.ebayErrorId ? <div>eBay Error ID: {uiError.ebayErrorId}</div> : null}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setUiError(null)}
              className="results-action-btn"
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #ef4444',
                background: '#fff',
                color: '#991b1b',
                cursor: 'pointer',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                fontSize: 14,
              }}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {preflightPassed === true ? (

          <div
            style={{
              marginTop: 12,
              border: '1px solid #bbf7d0',
              background: '#f0fdf4',
              color: '#166534',
              borderRadius: 6,
              padding: 10,
              fontSize: 14,
            }}
          >
            {preflightMessage || 'Checks passed'}
          </div>
        ) : null}

        {publishSuccess ? (
          <div
            style={{
              marginTop: 12,
              border: '1px solid #bbf7d0',
              background: '#f0fdf4',
              color: '#166534',
              borderRadius: 6,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Published successfully</div>
            {publishSuccess.ebay_item_id ? <div style={{ fontSize: 14 }}>eBay item id: {publishSuccess.ebay_item_id}</div> : null}
            {publishSuccess.ebay_listing_url ? (
              <div style={{ fontSize: 14, marginTop: 4 }}>
                <a href={publishSuccess.ebay_listing_url} target="_blank" rel="noreferrer" style={{ color: '#166534', textDecoration: 'underline' }}>
                  View on eBay
                </a>
              </div>
            ) : null}
          </div>
        ) : null}

        {ebayReconnectRequired ? (
          <div
            style={{
              marginTop: 12,
              border: '1px solid #fde68a',
              background: '#fffbeb',
              color: '#92400e',
              borderRadius: 6,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Your eBay connection expired. Reconnect to continue.</div>
            {ebayReconnectError ? <div style={{ fontSize: 14, marginBottom: 10 }}>{ebayReconnectError}</div> : null}
            <button
              type="button"
              onClick={handleReconnectEbay}
              disabled={ebayReconnectLoading}
              style={{
                padding: '12px 20px',
                background: ebayReconnectLoading ? '#999' : '#0064d2',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: ebayReconnectLoading ? 'default' : 'pointer',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              {ebayReconnectLoading ? 'Redirecting…' : 'Reconnect eBay'}
            </button>
          </div>
        ) : null}

        {publishErrors.length ? (
          <div
            style={{
              marginTop: 12,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              borderRadius: 6,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Fix these before publishing:</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {publishErrors.map((e, idx) => (
                <li key={idx}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {saveError ? (
          <div
            style={{
              marginTop: 12,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              borderRadius: 6,
              padding: 12,
              fontSize: 14,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Save Draft failed:</div>
            <div>{saveError}</div>
          </div>
        ) : null}

        {draftStatus ? (
          <div style={{ marginTop: 8, fontSize: 14, color: draftStatus.toLowerCase().includes('fail') ? 'red' : '#2f855a' }}>
            {draftStatus}
          </div>
        ) : null}
      </main>

       <aside className="results-aside">
         <div className="results-aside-panel" style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
           {(() => {
             const priceNum = parseFloat(price || '0');
             const basicsOk =
               !!title.trim() &&
               !!description.trim() &&
               !!category?.id &&
               Number.isFinite(priceNum) &&
               priceNum > 0 &&
               images.length > 0 &&
               (() => {
                 try {
                   const orderedImages = [images[mainImageIndex], ...images.filter((_, idx) => idx !== mainImageIndex)].filter(Boolean);
                   assertHostedImagesOrThrow(orderedImages);
                   return true;
                 } catch {
                   return false;
                 }
               })();

             const policiesOk =
               !!String(ebayPaymentPolicyId || '').trim() &&
               !!String(ebayReturnPolicyId || '').trim() &&
               !!String(ebayFulfillmentPolicyId || '').trim();

             const ebayConnectedOk = !(lastPreflightCode === 'NOT_CONNECTED' || lastPublishCode === 'EBAY_RECONNECT_REQUIRED');
             const checksOk = preflightPassed === true;
             const accountOk = lastPublishCode !== 'EBAY_ACCOUNT_SETUP_REQUIRED';
             const ready = basicsOk && policiesOk && ebayConnectedOk && checksOk && accountOk;

             const Item = ({
               ok,
               title,
               help,
             }: {
               ok: boolean;
               title: string;
               help: string;
             }) => (
               <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10 }}>
                 <div
                   style={{
                     width: 10,
                     height: 10,
                     borderRadius: 999,
                     marginTop: 4,
                     background: ok ? '#16a34a' : '#dc2626',
                     flex: '0 0 auto',
                   }}
                 />
                 <div>
                   <div style={{ fontSize: 13, fontWeight: 600, color: ok ? '#166534' : '#991b1b' }}>{title}</div>
                   {!ok ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{help}</div> : null}
                 </div>
               </div>
             );

             return (
               <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #eee' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                   <h4 style={{ margin: 0 }}>Publish readiness</h4>
                   <span
                     style={{
                       fontSize: 12,
                       fontWeight: 700,
                       padding: '4px 10px',
                       borderRadius: 999,
                       background: ready ? '#dcfce7' : '#fef2f2',
                       color: ready ? '#166534' : '#991b1b',
                       border: `1px solid ${ready ? '#bbf7d0' : '#fecaca'}`,
                 whiteSpace: 'normal',
                     }}
                   >
                     {ready ? 'Ready to publish' : 'Not ready'}
                   </span>
                 </div>

                 <Item ok={basicsOk} title="Listing basics complete" help="Add title, description, category, price, and hosted images." />
                 <Item ok={policiesOk} title="Business policies selected" help="Select payment, return, and shipping policies." />
                 <Item ok={ebayConnectedOk} title="eBay connected" help="Reconnect eBay to continue." />
                 <Item ok={checksOk} title="eBay checks passed" help="Run eBay Checks before publishing." />
                 <Item
                   ok={accountOk}
                   title="Account eligible"
                   help="Your eBay account needs setup (shipping/payments/policies)."
                 />
               </div>
             );
           })()}

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
               <img src={mainImageUrl} alt="preview" style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 4, objectFit: 'contain' }} />
             ) : (
               <div style={{ color: '#999' }}>No image</div>
             )}
           </div>
           <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{title || 'Your Product Title'}</div>
           <div style={{ color: '#c93', fontWeight: 700, fontSize: 20 }}>US ${price || '0.00'}</div>
           <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>Category: {category?.name || 'Not selected'}</div>
           {listingId ? <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>Draft ID: {listingId}</div> : null}
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
