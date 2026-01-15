import * as Sentry from '@sentry/node';

type SentryCtx = {
  operation?: string;
  requestId?: string;
  workspace_id?: string | null;
  listing_id?: string | null;
  tags?: Record<string, string>;
  extras?: Record<string, unknown>;
};

let didInit = false;

function initIfNeeded() {
  if (didInit) return;
  didInit = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    Sentry.init({ dsn });
  } catch {
    // no-op
  }
}

export function sentryWithScope(fn: (scope: Sentry.Scope | null) => void) {
  try {
    initIfNeeded();
    if (!process.env.SENTRY_DSN) return;

    Sentry.withScope((scope) => {
      try {
        fn(scope);
      } catch {
        // no-op
      }
    });
  } catch {
    // no-op
  }
}

export function sentryCaptureException(err: unknown, ctx?: SentryCtx) {
  try {
    initIfNeeded();
    if (!process.env.SENTRY_DSN) return;

    Sentry.withScope((scope) => {
      try {
        if (ctx?.operation) scope.setTag('operation', String(ctx.operation));
        if (ctx?.requestId) scope.setTag('requestId', String(ctx.requestId));
        if (ctx?.workspace_id != null) scope.setExtra('workspace_id', ctx.workspace_id);
        if (ctx?.listing_id != null) scope.setExtra('listing_id', ctx.listing_id);

        if (ctx?.tags) {
          for (const [k, v] of Object.entries(ctx.tags)) scope.setTag(k, String(v));
        }

        if (ctx?.extras) {
          for (const [k, v] of Object.entries(ctx.extras)) scope.setExtra(k, v);
        }

        Sentry.captureException(err);
      } catch {
        // no-op
      }
    });
  } catch {
    // no-op
  }
}
