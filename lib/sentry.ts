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

  const environment = String(process.env.VERCEL_ENV || process.env.NODE_ENV || 'development');
  const release = process.env.VERCEL_GIT_COMMIT_SHA ? String(process.env.VERCEL_GIT_COMMIT_SHA) : undefined;

  try {
    Sentry.init({
      dsn,
      environment,
      release,
    });
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

export function sentryCaptureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', ctx?: SentryCtx) {
  try {
    initIfNeeded();
    if (!process.env.SENTRY_DSN) return;

    Sentry.withScope((scope) => {
      try {
        if (ctx?.operation) scope.setTag('operation', String(ctx.operation));
        if (ctx?.requestId) scope.setTag('requestId', String(ctx.requestId));
        if (ctx?.workspace_id != null) scope.setTag('workspace_id', String(ctx.workspace_id));
        if (ctx?.listing_id != null) scope.setTag('listing_id', String(ctx.listing_id));

        if (ctx?.tags) {
          for (const [k, v] of Object.entries(ctx.tags)) scope.setTag(k, String(v));
        }
        if (ctx?.extras) {
          for (const [k, v] of Object.entries(ctx.extras)) scope.setExtra(k, v);
        }

        // Level mapping handled by SDK; default "info".
        Sentry.captureMessage(String(message || ''), level);
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

        // Prefer tags for queryability
        if (ctx?.workspace_id != null) scope.setTag('workspace_id', String(ctx.workspace_id));
        if (ctx?.listing_id != null) scope.setTag('listing_id', String(ctx.listing_id));

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
