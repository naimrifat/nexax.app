type ClassifyInput = {
  statusCode?: number;
  ebayPayload?: any;
  fallbackMessage?: string;
  errorCode?: string;
};

type Classified = {
  httpStatus: number;
  code: string;
  message: string;
  errors?: string[];
};

function toTextParts(payload: any, fallbackMessage: string) {
  const parts: string[] = [];
  if (fallbackMessage) parts.push(fallbackMessage);

  if (payload) {
    if (typeof payload.error === 'string') parts.push(payload.error);
    if (typeof payload.error_description === 'string') parts.push(payload.error_description);
    if (typeof payload.message === 'string') parts.push(payload.message);

    const errs = Array.isArray(payload.errors) ? payload.errors : [];
    for (const e of errs) {
      if (e && typeof e === 'object') {
        if (typeof e.message === 'string') parts.push(e.message);
        if (typeof e.longMessage === 'string') parts.push(e.longMessage);
        if (typeof e.errorId === 'string' || typeof e.errorId === 'number') parts.push(String(e.errorId));
      } else if (typeof e === 'string') {
        parts.push(e);
      }
    }
  }

  return parts.filter(Boolean);
}

function sanitizeUserLine(s: any): string {
  const raw = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
}

function uniqueLimited(arr: string[], limit = 8) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    const v = sanitizeUserLine(s);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

export function classifyEbayError(input: ClassifyInput): Classified {
  const statusCode = typeof input.statusCode === 'number' ? input.statusCode : undefined;
  const fallbackMessage = String(input.fallbackMessage || '');
  const errorCode = String(input.errorCode || '');
  const payload = input.ebayPayload;

  const parts = toTextParts(payload, fallbackMessage);
  const haystack = parts.join(' | ').toLowerCase();

  // A) Reconnect required
  const looksLikeInvalidGrant =
    errorCode === 'EBAY_INVALID_GRANT' ||
    haystack.includes('invalid_grant') ||
    haystack.includes('revoked') ||
    haystack.includes('authorization expired') ||
    haystack.includes('please reconnect ebay');

  if (looksLikeInvalidGrant) {
    return {
      httpStatus: 401,
      code: 'EBAY_RECONNECT_REQUIRED',
      message: 'eBay connection expired. Please reconnect eBay.',
      errors: [],
    };
  }

  // D) Retryable/system
  if (statusCode === 429) {
    return {
      httpStatus: 429,
      code: 'EBAY_RETRYABLE_ERROR',
      message: 'Temporary eBay rate limit. Try again shortly.',
      errors: [],
    };
  }

  if (typeof statusCode === 'number' && statusCode >= 500) {
    return {
      httpStatus: 502,
      code: 'EBAY_RETRYABLE_ERROR',
      message: 'Temporary eBay error. Try again later.',
      errors: [],
    };
  }

  // B) Listing fix required
  const listingKeywords = [
    'aspect',
    'required',
    'invalid value',
    'invalid',
    'category',
    'itemspecific',
    'item specifics',
    'condition',
    'price',
    'quantity',
    'policy id',
    'shipping policy',
    'payment policy',
    'return policy',
  ];

  const looksLikeListingFix =
    (statusCode === 400 || statusCode === 422) && listingKeywords.some((k) => haystack.includes(k));

  if (looksLikeListingFix) {
    const errs = Array.isArray(payload?.errors) ? payload.errors : [];
    const userSafe = uniqueLimited(
      errs.flatMap((e: any) => [e?.message, e?.longMessage]).filter(Boolean),
      8
    );

    return {
      httpStatus: 422,
      code: 'EBAY_LISTING_FIX_REQUIRED',
      message: 'Fix listing details before publishing.',
      errors: userSafe.length ? userSafe : [],
    };
  }

  // C) Account setup required
  const accountKeywords = [
    'not eligible',
    'business policy',
    'payout',
    'seller account',
    'shipping policy not found',
    'payment',
    'payments not set up',
    'restricted',
  ];

  const looksLikeAccountSetup = accountKeywords.some((k) => haystack.includes(k));

  if (looksLikeAccountSetup) {
    return {
      httpStatus: statusCode === 422 ? 422 : 403,
      code: 'EBAY_ACCOUNT_SETUP_REQUIRED',
      message: 'Your eBay account requires setup before publishing.',
      errors: [],
    };
  }

  // E) Default
  return {
    httpStatus: 502,
    code: 'EBAY_ERROR',
    message: 'eBay returned an error.',
    errors: [],
  };
}
