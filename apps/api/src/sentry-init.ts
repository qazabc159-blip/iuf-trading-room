/**
 * sentry-init.ts
 *
 * Sentry SDK initialisation for apps/api (Node.js / Hono).
 *
 * DSN is read from SENTRY_DSN env var.
 * - SENTRY_DSN absent or empty  → Sentry is NOT initialised; all capture*()
 *   calls are safe no-ops (SDK guard).
 * - SENTRY_DSN present          → SDK init runs once at module load.
 *
 * Never hard-code DSN in source. Operator sets via Railway env var.
 *
 * Usage:
 *   import "./sentry-init.js";
 *   import * as Sentry from "@sentry/node";
 *   Sentry.captureException(err);   // no-op if DSN absent
 *
 * Security: DSN is a public endpoint (not a secret), but still loaded from env
 * to avoid hard-coding deployment-specific config.
 */

import * as Sentry from "@sentry/node";

const dsn = process.env["SENTRY_DSN"] ?? "";

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env["NODE_ENV"] ?? "production",
    // Capture 10% of transactions for performance monitoring (keep cost low)
    tracesSampleRate: 0.1,
    // Never capture user PII — trading app handles financial data
    sendDefaultPii: false,
  });
  console.info("[sentry] Initialised (DSN configured)");
} else {
  console.info("[sentry] No SENTRY_DSN — running without error tracking (no-op mode)");
}

/**
 * Capture an exception with optional context tags.
 * Safe no-op when Sentry is not initialised.
 */
export function captureException(
  err: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }
): void {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [k, v] of Object.entries(context.tags)) {
        scope.setTag(k, v);
      }
    }
    if (context?.extra) {
      for (const [k, v] of Object.entries(context.extra)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(err);
  });
}

/**
 * Capture a custom message event.
 * Safe no-op when Sentry is not initialised.
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "warning",
  tags?: Record<string, string>
): void {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    if (tags) {
      for (const [k, v] of Object.entries(tags)) {
        scope.setTag(k, v);
      }
    }
    Sentry.captureMessage(message, level);
  });
}

/** True when Sentry DSN is configured and SDK is active. */
export const isSentryEnabled = Boolean(dsn);
