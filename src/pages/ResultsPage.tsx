// src/pages/ResultsPage.tsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import ReactCrop, { type Crop, type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Mic, Square, RefreshCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './ResultsPage.css';
import CategorySelector from '../components/CategorySelector';
import { filterSizesForFamilyAndSizeType } from '../utils/sizeMaps';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../context/AuthContext'; // adjust if different
import { authFetch } from '../utils/authFetch';

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

type ImageItem = {
  url: string;
  rotate: 0 | 90 | 180 | 270;
  crop?: { x: number; y: number; width: number; height: number } | null;
  originalWidthPx?: number;
  originalHeightPx?: number;
};

type ImageDims = { width: number; height: number };

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

function hasSpecificValue(v: any): boolean {
  if (Array.isArray(v)) return v.some((x) => String(x ?? '').trim().length > 0);
  return String(v ?? '').trim().length > 0;
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

function normalizeRotate(v: any): 0 | 90 | 180 | 270 {
  const n = Number(v);
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

function normalizeImageItems(arr: any): ImageItem[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (typeof item === 'string') {
        return { url: item.trim(), rotate: 0 as const, crop: null };
      }
      if (item && typeof item === 'object' && typeof item.url === 'string') {
        const crop = item.crop && typeof item.crop === 'object'
          ? {
              x: Number(item.crop.x) || 0,
              y: Number(item.crop.y) || 0,
              width: Math.max(0, Number(item.crop.width) || 0),
              height: Math.max(0, Number(item.crop.height) || 0),
            }
          : null;
        const originalWidthPx = Number(item.originalWidthPx ?? item.original_width_px ?? 0) || undefined;
        const originalHeightPx = Number(item.originalHeightPx ?? item.original_height_px ?? 0) || undefined;
        return { url: item.url.trim(), rotate: normalizeRotate(item.rotate), crop, originalWidthPx, originalHeightPx };
      }
      return null;
    })
    .filter((item): item is ImageItem => !!item && isHostedImageUrl(item.url));
}

function getCloudinarySourceUrl(originalUrl: string): string {
  const baseUrl = String(originalUrl || '').trim();
  if (!baseUrl) return baseUrl;
  if (!/res\.cloudinary\.com/i.test(baseUrl)) return baseUrl;

  const [withoutQuery, query] = baseUrl.split('?');
  const marker = '/upload/';
  const idx = withoutQuery.indexOf(marker);
  if (idx === -1) return baseUrl;

  const prefix = withoutQuery.slice(0, idx + marker.length);
  const rest = withoutQuery.slice(idx + marker.length);
  const firstSlash = rest.indexOf('/');
  if (firstSlash === -1) return baseUrl;

  const firstSegment = rest.slice(0, firstSlash);
  const remainder = rest.slice(firstSlash + 1);

  let transformed = '';
  if (/^v\d+/.test(firstSegment)) {
    transformed = `${prefix}${rest}`;
  } else {
    transformed = `${prefix}${remainder}`;
  }

  return query ? `${transformed}?${query}` : transformed;
}

function buildRotatedCloudinaryUrl(
  originalUrl: string,
  rotate: number,
  crop?: { x: number; y: number; width: number; height: number } | null,
  originalDims?: ImageDims | null
): string {
  const baseUrl = String(getCloudinarySourceUrl(originalUrl) || '').trim();
  if (!baseUrl) return baseUrl;
  if (!/res\.cloudinary\.com/i.test(baseUrl)) return baseUrl;

  const transforms: string[] = [];
  transforms.push('c_limit,w_9000,h_9000');
  if (rotate && rotate !== 0) transforms.push(`a_${rotate}`);
  if (crop && crop.width > 0 && crop.height > 0) {
    const isNormalized = crop.width <= 1 && crop.height <= 1 && crop.x <= 1 && crop.y <= 1;
    if (isNormalized) {
      if (originalDims?.width && originalDims?.height) {
        const px = {
          x: Math.round(crop.x * originalDims.width),
          y: Math.round(crop.y * originalDims.height),
          width: Math.round(crop.width * originalDims.width),
          height: Math.round(crop.height * originalDims.height),
        };
        transforms.push(`c_crop,w_${px.width},h_${px.height},x_${px.x},y_${px.y}`);
      }
    } else {
      transforms.push(`c_crop,w_${Math.round(crop.width)},h_${Math.round(crop.height)},x_${Math.round(crop.x)},y_${Math.round(crop.y)}`);
    }
  }

  if (!transforms.length) return baseUrl;

  const [withoutQuery, query] = baseUrl.split('?');
  const marker = '/upload/';
  const idx = withoutQuery.indexOf(marker);
  if (idx === -1) return baseUrl;

  const prefix = withoutQuery.slice(0, idx + marker.length);
  const rest = withoutQuery.slice(idx + marker.length);
  const firstSlash = rest.indexOf('/');
  if (firstSlash === -1) return baseUrl;

  const firstSegment = rest.slice(0, firstSlash);
  const remainder = rest.slice(firstSlash + 1);
  const transformStr = transforms.join(',');

  let transformed = '';
  if (/^v\d+/.test(firstSegment)) {
    transformed = `${prefix}${transformStr}/${rest}`;
  } else {
    transformed = `${prefix}${transformStr},${firstSegment}/${remainder}`;
  }

  return query ? `${transformed}?${query}` : transformed;
}

function getOrderedImageItems(images: ImageItem[], mainIndex: number): ImageItem[] {
  if (!images.length) return [];
  return [images[mainIndex], ...images.filter((_, idx) => idx !== mainIndex)].filter(Boolean);
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
  const [categoryAspects, setCategoryAspects] = useState<any[]>([]);
  const [specificsValues, setSpecificsValues] = useState<Record<string, string | string[]>>({});
  const [images, setImages] = useState<ImageItem[]>([]);

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
  const [keywordsList, setKeywordsList] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [showRebuildModal, setShowRebuildModal] = useState(false);
  const [rebuildFeedback, setRebuildFeedback] = useState('');
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildNotice, setRebuildNotice] = useState('');
  const [rebuildSuccess, setRebuildSuccess] = useState('');
  const [recordingField, setRecordingField] = useState<'title' | 'description' | null>(null);
  const [transcribingField, setTranscribingField] = useState<'title' | 'description' | null>(null);
  const [transcribeError, setTranscribeError] = useState<{ title?: string; description?: string }>({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [activeMode, setActiveMode] = useState<'view' | 'crop'>('view');
  const [cropSelection, setCropSelection] = useState<Crop | null>(null);
  const [completedCrop, setCompletedCrop] = useState<PercentCrop | null>(null);
  const [cropWarning, setCropWarning] = useState('');
  const [cropError, setCropError] = useState('');
  const [imageDims, setImageDims] = useState<Record<string, ImageDims>>({});
  const [originalImageSnapshot, setOriginalImageSnapshot] = useState<ImageItem | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const lastCategoryFetchRef = useRef<string>('');
  const lastReconcileRef = useRef<string>('');
  const [isEditImageLoading, setIsEditImageLoading] = useState(false);

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

  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>('');

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
  const keywordInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const activeCropImageRef = useRef<HTMLImageElement | null>(null);
  const lastCropInitKeyRef = useRef<string>('');

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

        const response = await authFetch('/api/ebay-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getCategorySpecifics', categoryId }),
        });

        const data = await response.json();
        if (!response.ok || data?.ok === false) {
          throw new Error(data?.error || 'Failed to fetch category specifics');
        }

        const aspects = Array.isArray(data?.data?.aspects)
          ? data.data.aspects
          : Array.isArray(data?.aspects)
            ? data.aspects
            : [];

        const baseSpecifics: ItemSpecific[] = aspects.map((aspect: any) => ({
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

        const filtered = applySizeTypeFilterToSpecifics(baseSpecifics, categoryPathForFilter);
        const schemaNameSet = new Set(aspects.map((a: any) => String(a?.name || '').toLowerCase()));
        const customSpecifics = (specifics || []).filter((s) => !schemaNameSet.has(String(s.name || '').toLowerCase()));
        const mergedSpecifics = [...filtered, ...customSpecifics];

        setCategoryAspects(aspects);
        setSpecifics(mergedSpecifics);
        setSpecificsValues((prev) => {
          if (Object.keys(prev || {}).length > 0) return prev;

          const detected = aiDetectedRef.current || {};
          const detectedMap: Record<string, string | string[]> = {
            brand: String(detected.brand || '').trim(),
            size: String(detected.size || '').trim(),
            department: String(detected.department || '').trim(),
            type: String(detected.type || '').trim(),
          };
          const colors = Array.isArray(detected.colors) ? detected.colors : detected.colors ? [detected.colors] : [];
          const color = String(colors[0] || '').trim();

          const next: Record<string, string | string[]> = {};
          aspects.forEach((a: any) => {
            const name = String(a?.name || '').trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (key.includes('brand') && detectedMap.brand) next[name] = detectedMap.brand;
            else if (key.includes('size') && detectedMap.size) next[name] = detectedMap.size;
            else if ((key.includes('color') || key.includes('colour')) && color) next[name] = color;
            else if (key.includes('department') && detectedMap.department) next[name] = detectedMap.department;
            else if (key === 'type' && detectedMap.type) next[name] = detectedMap.type;
          });
          return next;
        });
      } catch (err: any) {
        console.error('[Specifics] Error:', err);
        setError(err?.message || 'Failed to load category specifics');
      } finally {
        setLoadingSpecifics(false);
      }
    },
    [description, specifics]
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

        const response = await fetch('/api/ebay-api', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: 'getCategoryConditions', categoryId: cid }),
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

  const getDimsForImage = useCallback(
    (img: ImageItem | null): ImageDims | null => {
      if (!img) return null;
      if (img.originalWidthPx && img.originalHeightPx) {
        return { width: img.originalWidthPx, height: img.originalHeightPx };
      }
      return imageDims[img.url] || null;
    },
    [imageDims]
  );
  const mainImageUrl = images[mainImageIndex]
    ? buildRotatedCloudinaryUrl(
        images[mainImageIndex].url,
        images[mainImageIndex].rotate,
        images[mainImageIndex].crop,
        getDimsForImage(images[mainImageIndex])
      )
    : '';

  const activeImage = activeImageIndex != null ? images[activeImageIndex] : null;
  const activeImageUrl = activeImage
    ? buildRotatedCloudinaryUrl(activeImage.url, activeImage.rotate, activeImage.crop, getDimsForImage(activeImage))
    : '';

  const hasActiveEdits = useMemo(() => {
    if (!activeImage || !originalImageSnapshot) return false;
    const currentRotate = activeImage.rotate ?? 0;
    const originalRotate = originalImageSnapshot.rotate ?? 0;
    const currentCrop = activeImage.crop ?? null;
    const originalCrop = originalImageSnapshot.crop ?? null;
    return currentRotate !== originalRotate || JSON.stringify(currentCrop) !== JSON.stringify(originalCrop);
  }, [activeImage, originalImageSnapshot]);

  const getActivePixelCrop = useCallback(() => {
    if (!activeImage || !completedCrop) return null;
    const dims = getDimsForImage(activeImage);
    if (!dims) return null;

    const width = completedCrop.width ?? 0;
    const height = completedCrop.height ?? 0;
    const x = completedCrop.x ?? 0;
    const y = completedCrop.y ?? 0;

    if (width <= 0 || height <= 0) return null;

    if (completedCrop.unit === '%') {
      return {
        x: Math.round((x / 100) * dims.width),
        y: Math.round((y / 100) * dims.height),
        width: Math.round((width / 100) * dims.width),
        height: Math.round((height / 100) * dims.height),
      };
    }

    return { x, y, width, height };
  }, [activeImage, completedCrop, imageDims]);

  const getActiveNormalizedCrop = useCallback(() => {
    if (!activeImage) return null;
    const dims = getDimsForImage(activeImage);
    const px = getActivePixelCrop();
    if (!dims || !px) return null;
    return {
      x: px.x / dims.width,
      y: px.y / dims.height,
      width: px.width / dims.width,
      height: px.height / dims.height,
    };
  }, [activeImage, imageDims, getActivePixelCrop]);

  const cropShortestSide = useMemo(() => {
    const px = getActivePixelCrop();
    if (!px) return null;
    return Math.min(px.width, px.height);
  }, [getActivePixelCrop]);

  const cropPixelSize = useMemo(() => {
    const px = getActivePixelCrop();
    if (!px) return null;
    return { width: Math.max(0, Math.round(px.width)), height: Math.max(0, Math.round(px.height)) };
  }, [getActivePixelCrop]);

  const isCropTooSmall = cropShortestSide != null && cropShortestSide < 500;
  const isCropUnderZoom = cropShortestSide != null && cropShortestSide >= 500 && cropShortestSide < 1600;

  const hasPendingCropChanges = useCallback(() => {
    if (activeMode !== 'crop') return false;
    if (activeImageIndex == null) return false;

    const normalized = getActiveNormalizedCrop();
    if (!normalized || normalized.width <= 0 || normalized.height <= 0) return false;

    const applied = images[activeImageIndex]?.crop || null;
    if (!applied) return true;

    const closeEnough = (a: number, b: number, tol = 0.002) => Math.abs(a - b) <= tol;
    return !(
      closeEnough(applied.x, normalized.x) &&
      closeEnough(applied.y, normalized.y) &&
      closeEnough(applied.width, normalized.width) &&
      closeEnough(applied.height, normalized.height)
    );
  }, [activeMode, activeImageIndex, getActiveNormalizedCrop, images]);

  const resetCropUi = useCallback(() => {
    setActiveMode('view');
    setCropSelection(null);
    setCompletedCrop(null);
    setCropWarning('');
    setCropError('');
    lastCropInitKeyRef.current = '';
  }, []);

  const resetCropSelectionFull = useCallback(() => {
    setCropSelection({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
    setCompletedCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
    setCropWarning('');
    setCropError('');
  }, []);

  const navigateEditPhoto = useCallback(
    (direction: -1 | 1) => {
      if (images.length <= 1) return;
      if (activeImageIndex == null) return;

      if (hasPendingCropChanges()) {
        const ok = window.confirm('Discard crop changes and move to another photo?');
        if (!ok) return;
      }

      resetCropUi();

      const nextIndex = (activeImageIndex + direction + images.length) % images.length;
      setActiveImageIndex(nextIndex);
    },
    [activeImageIndex, hasPendingCropChanges, images.length, resetCropUi]
  );

  useEffect(() => {
    if (activeMode !== 'crop') return;
    if (!activeImage) return;
    const dims = getDimsForImage(activeImage);
    if (!dims) return;
    const key = `${activeImage.url}|${activeImage.rotate}`;
    if (lastCropInitKeyRef.current === key) return;

    if (activeImage.crop && activeImage.crop.width > 0 && activeImage.crop.height > 0) {
      const isNormalized =
        activeImage.crop.width <= 1 &&
        activeImage.crop.height <= 1 &&
        activeImage.crop.x <= 1 &&
        activeImage.crop.y <= 1;
      const percentCrop = isNormalized
        ? {
            unit: '%',
            x: activeImage.crop.x * 100,
            y: activeImage.crop.y * 100,
            width: activeImage.crop.width * 100,
            height: activeImage.crop.height * 100,
          }
        : {
            unit: '%',
            x: (activeImage.crop.x / dims.width) * 100,
            y: (activeImage.crop.y / dims.height) * 100,
            width: (activeImage.crop.width / dims.width) * 100,
            height: (activeImage.crop.height / dims.height) * 100,
          };

      setCropSelection(percentCrop);
      setCompletedCrop(percentCrop);
    } else {
      setCropSelection({
        unit: '%',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
      setCompletedCrop({
        unit: '%',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
    }

    lastCropInitKeyRef.current = key;
  }, [activeMode, activeImage, getDimsForImage]);

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

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        title: title.trim(),
        sku: sku.trim(),
        description: description.trim(),
        categoryId: category?.id || null,
        price,
        images,
        mainImageIndex,
        keywords,
        conditionId,
        conditionName,
        conditionDescription,
        specifics: (specifics || []).map((s) => ({ name: s?.name, value: s?.value })),
        ebayPaymentPolicyId,
        ebayReturnPolicyId,
        ebayFulfillmentPolicyId,
        packageWeightLb,
        packageWeightOz,
        packageLengthIn,
        packageWidthIn,
        packageHeightIn,
        irregularPackage,
      }),
    [
      title,
      sku,
      description,
      category?.id,
      price,
      images,
      mainImageIndex,
      keywords,
      conditionId,
      conditionName,
      conditionDescription,
      specifics,
      ebayPaymentPolicyId,
      ebayReturnPolicyId,
      ebayFulfillmentPolicyId,
      packageWeightLb,
      packageWeightOz,
      packageLengthIn,
      packageWidthIn,
      packageHeightIn,
      irregularPackage,
    ]
  );

  const missingRequiredSpecifics = useMemo(() => {
    const required = (specifics || []).filter((spec) => spec.required);
    const missing = required.filter((spec) => {
      const value = spec.value;
      if (Array.isArray(value)) {
        return value.filter((v) => String(v ?? '').trim().length > 0).length === 0;
      }
      return String(value ?? '').trim().length === 0;
    });
    return missing.map((spec) => spec.name).filter(Boolean);
  }, [specifics]);

  useEffect(() => {
    if (!lastSavedSnapshot) return;
    setIsDirty(currentSnapshot !== lastSavedSnapshot);
  }, [currentSnapshot, lastSavedSnapshot]);

  useEffect(() => {
    if (loading) return;
    if (!listingId) return;
    if (lastSavedSnapshot) return;
    setLastSavedSnapshot(currentSnapshot);
  }, [loading, listingId, lastSavedSnapshot, currentSnapshot]);

  useEffect(() => {
    const parsed = keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const capped = parsed.slice(0, 10);
    setKeywordsList(capped);
    if (parsed.length > 10) {
      setKeywords(capped.join(', '));
    }
  }, [keywords]);

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

      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    if (!images.length) return;
    let cancelled = false;

    images.forEach((img) => {
      const url = img.url;
      if (!url || imageDims[url]) return;

      const probe = new Image();
      probe.onload = () => {
        if (cancelled) return;
        setImageDims((prev) => {
          if (prev[url]) return prev;
          return { ...prev, [url]: { width: probe.naturalWidth, height: probe.naturalHeight } };
        });
      };
      probe.src = url;
    });

    return () => {
      cancelled = true;
    };
  }, [images, imageDims]);

  useEffect(() => {
    if (!isEditModalOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsEditModalOpen(false);
        resetCropUi();
        setZoomLevel(1);
        setPanOffset({ x: 0, y: 0 });
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateEditPhoto(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateEditPhoto(1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditModalOpen, navigateEditPhoto, resetCropUi]);

  useEffect(() => {
    if (!isEditModalOpen) return;
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setIsEditImageLoading(false);
  }, [isEditModalOpen, activeImageIndex]);

  useEffect(() => {
    if (activeMode !== 'crop') return;
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  }, [activeMode]);

  useEffect(() => {
    if (!isEditModalOpen) return;
    if (activeImageIndex == null) return;
    const img = images[activeImageIndex];
    if (!img) return;
    setOriginalImageSnapshot({ ...img, crop: img.crop ? { ...img.crop } : null });
  }, [isEditModalOpen, activeImageIndex]);

  useEffect(() => {
    if (preflightPassed !== true) return;
    if (!lastPreflightInputKeyRef.current) return;
    if (lastPreflightInputKeyRef.current === preflightInputKey) return;

    setPreflightPassed(false);
    setPreflightMessage(null);
    setLastPreflightCode(null);
  }, [preflightInputKey, preflightPassed]);

  useEffect(() => {
    const cid = String(category?.id || '').trim();
    if (!cid) return;
    if (lastCategoryFetchRef.current === cid) return;
    lastCategoryFetchRef.current = cid;
    void fetchCategorySpecifics(cid, getCategoryPathString(category));
  }, [category?.id, fetchCategorySpecifics]);

  useEffect(() => {
    const cid = String(category?.id || '').trim();
    if (!cid) return;
    if (!categoryAspects.length) return;
    const detected = aiDetectedRef.current || {};
    if (!detected || Object.keys(detected).length === 0) return;

    const hasValue = (val: any) => {
      if (Array.isArray(val)) return val.filter((v) => String(v ?? '').trim().length > 0).length > 0;
      return String(val ?? '').trim().length > 0;
    };

    const reconcileKey = `${cid}:${categoryAspects.length}`;
    if (lastReconcileRef.current === reconcileKey) return;
    lastReconcileRef.current = reconcileKey;

    const run = async () => {
      try {
        const res = await authFetch('/api/ebay-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reconcileSpecifics',
            categoryId: cid,
            categoryPath: getCategoryPathString(category),
            aspects: categoryAspects,
            detected,
            title,
            description,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) return;
        const items = Array.isArray(json?.data?.item_specifics) ? json.data.item_specifics : [];

        if (!items.length) return;

        setSpecificsValues((prev) => {
          const next = { ...prev };
          items.forEach((it: any) => {
            if (!it?.accepted) return;
            const name = String(it?.name || '').trim();
            if (!name) return;
            if (hasValue(next[name])) return;
            next[name] = it.value as any;
          });
          return next;
        });

        setSpecifics((prev) => {
          const next = [...prev];
          items.forEach((it: any) => {
            if (!it?.accepted) return;
            const name = String(it?.name || '').trim();
            if (!name) return;
            const idx = next.findIndex((s) => String(s.name || '').toLowerCase() === name.toLowerCase());
            if (idx >= 0 && hasValue(next[idx]?.value)) return;
            const entry: ItemSpecific = {
              name,
              value: it.value as any,
              required: !!it?.required,
              multi: Array.isArray(it.value),
              selectionOnly: false,
              freeTextAllowed: true,
              options: [],
              allOptions: [],
              type: Array.isArray(it.value) ? 'dropdown' : 'text',
            };
            if (idx >= 0) next[idx] = { ...next[idx], ...entry };
            else next.push(entry);
          });
          return next;
        });
      } catch (err) {
        console.error('[Specifics] reconcileSpecifics failed:', err);
      }
    };

    void run();
  }, [category?.id, categoryAspects, description, title]);

  const buildListingJson = useCallback(() => {
    const categoryPath = getCategoryPathString(category);
    const orderedImages = getOrderedImageItems(images, mainImageIndex);
    const orderedImageUrls = orderedImages.map((img) =>
      buildRotatedCloudinaryUrl(img.url, img.rotate, img.crop, getDimsForImage(img))
    );

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
        item_specifics: Object.entries(specificsValues).map(([name, value]) => ({ name, value })),

      keywords: keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      price_suggestion: { optimal: parseFloat(price || '0') || 0 },
      images: orderedImages,
      image_urls: orderedImageUrls,
      mainImageIndex: 0,
    };
  }, [category, images, mainImageIndex, price, specificsValues, keywords, title, sku, description, conditionId, conditionName, conditionDescription, getDimsForImage]);

  const assertHostedImagesOrThrow = (arr: string[]) => {
    const bad = (arr || []).filter((u) => !isHostedImageUrl(u));
    if (bad.length) throw new Error('Images must be hosted URLs (Cloudinary). Please go back and re-upload.');
  };

  const disableActions = authLoading || !user?.id || !workspaceId || !internalUserId;

  const handleManualSaveDraft = async () => {
    const res = await handleSaveDraft();
  };

  const inferRebuildTargets = (feedback: string) => {
    const text = feedback.toLowerCase();
    const wantsTitle = text.includes('title');
    const wantsDescription = text.includes('description') || text.includes('desc');
    const specificsHints = [
      'specifics',
      'item specifics',
      'aspect',
      'aspects',
      'attribute',
      'attributes',
      'brand',
      'material',
      'color',
      'size',
      'style',
      'pattern',
      'model',
    ];
    const wantsSpecifics = specificsHints.some((hint) => text.includes(hint));

    if (!wantsTitle && !wantsDescription && !wantsSpecifics) {
      return { title: true, description: true, specifics: false };
    }

    return {
      title: wantsTitle,
      description: wantsDescription,
      specifics: wantsSpecifics,
    };
  };

  const handleRebuildListing = async () => {
    const feedback = rebuildFeedback.trim();
    if (feedback.length < 10) {
      setRebuildNotice('Feedback must be at least 10 characters.');
      return;
    }
    if (!listingId) {
      setRebuildNotice('Listing not loaded yet.');
      return;
    }

    const targets = inferRebuildTargets(feedback);

    setRebuildLoading(true);
    setRebuildNotice('');

    try {
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();

      if (sessionErr || !session?.access_token) {
        setRebuildNotice('Not logged in. Please sign in again.');
        return;
      }

      const currentSpecifics = (specifics || []).map((s) => ({ name: s.name, value: s.value }));

      const res = await fetch('/api/rebuild-listing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          listing_id: listingId,
          feedback,
          targets,
          current: {
            title,
            description,
            keywords,
            item_specifics: currentSpecifics,
            condition_intent: conditionIntentRef.current || null,
            category_id: category?.id || null,
          },
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRebuildNotice(json?.error || 'Failed to rebuild listing.');
        return;
      }

      const data = json?.data || json || {};

      if (targets.title && typeof data.title === 'string') {
        setTitle(data.title.slice(0, 80));
      }
      if (targets.description && typeof data.description === 'string') {
        setDescription(data.description);
      }
      if (targets.specifics && Array.isArray(data.item_specifics)) {
        setSpecifics((prev) => {
          const incoming = new Map(
            data.item_specifics.map((s: any) => [String(s?.name || '').toLowerCase(), s])
          );
          const next = prev.map((spec) => {
            const match = incoming.get(String(spec.name || '').toLowerCase());
            if (!match) return spec;
            return { ...spec, value: match.value };
          });
          data.item_specifics.forEach((s: any) => {
            const key = String(s?.name || '').toLowerCase();
            if (!key) return;
            const exists = next.some((spec) => String(spec.name || '').toLowerCase() === key);
            if (!exists) {
              next.push({
                name: String(s.name || '').trim(),
                value: s.value ?? '',
              } as ItemSpecific);
            }
          });
          return next;
        });
      }

      setIsDirty(true);
      setRebuildSuccess('Rebuilt. Review and Save Draft.');
      setShowRebuildModal(false);
      setShowRebuildConfirm(false);
      setRebuildFeedback('');
    } catch (err: any) {
      setRebuildNotice(err?.message || 'Failed to rebuild listing.');
    } finally {
      setRebuildLoading(false);
    }
  };

  const getSupportedAudioType = () => {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const startRecording = async (field: 'title' | 'description') => {
    if (recordingField) return;
    setTranscribeError((prev) => ({ ...prev, [field]: '' }));

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setTranscribeError((prev) => ({ ...prev, [field]: 'Microphone not supported in this browser.' }));
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = getSupportedAudioType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      mediaChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const chunks = mediaChunksRef.current;
        mediaChunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecordingField(null);

        const blobType = mimeType || (chunks[0]?.type || 'audio/webm');
        const blob = new Blob(chunks, { type: blobType });
        if (!blob.size) return;

        try {
          setTranscribingField(field);
          const {
            data: { session },
            error: sessionErr,
          } = await supabase.auth.getSession();

          if (sessionErr || !session?.access_token) {
            setTranscribeError((prev) => ({ ...prev, [field]: 'Please sign in again to use dictation.' }));
            return;
          }

          const formData = new FormData();
          formData.append('audio', blob, 'dictation.webm');
          formData.append('field', field);
          if (listingId) formData.append('listing_id', listingId);

          const resp = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: formData,
          });

          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            setTranscribeError((prev) => ({ ...prev, [field]: json?.error || 'Transcription failed.' }));
            return;
          }

          const transcript = String(json?.text || '').trim();
          if (!transcript) return;

          const formatTitleTranscript = (text: string) => {
            const cleaned = text
              .replace(/[^a-zA-Z0-9\s-]+/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (!cleaned) return '';
            return cleaned
              .split(' ')
              .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : ''))
              .join(' ')
              .trim();
          };

          if (field === 'title') {
            setIsDirty(true);
            const formatted = formatTitleTranscript(transcript);
            if (!formatted) return;
            setTitle((prev) => {
              const current = prev.trim();
              const remaining = Math.max(0, 80 - current.length - (current ? 1 : 0));
              if (remaining <= 0) return current;
              const nextChunk = formatted.slice(0, remaining).trim();
              if (!nextChunk) return current;
              return current ? `${current} ${nextChunk}` : nextChunk;
            });
          } else {
            setIsDirty(true);
            setDescription((prev) => (prev.trim().length ? `${prev.trim()}\n\n${transcript}` : transcript));
          }
        } catch (err: any) {
          setTranscribeError((prev) => ({ ...prev, [field]: err?.message || 'Transcription failed.' }));
        } finally {
          setTranscribingField(null);
        }
      };

      recorder.start();
      setRecordingField(field);
    } catch (err: any) {
      setTranscribeError((prev) => ({ ...prev, [field]: err?.message || 'Microphone access failed.' }));
      setRecordingField(null);
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

          const ljImages = Array.isArray(lj.images) ? lj.images : [];
          const hasImageObjects = ljImages.some((img: any) => img && typeof img === 'object' && typeof img.url === 'string');
          const imgsRaw: any[] = hasImageObjects ? ljImages : Array.isArray(row.images) ? row.images : ljImages;
          const normalizedImages = normalizeImageItems(imgsRaw);
          setImages(normalizedImages);
          setMainImageIndex(0);

          const kws =
            Array.isArray(lj.keywords) ? lj.keywords.join(', ') : typeof lj.keywords === 'string' ? lj.keywords : '';
          const parsedKeywords = kws
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean);
          setKeywords(kws);
          setKeywordsList(parsedKeywords);

          const catFromJson = lj.category || null;
          const rawCatId = String(catFromJson?.id ?? row.category_id ?? '').trim();
          const catId = rawCatId && rawCatId !== '0' ? rawCatId : '';
          const cat: CategoryWithPath | null =
            catFromJson && (catId || catFromJson.name)
              ? {
                  id: catId,
                  name: String(catFromJson.name ?? (catId ? 'Selected Category' : '')),
                  path: String(catFromJson.path ?? row.category_path ?? ''),
                  breadcrumbs: Array.isArray(catFromJson.breadcrumbs) ? catFromJson.breadcrumbs : undefined,
                }
              : catId
                ? { id: catId, name: 'Selected Category', path: String(row.category_path ?? '') }
                : null;

          setCategory(cat);

          const baseSpecs: ItemSpecific[] = Array.isArray(lj.item_specifics) ? lj.item_specifics : [];
          const filteredSpecs = applySizeTypeFilterToSpecifics(baseSpecs, getCategoryPathString(cat));
          setSpecifics(filteredSpecs);
          setSpecificsValues(() => {
            const next: Record<string, string | string[]> = {};
            filteredSpecs.forEach((s) => {
              if (!s?.name) return;
              next[String(s.name)] = s.value as any;
            });
            return next;
          });

          // Cache detected facts + last-known specifics for category changes
          aiDetectedRef.current = (lj?.detected && typeof lj.detected === 'object') ? lj.detected : (lj?.analysis?.detected || {});
          aiSpecificsRef.current = baseSpecs;

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

    const prevSpecifics = specifics;

    setCategory(newCategory);
    setConditionId('');
    setConditionName('');
    setConditionDescription('');
    setShowCategoryModal(false);

    const categoryPath = getCategoryPathString(newCategory);

    // If we don't have a DB listing yet, fall back to schema-only fetch.
    if (!String(listingId || '').trim()) {
      await fetchCategorySpecifics(newCategory.id, categoryPath);
      return;
    }

    await fetchCategorySpecifics(newCategory.id, categoryPath);
  };

  const setSchemaSpecificValue = (aspect: any, nextValue: string | string[]) => {
    const name = String(aspect?.name || '').trim();
    if (!name) return;

    setIsDirty(true);
    setSpecificsValues((prev) => ({ ...prev, [name]: nextValue }));
    setSpecifics((prev) => {
      const next = [...prev];
      const idx = next.findIndex((s) => String(s.name || '').toLowerCase() === name.toLowerCase());
      const entry: ItemSpecific = {
        name,
        value: nextValue as any,
        required: !!aspect?.required,
        multi: !!aspect?.multi,
        selectionOnly: !!aspect?.selectionOnly,
        freeTextAllowed: aspect?.freeTextAllowed !== false,
        options: aspect?.values || [],
        allOptions: aspect?.values || [],
        type: aspect?.selectionOnly ? 'dropdown' : 'text',
      };
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...entry };
      } else {
        next.push(entry);
      }
      return next;
    });
  };

  const updateSpecific = (idx: number, value: string | string[]) => {
    setIsDirty(true);
    setSpecifics((prev) => {
      let next = [...prev];
      next[idx] = { ...next[idx], value };

       const name = String(next[idx]?.name || '').trim();
       if (name) {
         setSpecificsValues((prevValues) => ({ ...prevValues, [name]: value }));
       }

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

      const orderedImages: string[] = Array.isArray((listingData as any).image_urls)
        ? (listingData as any).image_urls
        : [];
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
          image_urls: orderedImages,
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
      setLastSavedSnapshot(currentSnapshot);

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

      const msg = isNetworkLikeError(err)
        ? 'Failed to reach server. Check connection and try again.'
        : String(err?.message || '').trim() || 'Failed to save draft. Please try again.';

      return { ok: false, errorMessage: msg };
    } finally {
      setSavingDraft(false);
    }
  };

  
 
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
      const orderedImages = getOrderedImageItems(images, mainImageIndex).map((img) =>
        buildRotatedCloudinaryUrl(img.url, img.rotate, img.crop, getDimsForImage(img))
      );
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
    console.log('[ebay reconnect] clicked')
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
          return_to: `${window.location.origin}/settings?ebay=connected`,
        }),
      });

      const raw = await res.text()
      console.log('[ebay-oauth-start] status:', res.status, 'ok:', res.ok)
      console.log('[ebay-oauth-start] raw response:', raw)
      let data: any = {}
      try {
        data = JSON.parse(raw)
      } catch {
        data = {}
      }

      const oauthUrl = data?.oauthUrl || data?.url

      if (!res.ok || !oauthUrl) {
        setEbayReconnectError(String(data?.error || raw || `Failed (HTTP ${res.status})`))
        console.error('[ebay-oauth-start] missing oauthUrl', { status: res.status, ok: res.ok, data })
        return
      }

      console.log('Redirecting to eBay:', oauthUrl)
      window.location.assign(String(oauthUrl))
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

    let publishListingId = listingId;

    if (!publishListingId || isDirty) {
      const saveRes = await handleSaveDraft({ silent: true });
      if (!saveRes.ok) {
        setUiError({
          title: 'Save failed',
          message: saveRes.errorMessage || 'Failed to save draft. Please try again.',
        });
        return;
      }

      publishListingId = String(saveRes.listingId || '').trim();
      if (!publishListingId) {
        setUiError({
          title: 'Save failed',
          message: 'Draft saved but no id was returned. Please try again.',
        });
        return;
      }

      if (publishListingId !== listingId) {
        setListingId(publishListingId);
      }
    }

    const preflightOk = await runEbayPreflight(publishListingId);
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
        body: JSON.stringify({ listing_id: publishListingId }),
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
              cursor: mainImageUrl ? 'pointer' : 'default',
            }}
            onClick={() => {
              if (!mainImageUrl) return;
              setActiveImageIndex(mainImageIndex);
              setIsEditModalOpen(true);
              setActiveMode('view');
              setCropSelection(null);
              setCropWarning('');
              setCropError('');
            }}
            role={mainImageUrl ? 'button' : undefined}
            aria-label={mainImageUrl ? 'Edit main photo' : undefined}
          >
            {mainImageUrl ? (
              <img src={mainImageUrl} alt="Main" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ color: '#999' }}>No image</div>
            )}
          </div>

          {images.length > 0 && (
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
                        const mainItem = prevImages[prevMain];
                        const mainKey = mainItem ? `${mainItem.url}|${mainItem.rotate}` : '';
                        const newIndex = next.findIndex((item) => `${item.url}|${item.rotate}` === mainKey);
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
                    position: 'relative',
                  }}
                >
                  <button
                    type="button"
                    className="results-thumb-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDirty(true);
                      setImages((prevImages) => {
                        const next = prevImages.filter((_, i) => i !== idx);
                        setMainImageIndex((prevMain) => {
                          if (next.length === 0) return 0;
                          if (prevMain === idx) return 0;
                          if (prevMain > idx) return prevMain - 1;
                          return prevMain;
                        });
                        return next;
                      });
                    }}
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                    <img
                      src={buildRotatedCloudinaryUrl(img.url, img.rotate, img.crop, getDimsForImage(img))}
                      alt={`thumb-${idx}`}
                      style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'cover' }}
                    />
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Title</h3>
          <div className="results-title-row">
            <input
              ref={titleInputRef}
              className="results-title-input"
              placeholder="Enter title..."
              maxLength={80}
              value={title}
              onChange={(e) => {
                setIsDirty(true);
                setTitle(e.target.value.slice(0, 80));
                setRebuildSuccess('');
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
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
            <button
              type="button"
              className="results-mic-btn"
              onClick={() => (recordingField === 'title' ? stopRecording() : startRecording('title'))}
              disabled={transcribingField === 'title'}
              aria-label={recordingField === 'title' ? 'Stop dictation' : 'Start dictation'}
            >
              {recordingField === 'title' ? <Square size={16} /> : <Mic size={16} />}
            </button>
            <button
              type="button"
              className="results-rebuild-btn"
              onClick={() => {
                setRebuildNotice('');
                setRebuildSuccess('');
                setShowRebuildModal(true);
              }}
              disabled={rebuildLoading}
              aria-label="Rebuild Listing"
            >
              <RefreshCcw size={16} />
            </button>
          </div>
          {showTitleInlineError && !title.trim() && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>Title is required.</div>
          )}
          {recordingField === 'title' ? <div className="results-mic-status">Listening...</div> : null}
          {transcribingField === 'title' ? <div className="results-mic-status">Transcribing...</div> : null}
          {transcribeError.title ? <div className="results-mic-error">{transcribeError.title}</div> : null}
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, textAlign: 'right' }}>{title.length}/80 characters</div>
          {rebuildSuccess ? <div className="results-rebuild-success">{rebuildSuccess}</div> : null}
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

        {category?.id && conditionRequired && (
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

                  {needsDescription && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Condition description</div>
                      <div style={{ position: 'relative', maxWidth: 520 }}>
                        <textarea
                          ref={conditionDescriptionRef}
                          id="condition_description"
                          value={conditionDescription}
                          onChange={(e) => {
                            setIsDirty(true);
                            setConditionDescription(e.target.value);
                          }}
                          rows={2}
                          maxLength={1000}
                          style={{
                            width: '100%',
                            padding: 10,
                            paddingBottom: 22,
                            borderRadius: 6,
                            border: '1px solid #d1d5db',
                            fontSize: 14,
                            boxSizing: 'border-box',
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            right: 8,
                            bottom: 6,
                            fontSize: 11,
                            color: '#6b7280',
                          }}
                        >
                          {conditionDescription.length}/1000 characters
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </section>
        )}

        <section ref={specificsSectionRef as any} style={{ marginTop: 24 }}>

          <h3>
            Item Specifics {loadingSpecifics && <span style={{ fontSize: 14, color: '#666' }}>(Loading…)</span>}
          </h3>

          {categoryAspects.length === 0 && specifics.length === 0 && !loadingSpecifics && (
            <div style={{ opacity: 0.7, marginTop: 8 }}>No specifics loaded. Select a category first.</div>
          )}

          {categoryAspects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-3" style={{ marginTop: 12 }}>
              {categoryAspects.slice(0, 25).map((aspect: any, i: number) => {
                const name = String(aspect?.name || '').trim();
                if (!name) return null;
                const value = specificsValues[name] ?? (aspect?.multi ? [] : '');
                const shouldHighlight = highlightMissing || showTitleInlineError;
                const isMissing = Array.isArray(value)
                  ? value.filter((v: any) => String(v ?? '').trim().length > 0).length === 0
                  : String(value ?? '').trim().length === 0;
                const hasError = shouldHighlight && !!aspect?.required && isMissing;

                return (
                  <div key={`${name}-${i}`} className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700 flex justify-between items-center">
                      <span>{name}</span>
                      {aspect?.required && <span className="ml-1 text-red-500">*</span>}
                    </label>
                    {aspect?.selectionOnly && Array.isArray(aspect?.values) && aspect.values.length > 0 ? (
                      <select
                        value={
                          aspect?.multi
                            ? Array.isArray(value)
                              ? value
                              : value
                                ? [String(value)]
                                : []
                            : String(value || '')
                        }
                        multiple={!!aspect?.multi}
                        onChange={(e) => {
                          if (aspect?.multi) {
                            const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                            setSchemaSpecificValue(aspect, selected);
                          } else {
                            setSchemaSpecificValue(aspect, String(e.target.value || ''));
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: hasError ? '1px solid #ef4444' : '1px solid #d1d5db',
                          background: 'white',
                          fontSize: 14,
                        }}
                      >
                        {aspect?.multi ? null : <option value="">Select…</option>}
                        {aspect.values.map((opt: string) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={Array.isArray(value) ? value.join(', ') : String(value || '')}
                        onChange={(e) => {
                          const raw = String(e.target.value || '');
                          if (aspect?.multi) {
                            const parts = raw
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean);
                            setSchemaSpecificValue(aspect, parts);
                          } else {
                            setSchemaSpecificValue(aspect, raw);
                          }
                        }}
                        placeholder={`Enter ${name}`}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: hasError ? '1px solid #ef4444' : '1px solid #d1d5db',
                          background: 'white',
                          fontSize: 14,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
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
          )}

          {categoryAspects.length > 0 && (() => {
            const schemaNameSet = new Set(categoryAspects.map((a: any) => String(a?.name || '').toLowerCase()));
            const customSpecifics = specifics
              .map((spec, idx) => ({ spec, idx }))
              .filter(({ spec }) => !schemaNameSet.has(String(spec.name || '').toLowerCase()));
            if (!customSpecifics.length) return null;
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-3" style={{ marginTop: 12 }}>
                {customSpecifics.map(({ spec, idx }) => (
                  <div key={`${spec.name}-${idx}`} className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700 flex justify-between items-center">
                      <span>{spec.name || 'Custom'}</span>
                      {spec.required && <span className="ml-1 text-red-500">*</span>}
                    </label>
                    <ItemSpecificControl spec={spec} onChange={(val) => updateSpecific(idx, val)} />
                  </div>
                ))}
              </div>
            );
          })()}

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
          <div className="results-section-row">
            <h3>Description</h3>
            <button
              type="button"
              className="results-mic-btn"
              onClick={() => (recordingField === 'description' ? stopRecording() : startRecording('description'))}
              disabled={transcribingField === 'description'}
              aria-label={recordingField === 'description' ? 'Stop dictation' : 'Start dictation'}
            >
              {recordingField === 'description' ? <Square size={16} /> : <Mic size={16} />}
            </button>
          </div>
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
          {recordingField === 'description' ? <div className="results-mic-status">Listening...</div> : null}
          {transcribingField === 'description' ? <div className="results-mic-status">Transcribing...</div> : null}
          {transcribeError.description ? <div className="results-mic-error">{transcribeError.description}</div> : null}
        </section>

        <section style={{ marginTop: 24 }}>
          <h3>Keywords</h3>
          <div
            className="results-keywords-input"
            onClick={() => keywordInputRef.current?.focus()}
            role="group"
            aria-label="Keywords"
          >
            {keywordsList.map((keyword) => (
              <span key={keyword} className="results-keywords-chip">
                {keyword}
                <button
                  type="button"
                  className="results-keywords-chip-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDirty(true);
                    setKeywordsList((prev) => {
                      const next = prev.filter((item) => item !== keyword);
                      setKeywords(next.join(', '));
                      return next;
                    });
                  }}
                  aria-label={`Remove ${keyword}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              ref={keywordInputRef}
              type="text"
              value={keywordDraft}
              placeholder={keywordsList.length ? '' : 'e.g., vintage, designer, rare'}
              className="results-keywords-field"
              onChange={(e) => setKeywordDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const trimmed = keywordDraft.trim();
                  if (!trimmed) return;
                  setIsDirty(true);
                  setKeywordsList((prev) => {
                    if (prev.length >= 10) return prev;
                    const exists = prev.some((item) => item.toLowerCase() === trimmed.toLowerCase());
                    if (exists) return prev;
                    const next = [...prev, trimmed];
                    setKeywords(next.join(', '));
                    return next;
                  });
                  setKeywordDraft('');
                  return;
                }

                if (e.key === 'Backspace' && !keywordDraft.trim()) {
                  setIsDirty(true);
                  setKeywordsList((prev) => {
                    if (prev.length === 0) return prev;
                    const next = prev.slice(0, -1);
                    setKeywords(next.join(', '));
                    return next;
                  });
                }
              }}
            />
          </div>
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
                padding: '6px 10px',
                background: policyLoading ? '#999' : '#f3f4f6',
                border: '1px solid #ddd',
                borderRadius: 6,
                cursor: policyLoading ? 'default' : 'pointer',
                fontSize: 11,
              }}
              title="Reload policy lists from eBay (if eligible)"
            >
              {policyLoading ? 'Loading…' : 'Reload policies'}
            </button>
          </div>

          {policyError ? <div style={{ marginTop: 10, color: '#b45309', fontSize: 13 }}>{policyError}</div> : null}

          {!paymentPolicies.length && !returnPolicies.length && !fulfillmentPolicies.length && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#666' }}>
              Policy lists are not available for this account (or could not be fetched). You can still paste policy IDs below.
            </div>
          )}

          {/* Row 1: Policies */}
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
                  className="results-policy-input"
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
                  className="results-policy-input"
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
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Payment policy</label>
              {paymentPolicies.length > 0 ? (
                <select
                  value={ebayPaymentPolicyId}
                  onChange={(e) => {
                    setIsDirty(true);
                    setEbayPaymentPolicyId(e.target.value);
                  }}
                  disabled={policyLoading}
                  className="results-policy-input"
                  style={{
                    width: '100%',
                    padding: 10,
                    border: highlightMissing && !String(ebayPaymentPolicyId || '').trim() ? '1px solid #ef4444' : undefined,
                    borderRadius: 6,
                  }}
                >
                  <option value="">Select…</option>
                  {paymentPolicies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={ebayPaymentPolicyId}
                  onChange={(e) => {
                    setIsDirty(true);
                    setEbayPaymentPolicyId(e.target.value);
                  }}
                  placeholder="Enter payment policy ID"
                  className="results-policy-input"
                  style={{
                    width: '100%',
                    padding: 10,
                    border: highlightMissing && !String(ebayPaymentPolicyId || '').trim() ? '1px solid #ef4444' : undefined,
                    borderRadius: 6,
                  }}
                />
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Return policy</label>
              {returnPolicies.length > 0 ? (
                <select
                  value={ebayReturnPolicyId}
                  onChange={(e) => {
                    setIsDirty(true);
                    setEbayReturnPolicyId(e.target.value);
                  }}
                  disabled={policyLoading}
                  className="results-policy-input"
                  style={{
                    width: '100%',
                    padding: 10,
                    border: highlightMissing && !String(ebayReturnPolicyId || '').trim() ? '1px solid #ef4444' : undefined,
                    borderRadius: 6,
                  }}
                >
                  <option value="">Select…</option>
                  {returnPolicies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={ebayReturnPolicyId}
                  onChange={(e) => {
                    setIsDirty(true);
                    setEbayReturnPolicyId(e.target.value);
                  }}
                  placeholder="Enter return policy ID"
                  className="results-policy-input"
                  style={{
                    width: '100%',
                    padding: 10,
                    border: highlightMissing && !String(ebayReturnPolicyId || '').trim() ? '1px solid #ef4444' : undefined,
                    borderRadius: 6,
                  }}
                />
              )}
            </div>
          </div>

          {/* Row 2: Package details */}
          <div className="results-policy-row2" style={{ marginTop: 12 }}>
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
              <div className="results-toggle-group" role="group" aria-label="Irregular package">
                <button
                  type="button"
                  className={`results-toggle-btn ${irregularPackage ? 'is-active' : ''}`}
                  onClick={() => {
                    setIsDirty(true);
                    setIrregularPackage(true);
                  }}
                  aria-pressed={irregularPackage}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={`results-toggle-btn ${!irregularPackage ? 'is-active' : ''}`}
                  onClick={() => {
                    setIsDirty(true);
                    setIrregularPackage(false);
                  }}
                  aria-pressed={!irregularPackage}
                >
                  No
                </button>
              </div>
            </div>
          </div>

          {missingRequirements.totalMissingCount > 0 && (
            <div className="results-policy-actions">
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
                  }
                }}
              >
                Highlight missing fields
              </button>
            </div>
          )}

        </section>

          <div className="results-action-bar" style={{ marginTop: 32, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'nowrap' }}>
            <button
              onClick={handleManualSaveDraft}
              disabled={disableActions || publishing || preflightLoading || savingDraft || rebuildLoading}
              className="results-action-btn"
              style={{
                padding: '6px 10px',
                background: disableActions || publishing || preflightLoading || savingDraft || rebuildLoading ? '#999' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: disableActions || publishing || preflightLoading || savingDraft || rebuildLoading ? 'default' : 'pointer',
                fontSize: 12,
                fontWeight: 600,
                width: 'auto',
                minWidth: 120,
                flex: '0 1 auto',
              }}
            >
              Save Draft
            </button>

            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing || preflightLoading || savingDraft || disableActions || rebuildLoading}
              className="results-action-btn"
              style={{
                padding: '6px 10px',
                background: publishing || preflightLoading || savingDraft || disableActions || rebuildLoading ? '#999' : '#0064d2',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: publishing || preflightLoading || savingDraft || disableActions || rebuildLoading ? 'default' : 'pointer',
                fontSize: 12,
                fontWeight: 600,
                width: 'auto',
                minWidth: 120,
                flex: '0 1 auto',
              }}
            >
              {publishing || preflightLoading ? 'Publishing…' : 'Publish'}
            </button>

            {draftSavedSuccessfully && (

              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="results-action-btn"
                disabled={rebuildLoading}
                style={{
                  padding: '6px 10px',
                  background: rebuildLoading ? '#999' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  width: 'auto',
                  minWidth: 120,
                  flex: '0 1 auto',
                }}
              >
                Go to Dashboard
              </button>
            )}

             <button
               type="button"
               onClick={() => navigate('/create-listing')}
               className="results-action-btn"
               disabled={rebuildLoading}
               style={{
                  padding: '6px 10px',
                  background: rebuildLoading ? '#f3f4f6' : '#f0f0f0',
                  color: '#333',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  cursor: rebuildLoading ? 'default' : 'pointer',
                  fontSize: 12,
                  width: 'auto',
                  minWidth: 120,
                  flex: '0 1 auto',
                }}
              >
                Cancel
              </button>

            <span
              className="results-action-status"
              style={{
                minWidth: 80,
                fontSize: 13,
                color: isDirty ? '#b45309' : '#166534',
                fontWeight: isDirty ? 600 : 500,
                whiteSpace: 'nowrap',
                marginLeft: 'auto',
              }}
            >
              {isDirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
 
         </div>



        {uiError && (
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
              {(uiError.requestId || uiError.ebayErrorId) && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280', overflowWrap: 'anywhere' }}>
                  {uiError.requestId ? <div>Request ID: {uiError.requestId}</div> : null}
                  {uiError.ebayErrorId ? <div>eBay Error ID: {uiError.ebayErrorId}</div> : null}
                </div>
              )}
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
        )}

        {preflightPassed === true && (

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
        )}

        {publishSuccess && (
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
            {publishSuccess.ebay_listing_url && (
              <div style={{ fontSize: 14, marginTop: 4 }}>
                <a href={publishSuccess.ebay_listing_url} target="_blank" rel="noreferrer" style={{ color: '#166534', textDecoration: 'underline' }}>
                  View on eBay
                </a>
              </div>
            )}
          </div>
        )}

        {ebayReconnectRequired && (
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
        )}

        {publishErrors.length > 0 && (
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
        )}

        {isEditModalOpen && activeImage && (
          <div className="results-modal-backdrop">
            <div className="results-edit-modal" role="dialog" aria-modal="true">
              <div className="results-edit-header">
                <h3 style={{ margin: 0 }}>Edit Photo</h3>
                <button
                  type="button"
                  className="results-edit-close"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    resetCropUi();
                    setZoomLevel(1);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className={`results-edit-body ${activeMode === 'crop' ? 'is-crop' : ''}`}>
                {isEditImageLoading && activeMode === 'view' && (
                  <div className="results-edit-loading" aria-live="polite">
                    <div className="results-edit-spinner" />
                  </div>
                )}
                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="results-edit-nav results-edit-nav-prev"
                      onClick={() => navigateEditPhoto(-1)}
                      aria-label="Previous photo"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="results-edit-nav results-edit-nav-next"
                      onClick={() => navigateEditPhoto(1)}
                      aria-label="Next photo"
                    >
                      ›
                    </button>
                  </>
                )}
                {activeMode === 'crop' ? (
                  <div className="results-edit-cropper">
                    {cropPixelSize && cropSelection && (
                      <div
                        className={`results-edit-crop-size ${isCropTooSmall ? 'is-danger' : ''}`}
                        style={{
                          left: `${cropSelection.x ?? 0}%`,
                          top: `${cropSelection.y ?? 0}%`,
                        }}
                        aria-live="polite"
                      >
                        Crop: {cropPixelSize.width} × {cropPixelSize.height} px
                        {isCropUnderZoom ? ' • Zoom off (<1600px)' : ''}
                      </div>
                    )}
                    <ReactCrop
                      crop={cropSelection ?? undefined}
                      onChange={(next) => {
                        setCropSelection(next);
                        setCropError('');
                      }}
                      onComplete={(_, percentCrop) => setCompletedCrop(percentCrop)}
                      keepSelection
                    >
                      <img
                        ref={activeCropImageRef}
                        src={buildRotatedCloudinaryUrl(activeImage.url, activeImage.rotate)}
                        alt="Crop"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          const naturalWidth = img.naturalWidth || 0;
                          const naturalHeight = img.naturalHeight || 0;
                          if (naturalWidth > 0 && naturalHeight > 0) {
                            if (activeImageIndex != null) {
                              setImages((prev) =>
                                prev.map((item, i) =>
                                  i === activeImageIndex
                                    ? { ...item, originalWidthPx: naturalWidth, originalHeightPx: naturalHeight }
                                    : item
                                )
                              );
                            }
                            setImageDims((prev) => ({
                              ...prev,
                              [activeImage.url]: { width: naturalWidth, height: naturalHeight },
                            }));
                          }
                          if (activeMode === 'crop') {
                            lastCropInitKeyRef.current = '';
                          }
                        }}
                      />
                    </ReactCrop>
                  </div>
                ) : activeImageUrl ? (
                  <div
                    className={`results-edit-image-wrap ${zoomLevel > 1 ? 'is-zoomed' : ''} ${zoomLevel > 1 ? 'is-zoom-out' : 'is-zoom-in'} ${isPanning ? 'is-panning' : ''}`}
                    onMouseDown={(e) => {
                      if (zoomLevel <= 1) return;
                      e.preventDefault();
                      setIsPanning(true);
                      panStartRef.current = {
                        x: e.clientX,
                        y: e.clientY,
                        originX: panOffset.x,
                        originY: panOffset.y,
                      };
                    }}
                    onMouseMove={(e) => {
                      if (!isPanning || zoomLevel <= 1) return;
                      const start = panStartRef.current;
                      if (!start) return;
                      const dx = e.clientX - start.x;
                      const dy = e.clientY - start.y;
                      setPanOffset({ x: start.originX + dx, y: start.originY + dy });
                    }}
                    onMouseUp={() => {
                      setIsPanning(false);
                      panStartRef.current = null;
                    }}
                    onMouseLeave={() => {
                      setIsPanning(false);
                      panStartRef.current = null;
                    }}
                    onClick={() => {
                      if (activeMode === 'crop') return;
                      setZoomLevel((prev) => {
                        if (prev >= 1.8) {
                          setPanOffset({ x: 0, y: 0 });
                          return 1;
                        }
                        return Math.min(3, Math.round((prev + 0.6) * 10) / 10);
                      });
                    }}
                    onWheel={(e) => {
                      if (activeMode === 'crop') return;
                      e.preventDefault();
                      const direction = e.deltaY > 0 ? -1 : 1;
                      setZoomLevel((prev) => {
                        const next = Math.min(3, Math.max(1, Math.round((prev + direction * 0.2) * 10) / 10));
                        if (next === 1) setPanOffset({ x: 0, y: 0 });
                        return next;
                      });
                    }}
                  >
                    <img
                      src={activeImageUrl}
                      alt="Edit"
                      className="results-edit-image"
                      onLoad={() => setIsEditImageLoading(false)}
                      onError={() => setIsEditImageLoading(false)}
                      style={{
                        transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                        transformOrigin: 'center center',
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ color: '#999' }}>No image</div>
                )}
              </div>

              <div className="results-edit-toolbar">
                <button
                  type="button"
                  className="results-edit-tool"
                  onClick={() => {
                    if (activeImageIndex == null) return;
                    setIsDirty(true);
                    setImages((prev) =>
                      prev.map((item, i) =>
                        i === activeImageIndex
                          ? {
                              ...item,
                              rotate: (((item.rotate + 270) % 360) as 0 | 90 | 180 | 270),
                            }
                          : item
                      )
                    );
                  }}
                  aria-label="Rotate left"
                >
                  Rotate Left
                </button>
                <button
                  type="button"
                  className="results-edit-tool"
                  onClick={() => {
                    if (activeImageIndex == null) return;
                    setIsDirty(true);
                    setImages((prev) =>
                      prev.map((item, i) =>
                        i === activeImageIndex
                          ? {
                              ...item,
                              rotate: (((item.rotate + 90) % 360) as 0 | 90 | 180 | 270),
                            }
                          : item
                      )
                    );
                  }}
                  aria-label="Rotate right"
                >
                  Rotate Right
                </button>
                <button
                  type="button"
                  className={`results-edit-tool ${activeMode === 'crop' ? 'is-active' : ''}`}
                  onClick={() => {
                    setActiveMode('crop');
                    resetCropSelectionFull();
                    lastCropInitKeyRef.current = '';
                    setCropWarning('');
                    setCropError('');
                  }}
                  aria-label="Crop"
                >
                  Crop
                </button>
                {hasActiveEdits && (
                  <button
                    type="button"
                    className="results-edit-tool"
                    onClick={() => {
                      if (activeImageIndex == null) return;
                      if (!originalImageSnapshot) return;
                      setIsDirty(true);
                      setImages((prev) =>
                        prev.map((item, i) => (i === activeImageIndex ? originalImageSnapshot : item))
                      );
                      resetCropUi();
                    }}
                    aria-label="Undo edits"
                  >
                    Undo
                  </button>
                )}
              </div>

              {activeMode === 'crop' && (
                <div className="results-edit-crop-actions">
                  <div className="results-edit-crop-status">
                    {cropError ? <div className="results-edit-crop-error">{cropError}</div> : null}
                    {isCropTooSmall ? (
                      <div className="results-edit-crop-warning is-danger">eBay requires at least 500px on the shortest side.</div>
                    ) : isCropUnderZoom ? (
                      <div className="results-edit-crop-warning">Under 1600px: eBay zoom may not be available.</div>
                    ) : null}
                    {cropWarning ? <div className="results-edit-crop-warning">{cropWarning}</div> : null}
                  </div>
                  <div className="results-edit-crop-buttons">
                    <button
                      type="button"
                      className="results-edit-cancel"
                      onClick={() => {
                        resetCropUi();
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="results-edit-cancel"
                      onClick={() => {
                        resetCropSelectionFull();
                        lastCropInitKeyRef.current = '';
                      }}
                    >
                      Fit
                    </button>
                    <button
                      type="button"
                      className="results-edit-apply"
                      disabled={isCropTooSmall}
                      onClick={() => {
                        if (activeImageIndex == null) return;
                        if (isCropTooSmall) {
                          setCropError('Crop must be at least 500px on the shortest side.');
                          return;
                        }
                        const dims = getDimsForImage(activeImage);
                        const px = getActivePixelCrop();
                        if (!dims) {
                          setCropError('Image size not ready yet, please wait 1 second and try again.');
                          return;
                        }
                        if (!px || px.width <= 0 || px.height <= 0) {
                          setCropError('Select a valid crop area.');
                          return;
                        }
                        const normalized = {
                          x: px.x / dims.width,
                          y: px.y / dims.height,
                          width: px.width / dims.width,
                          height: px.height / dims.height,
                        };
                        setIsDirty(true);
                        setImages((prev) =>
                          prev.map((item, i) =>
                            i === activeImageIndex
                              ? {
                                  ...item,
                                  crop: normalized,
                                }
                              : item
                          )
                        );
                        setIsEditImageLoading(true);
                        resetCropUi();
                      }}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showRebuildModal && (
          <div className="results-modal-backdrop">
            <div className="results-rebuild-modal">
              <div className="results-rebuild-header">
                <h3 style={{ margin: 0 }}>Rebuild Listing</h3>
                <button
                  type="button"
                  className="results-rebuild-close"
                  onClick={() => !rebuildLoading && setShowRebuildModal(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <label className="results-rebuild-label" htmlFor="rebuild-feedback">
                Feedback
              </label>
              <textarea
                id="rebuild-feedback"
                className="results-rebuild-textarea"
                placeholder="Tell us what to change..."
                value={rebuildFeedback}
                onChange={(e) => setRebuildFeedback(e.target.value)}
                rows={4}
                disabled={rebuildLoading}
              />
              <div className="results-rebuild-helper">
                <div>Examples:</div>
                <div>“Make title shorter and keyword-optimized”</div>
                <div>“Description should be more formal and include measurements”</div>
                <div>“Fill missing item specifics like material, style, color”</div>
              </div>


              {rebuildNotice ? <div className="results-rebuild-notice">{rebuildNotice}</div> : null}

              <div className="results-rebuild-footer">
                <button
                  type="button"
                  className="results-rebuild-secondary"
                  onClick={() => setShowRebuildModal(false)}
                  disabled={rebuildLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="results-rebuild-primary"
                  onClick={handleRebuildListing}
                  disabled={rebuildLoading || rebuildFeedback.trim().length < 10}
                >
                  {rebuildLoading ? 'Rebuilding…' : 'Rebuild'}
                </button>
              </div>
            </div>
          </div>
        )}

        {saveError && (
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
        )}

        {draftStatus && (
          <div style={{ marginTop: 8, fontSize: 14, color: draftStatus.toLowerCase().includes('fail') ? 'red' : '#2f855a' }}>
            {draftStatus}
          </div>
        )}
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
                    const orderedImages = getOrderedImageItems(images, mainImageIndex).map((img) =>
                      buildRotatedCloudinaryUrl(img.url, img.rotate, img.crop, getDimsForImage(img))
                    );
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
