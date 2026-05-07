/**
 * instrumentation.ts — Next.js Instrumentation Hook
 *
 * Loaded once per runtime (Node.js server + Edge runtime).
 * Initialises Sentry from SENTRY_DSN env var.
 * DSN absent or empty → no-op (graceful degradation).
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  const dsn = process.env["SENTRY_DSN"] ?? "";
  if (!dsn) return; // No-op if DSN not configured

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { init } = await import("@sentry/nextjs");
    init({
      dsn,
      environment: process.env["NODE_ENV"] ?? "production",
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const { init } = await import("@sentry/nextjs");
    init({
      dsn,
      environment: process.env["NODE_ENV"] ?? "production",
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  }
}
