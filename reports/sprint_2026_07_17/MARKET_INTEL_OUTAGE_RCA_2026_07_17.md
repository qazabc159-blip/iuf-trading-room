# Market Intel Iframe Outage — RCA + Fix (2026-07-17)

Owner: Jason (backend-strategy lane, dispatched cross-lane for this P0 by Elva)
Fix PR: https://github.com/qazabc159-blip/iuf-trading-room/pull/1292 (branch `fix/market-intel-outage-timeout-jason-20260717`)

## 1. Symptom

`GET https://app.eycvector.com/api/ui-final-v031/market-intel` (Next.js SSR route in `apps/web`,
serves the `/market-intel` page's iframe content) hangs indefinitely — Elva's direct authenticated
curl (owner cookie) got no response after 70s (curl exit 000). Users see a permanently blank Market
Intel iframe. All-team merge blocked by the corresponding `market-intel.spec.ts` Playwright smoke
test failing identically across 3+ unrelated PRs.

## 2. Reproduction Evidence

| Request | Auth | Result |
|---|---|---|
| `app.eycvector.com/api/ui-final-v031/market-intel` | owner cookie | **70s+ hang, curl 000** |
| `app.eycvector.com/market-intel` (page shell) | owner cookie | 200 / 0.45s |
| `api.eycvector.com/api/v1/market-intel/news-top10` | owner cookie | 200 / 0.3s |
| `api.eycvector.com/auth/me` (x8 concurrent) | owner cookie | 200 / 0.33s each |
| `app.eycvector.com/api/ui-final-v031/market-intel` | **none** (this session's own repro) | 200 / 0.65s |

The unauthenticated hit to the same broken route returned fast — consistent with all 5 of its
upstream backend calls failing the global session-auth gate immediately (401, no further work),
while a fully authenticated request proceeds into the real aggregation logic where the hang lives.
This narrowed the defect to something inside the SSR route's own upstream-fetch orchestration, not
the page shell, not `news-top10` alone, and not the session/auth layer itself (confirmed healthy by
the concurrent `auth/me` probes).

## 3. Code-Level Root Cause

`apps/web/app/api/ui-final-v031/[screen]/route.ts` → `buildFinalV031LivePayload("market-intel")` →
`buildMarketIntelPayload()` (`apps/web/lib/final-v031-live.ts`):

```ts
const [newsResult, announcementsResult, finMindResult, heatmapResult, institutionalResult] =
  await Promise.allSettled([
    getNewsTop10(),
    getMarketIntelAnnouncements({ days: 30, limit: 20, scope: "market" }),
    getFinMindStatus(),
    getTwseMarketHeatmap(),
    getMarketInstitutionalSummary(),
  ]);
```

All 5 helpers go through `apps/web/lib/api.ts`'s shared `request()`/`requestRaw()` — **neither
passes an `AbortSignal`**, so a single stuck upstream `fetch()` blocks its own promise forever.
`Promise.allSettled` still doesn't resolve until *every* input settles (fulfilled or rejected) — a
single never-settling entry blocks the whole aggregation, and therefore the whole HTTP response,
indefinitely.

By contrast, every external-provider fetch on the API-service side that these 5 endpoints eventually
touch (FinMind aggregate client, TWSE OpenAPI client) already has its own `AbortSignal.timeout`
(5s/15s/25s depending on endpoint) from prior hardening rounds — so this specific gap was isolated to
the web service's SSR aggregation layer, which had never had an equivalent bound.

**Exact upstream culprit not pinned down.** All 5 backend endpoints require session auth at a global
gate (confirmed: unauthenticated curls to each returned 401 in ~0.3s), so an unauthenticated probe
can't distinguish which one hangs only under a real, authenticated request. This agent has no prod
login credentials to reproduce the authenticated path directly. What *is* ruled out by code reading:
- `getNewsTop10` → confirmed fast by Elva's own direct authenticated curl.
- `getMarketInstitutionalSummary` → backend's FinMind fetch already `AbortSignal.timeout(15000)`.
- `getTwseMarketHeatmap` → all backend TWSE/FinMind fetches in its call chain already
  `AbortSignal.timeout`-bounded (5-25s) per `data-sources/twse-openapi-client.ts` and
  `finmind-aggregate-client.ts`.
- `getMarketIntelAnnouncements` → pure DB reads (no external fetch) with `LIMIT`-bounded queries.
- `getFinMindStatus` → in-memory stats + bounded DB count queries, no live external call at all.

Given every *backend* external call is independently bounded already, a hang exceeding those bounds
most plausibly means either (a) the backend API service's own event loop was itself running behind
schedule at the time (so even a correctly-coded `AbortSignal.timeout()` callback fires late — this
would explain why a purely code-level audit finds every call "already bounded" yet a live hang still
occurs), or (b) a DB-layer stall on the API service side (this agent's earlier, unrelated RCA for the
same day found `/auth/me`'s DB-bound session lookup showing `time:-1` in a Playwright trace network
log from ~13 hours earlier — a different service snapshot, not confirmed to be the same live cause,
but consistent with a DB-pool-pressure hypothesis). **This agent does not have access to live
Postgres connection-pool telemetry or API-service event-loop-lag metrics** to confirm which; that is
the natural next diagnostic step for whoever has Railway/DB introspection access.

## 4. Timing Correlation with the bafd1025 Deploy Batch — Ruled Out

Elva's corrected timeline: 10:58 UTC last-known-green Playwright → 11:59 UTC deploy of `bafd1025`
(`#1286` company-page-v3 + `#1287` login/register-v3, same batch) → 13:57 UTC onset of the outage
(~2h after that deploy).

```
git diff --stat e20e1f195587314749ee84160aa3b9d06990fb4b^..bafd1025b8ffa3b07d3b5714480f5c992f250af2
```

Full file list touched by both PRs combined: `apps/web/app/companies/[symbol]/*`,
`apps/web/app/login/page.tsx`, `apps/web/app/register/page.tsx`, `apps/web/app/globals.css`,
2 Playwright specs, 4 design/report docs. **Zero files** under `apps/web/lib/`,
`apps/web/app/api/ui-final-v031/`, or any middleware. `#1286`'s own PR body claim of "zero data-layer
touch" holds up under this diff audit — this deploy did not introduce the bug's trigger.

The ~2-hour delay between the 11:59 UTC deploy and the 13:57 UTC outage onset is also inconsistent
with "this deploy's code caused it" (a code-introduced bug would manifest at or shortly after
restart, not 2 hours later) and more consistent with a state that degrades over time post-restart —
e.g. a resource that starts fresh at boot and exhausts/degrades gradually (matching the DB-pool or
event-loop-lag hypotheses in §3), or an external-condition change unrelated to any IUF deploy
entirely. Neither can be confirmed without live telemetry this agent does not have.

## 5. Fix Shipped (this PR)

`apps/web/lib/final-v031-live.ts`: wrap each of the 5 `buildMarketIntelPayload()` upstream calls in
a local `withTimeout(promise, 20_000, label)` (`Promise.race` against a `setTimeout` rejection). A
stuck call now resolves as an already-handled `Promise.allSettled` "rejected" entry — every
downstream consumer in this function already falls back to `null`/empty-array per source on
rejection (no fake data substituted, consistent with the "抓不到不呈現" product rule).

Deliberately scoped to only this route's 5 call sites, not the shared `request()`/`requestRaw()`
helpers (which ~100+ other call sites across the app also use) — under P0 time pressure, the smaller
blast radius was preferred. Applying the same timeout discipline to the shared helpers (and to the
`strategy-ideas`/`paper-trading-room` screens' equivalent `Promise.all`/`allSettled` fan-outs, which
have the same latent structural gap) is a reasonable non-urgent follow-up, not done here.

This bound is enforced by the **web service's own process/event loop** — independent of whatever is
actually stalling on the API-service side, so it holds even under the "API service's own timers are
running late" hypothesis from §3.

## 6. Verification

- `pnpm --filter @iuf-trading-room/web typecheck` — clean.
- `pnpm --filter @iuf-trading-room/web test` — 84 files / 682 tests, all green (no existing test
  exercises `buildMarketIntelPayload` directly — this fix has no direct unit-test coverage of the new
  timeout behavior itself, only typecheck + full existing regression suite).
- Natural end-to-end verification: PR #1292's own CI Playwright P0 Smoke run (which exercises
  `market-intel.spec.ts` against this exact route) — see PR for live result.

## 7. Open Items / Handback

1. **Root cause of the hang itself is not pinned to a single upstream endpoint** — this fix stops the
   user-visible symptom (blank iframe / CI red) but does not diagnose *why* the underlying call is
   slow in the first place. If the timeout starts firing frequently in practice (visible via
   `console.warn`/error monitoring once this ships), that's a live signal something is still degraded
   upstream and needs the DB-pool/event-loop-lag telemetry check from §3.
2. Recommend a follow-up PR (non-P0) to apply the same timeout discipline to `request()`/
   `requestRaw()` at the shared-helper level, and to `strategy-ideas`/`paper-trading-room` screens'
   equivalent fan-outs, which have the identical latent gap.
3. Post-merge, re-curl `https://app.eycvector.com/api/ui-final-v031/market-intel` with a real owner
   cookie to confirm the route now returns (successfully or with partial-fallback data) well under
   20s instead of hanging.
