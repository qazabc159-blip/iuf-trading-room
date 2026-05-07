# Observability Layer — P0-1 + P0-2 Sprint Evidence
Date: 2026-05-07
Branch: feat/api-y23-cleanup-plus-observability-layer-2026-05-07

## Architecture

### Sentry SDK (apps/api)
- Module: `apps/api/src/sentry-init.ts`
- Init guard: `SENTRY_DSN` env absent or empty → SDK NOT initialised; all `captureException/captureMessage` calls are safe no-ops
- `sendDefaultPii: false` — never captures user PII
- `tracesSampleRate: 0.1` — 10% performance sampling (cost control)
- Two exports for use in server.ts: `captureException(err, context?)`, `captureMessage(msg, level?, tags?)`

### Sentry SDK (apps/web)
- File: `apps/web/instrumentation.ts` (Next.js Instrumentation hook)
- Loaded once per runtime (nodejs + edge)
- Same DSN guard: SENTRY_DSN absent → early return, no init
- Works without `withSentryConfig` wrapper (optional in Sentry v8+)

### Health Watchdog Cron (apps/api, startSchedulers)
- Interval: every 30 min (WATCHDOG_INTERVAL_MS)
- On each tick: logs heap/rss/uptime, then fires `setImmediate` to measure event-loop lag
- Lag > 5000ms → consecutive fail counter increment + warn log
- Consecutive fails >= WATCHDOG_FAIL_THRESHOLD (env default 2) → `captureMessage` to Sentry
- Counter resets to 0 on any lag-free tick
- Targets the 5/7 502 pattern (event-loop pressure under peak OHLCV sync)

### Email Digest Fail Webhook (apps/api, startSchedulers)
- Wraps `runEmailDigestTick()` with `.then()` to inspect result
- `reason.startsWith("resend_http_")` → Sentry `captureMessage` (warning) — Resend 4xx/5xx
- `reason.startsWith("resend_error:")` → Sentry `captureException` (error) — network error
- Unhandled rejection → `captureException` (error)

### Pipeline Fail Alert (apps/api, startSchedulers)
- Wraps all 3 pipeline phases (pre_market, close_watch, close_brief) with success/fail handlers
- `handlePipelineFail(phase, err)`: increments `_pipelineConsecutiveFails[phase]`
- Consecutive fails >= PIPELINE_FAIL_THRESHOLD (env default 3) → `captureException` to Sentry
- `handlePipelineSuccess(phase)`: resets counter to 0

### Audit-Stats Endpoint
- `GET /api/v1/internal/observability/audit-stats?since=24h`
- Auth: Owner only
- since= accepts: 1h / 6h / 12h / 24h (default) / 48h
- Returns: `{ ai_approved, ai_rejected, hallucination_reject, adversarial_intercept, paper_submit, paper_submit_rejected, total, windowHours, since, db_available }`
- DB unavailable → graceful zero counts (no 500)
- Single GROUP BY query on audit_logs table

## DSN Env Runbook (楊董 set in Railway)

1. Create a Sentry project at https://sentry.io (Node.js project type for API; Next.js for web)
2. Copy the DSN from Project Settings → Client Keys → DSN
3. In Railway: Service → Variables → Add `SENTRY_DSN=<dsn_value>`
4. Redeploy (auto-deploys via GitHub Actions on push to main)
5. Verify: after deploy, check Railway logs for `[sentry] Initialised (DSN configured)`
6. Test alert: in Railway shell or via API: `curl -X POST .../api/v1/internal/openalice/email-digest/trigger -H "Cookie: iuf_session=..."` with force:true, verify Sentry receives event

WATCHDOG_FAIL_THRESHOLD and PIPELINE_FAIL_THRESHOLD are optional Railway env vars (defaults: 2, 3).

## Alert Targets
- Email digest Resend HTTP 4xx/5xx → Sentry warning
- Email digest network error → Sentry error
- Event-loop lag >= 5s for 2+ consecutive watchdog ticks (60min) → Sentry error
- Pipeline phase consecutive fail >= 3 (45min) → Sentry exception

## Smoke Evidence (local)

```
typecheck: PASS (apps/api + apps/web — 0 new errors introduced)
tests: 166/166 PASS (+6 new tests)
  - sentry-init: isSentryEnabled=false when SENTRY_DSN absent
  - sentry-init: captureException no-op does not throw
  - sentry-init: captureMessage no-op does not throw
  - Y2: payloadSummary SENSITIVE_KEY_PATTERN covers all required key types
  - Y3: announcements outcome→SourceHealthState mapping correct (no fake-green)
  - audit-stats: time window parsing + unknown-window default
```

## Y2 Fix (alerts/page.tsx)
- Added `SENSITIVE_KEY_PATTERN` regex covering: token, session, cookie, auth-header, authorization, bearer, api_key, secret, password, passwd, credential
- `redactValue(key, v)`: key match → `[REDACTED]`; JWT shape detection (3-part base64url) → `[REDACTED]`
- `payloadSummary` now calls `redactValue` for all primitive values
- Lane-A security: raw token/session/cookie never surfaced in alert UI

## Y3 Fix (companies/[symbol]/page.tsx)
- Added server-side probe: `getCompanyAnnouncements(company.id, { days: 30 })` — lightweight, fail-soft
- Result mapped to `AnnouncementsSourceState`: live/empty/degraded/error
- `buildSourceStatus` extended with `announcementsSource` param (5th arg)
- twse-announcements SourceStatusCard badge: live/stale/error — never hardcoded `"stale"`
- PR #265 degraded envelope (`state="DEGRADED"`) detected and surfaced as error state
- AnnouncementsPanel still does its own client-side fetch for rendering (unchanged)
