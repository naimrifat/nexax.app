export type EbayFetchCtx = {
  requestId?: string;
  operation?: string;
};

export type EbayFetchMeta = {
  attempts: number;
  retryExhausted: boolean;
};

export type EbayFetchResult = {
  ok: boolean;
  status: number;
  text: string;
  json: any;
  meta: EbayFetchMeta;
};

export class EbayHttpError extends Error {
  statusCode: number;
  hint?: 'timeout' | 'network_error';

  constructor(message: string, statusCode: number, hint?: 'timeout' | 'network_error') {
    super(message);
    this.name = 'EbayHttpError';
    this.statusCode = statusCode;
    this.hint = hint;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeParseJson(text: string) {
  const t = String(text || '').trim();
  if (!t) return {};
  if (!(t.startsWith('{') || t.startsWith('['))) return {};
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

/**
 * eBay HTTP wrapper with:
 * - timeout (default 15s)
 * - deterministic retries for 429/5xx (max 2)
 *
 * This function never logs headers or tokens.
 */
export async function ebayFetch(
  url: string,
  options: RequestInit,
  ctx: EbayFetchCtx,
  cfg?: { timeoutMs?: number; maxRetries?: number; backoffMs?: number[] }
): Promise<EbayFetchResult> {
  const timeoutMs = typeof cfg?.timeoutMs === 'number' ? cfg.timeoutMs : 15000;
  const maxRetries = typeof cfg?.maxRetries === 'number' ? cfg.maxRetries : 2;
  const backoffMs = Array.isArray(cfg?.backoffMs) && cfg.backoffMs.length ? cfg.backoffMs : [500, 1500];

  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text().catch(() => '');
      const json = safeParseJson(text);

      const retryable = isRetryableStatus(res.status);
      const retriesRemaining = attempt < maxRetries;

      if (!res.ok && retryable && retriesRemaining) {
        const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 500;
        attempt += 1;
        await sleep(delay);
        continue;
      }

      return {
        ok: res.ok,
        status: res.status,
        text,
        json,
        meta: { attempts: attempt + 1, retryExhausted: !res.ok && retryable && !retriesRemaining },
      };
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || String(e?.message || '').toLowerCase().includes('aborted');

      if (isAbort) {
        if (attempt < maxRetries) {
          const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 500;
          attempt += 1;
          await sleep(delay);
          continue;
        }

        throw new EbayHttpError(
          `eBay request timed out (${timeoutMs}ms) for ${ctx?.operation || 'operation'}`,
          504,
          'timeout'
        );
      }

      throw new EbayHttpError(
        `eBay request failed for ${ctx?.operation || 'operation'}`,
        502,
        'network_error'
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
