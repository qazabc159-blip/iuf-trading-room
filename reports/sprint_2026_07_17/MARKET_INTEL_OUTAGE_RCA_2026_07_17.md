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

## 7. Open Items / Handback (superseded by §8 for the API-service root cause)

1. Recommend a follow-up PR (non-P0) to apply the same timeout discipline to `request()`/
   `requestRaw()` at the shared-helper level, and to `strategy-ideas`/`paper-trading-room` screens'
   equivalent fan-outs, which have the identical latent gap.
2. Post-merge, re-curl `https://app.eycvector.com/api/ui-final-v031/market-intel` with a real owner
   cookie to confirm the route now returns (successfully or with partial-fallback data) well under
   20s instead of hanging.

---

## 8. API-Service Root Cause Found — `isTwTradingDay()`, Shared Across 3 Independently-Reported Hangs

Fix PR #2: https://github.com/qazabc159-blip/iuf-trading-room/pull/1294 (branch
`fix/quote-cold-cache-family-timeout-jason-20260717`) — separate from #1292, merges independently.

### 8.1 Elva closed the gap §3 left open

Elva reproduced with a real owner cookie directly against the API service (bypassing the web-layer
timeout fix in #1292 entirely, hitting `api.eycvector.com` itself):

| Endpoint | Auth | Result |
|---|---|---|
| `/api/v1/market-intel/news-top10` | owner cookie | 200 / 0.33s |
| `/api/v1/market-intel/announcements` | owner cookie | 200 / 0.33s |
| `/api/v1/data-sources/finmind/status` | owner cookie | 200 / 0.83s |
| `/api/v1/market/institutional-summary/finmind` | owner cookie | 200 / 1.12s |
| **`/api/v1/market/heatmap/twse`** | owner cookie | **40s, no response** |
| **`/api/v1/market/heatmap/kgi-core`** | owner cookie | **40s, no response** |

Separately, Jim (working on the company-page empty-state redesign) independently hit the same class
of failure on **`GET /api/v1/companies/:id/quote/realtime`** (90s+, no response — had to route around
it with a temporary local proxy to keep working). Three independently-discovered hangs, by two
different people, on two different features, converging on the same endpoint family.

This confirms §3's hypothesis (the two heatmap endpoints, not `news-top10`, are the actual API-service
hang) and extends the blast radius to a third endpoint (`quote/realtime`) that also matters directly
(company page quote widget) and was previously unrecognized as part of the same incident.

### 8.2 Root Cause: `isTwTradingDay()` — one unbounded, uncached DB call on all 3 endpoints' shared path

`apps/api/src/lib/trading-calendar.ts`'s `isTwTradingDay(tradingDate)` ran a raw `db.execute()` query
with **zero timeout and zero caching**, guarded only by a bare `try/catch` that returns `true`
(fail-open) on any *rejected* promise. A `try/catch` does not help when the awaited call hangs rather
than rejects — and Postgres pool queueing (via `postgres-js`) has no default acquire-timeout: the
package's own `connect_timeout` config (see `packages/db/src/client.ts`) only bounds establishing a
*new* physical connection, not queueing for one when the pool (`max: 10-20`) is already saturated. If
the pool is under pressure for any reason, this specific query queues forever with nothing to bound it.

This single function sits on **all three** reported endpoints' call chain:

- **`heatmap/twse`** and **`quote/realtime`** both reach it via `getStockDayAllRows()`'s STOCK_DAY_ALL
  self-heal branch (`twse-openapi-client.ts`), which fires whenever the primary EOD feed's date looks
  stale relative to a confirmed real trading day — a condition already on record as a *recurring* TWSE
  OpenAPI publish-lag issue (see the 2026-07-13/07-14 "upstream stuck" incidents referenced in that
  file's own comments), and exactly the state a fresh post-restart cache-miss is likely to land in.
- **`heatmap/kgi-core`** additionally calls it **unconditionally on every single request** via
  `_isKgiHeatmapAfterHours()` — not gated behind any stale-feed condition at all, which is why this
  endpoint hangs consistently rather than intermittently.

Everything else these three endpoints touch was already properly bounded from prior hardening rounds:
FinMind aggregate client (`AbortSignal.timeout` 15s), TWSE OpenAPI client's other fetches (5-25s), and
the KGI quote client's subscribe/tick calls (`AbortController` + `setTimeout`, plus an
`isKgiGatewayScheduledOff()` fast-path that already existed specifically to avoid burning timeouts
when the gateway is off-schedule). `isTwTradingDay()`'s DB call was the one piece nothing had ever
bounded — and being the one common thread across three independently-discovered hangs is strong
evidence this is the actual root cause, not merely "a" plausible candidate.

### 8.3 Fix

`apps/api/src/lib/trading-calendar.ts`:
1. Race the query against a 3s timeout (`Promise.race` vs `setTimeout` rejection) — a stuck pool now
   degrades to the function's own pre-existing fail-open path (assume trading day) instead of hanging
   every caller indefinitely.
2. Cache the result per calendar date — a date's trading-day status can never change once queried, so
   this removes the redundant repeat-query load `_isKgiHeatmapAfterHours()` was placing on the pool by
   querying on literally every `kgi-core` request. Timeout/degraded reads are deliberately **not**
   cached (a transient failure shouldn't pin a possibly-wrong answer for the rest of the process
   lifetime); only a genuine successful read is cached.

`apps/api/src/server.ts` (`/api/v1/market/heatmap/kgi-core` handler): hardened its own two direct DB
calls (the `quote_last_close` Tier-2.5 after-hours fallback, and the sector/`chain_position` lookup)
with the same `Promise.race`-timeout pattern — both already had a fail-open `try/catch`, same gap (a
catch doesn't fire on a hang, only on a rejection).

### 8.4 Complete Causal Chain (as requested)

```
12:00 UTC web-service (and/or api-service) restart / redeploy
  -> in-memory quote/heatmap caches wiped (known pitfall, see repo CLAUDE.md:
     "deploy 重啟會洗掉 in-memory quote store")
  -> first post-restart request to heatmap/twse, heatmap/kgi-core, or
     quote/realtime is a genuine cache-miss, must rebuild from upstream
  -> STOCK_DAY_ALL (or heatmap/kgi-core's unconditional after-hours check)
     triggers isTwTradingDay() -> raw, unbounded, uncached db.execute()
  -> DB connection pool under pressure at the time (exact pool-saturation
     root cause not independently confirmed -- no live Postgres telemetry
     access from this agent; possibly related to, but not confirmed as, the
     same condition behind the earlier /auth/me hang traced in a different
     RCA the same day) -> query queues with no acquire-timeout -> hangs
  -> getStockDayAllRows() / _isKgiHeatmapAfterHours() never resolve
  -> heatmap/twse, heatmap/kgi-core, quote/realtime all hang indefinitely
  -> apps/web's buildMarketIntelPayload() (which calls heatmap/twse via a
     different upstream path) inherits the hang through its own missing
     per-call timeout (fixed independently in PR #1292)
  -> market-intel SSR route hangs -> iframe permanently blank
  -> market-intel.spec.ts Playwright smoke test times out identically
     across every concurrently-open PR -> ~12+ hours of cross-PR CI red,
     all-team merge blocked
```

### 8.5 Verification

- `pnpm --filter @iuf-trading-room/api typecheck` — clean.
- `pnpm test` (full apps/api suite) — 1863/1863, same 2 pre-existing
  `finmind-client.test.ts` failures reproduced identically on bare `main` via `git stash` (confirmed
  unrelated to this change — not a regression).
- Acceptance criteria per Elva: `heatmap/twse` and `heatmap/kgi-core` <3s response (can be an honest
  empty/degraded state, never fake data or a hang); `companies/:id/quote/realtime` <3s; homepage
  heatmap shows real fallback data after-hours, not blank. **Pending live owner-cookie re-verification
  post-merge** — this agent cannot authenticate against prod directly.

### 8.6 Residual Open Item

The *exact* cause of the DB connection pool being under pressure at the specific moment these hangs
were observed is still not independently confirmed by this agent (see §9.4) — but Elva independently
confirmed the actual wedge mechanism after #1292 deployed (§9), which supersedes the "ongoing pool
pressure" framing below: this was a one-time, self-inflicted wedge that a restart fully clears, not a
sustained degraded state. `resolveCompany()` (used by `quote/realtime` and effectively every
company-scoped endpoint app-wide) has the same class of unbounded-DB-call risk and was deliberately
left untouched in this fix — it sits outside the specific 3-endpoint chain this round proved, and
bounding every DB call across the codebase is a larger, separate exercise.

---

## 9. Definitive Root Cause — In-Flight Promise Memoization Wedge (confirmed via restart recovery)

Fix PR #3 (same PR as §8, `#1294`) — additional commit on `fix/quote-cold-cache-family-timeout-jason-20260717`.

### 9.1 The evidence that pinned the exact mechanism

After PR #1292 merged and deployed (restarting the API service), Elva re-tested all three endpoints
and found **all three had recovered instantly**, with no code change to the API service at that
point (only the web-layer #1292 fix had shipped):

| Endpoint | Post-restart result |
|---|---|
| `/api/v1/market/heatmap/twse` | 1.2s |
| `/api/v1/market/heatmap/kgi-core` | 0.3s |
| `/api/v1/companies/2330/quote/realtime` | 1.8s |

A restart instantly fixing all three, with zero API-service code change, rules out "the DB pool is
persistently overloaded" as the standing explanation and instead points at **module-level state that
only a process restart clears** — i.e. exactly the shape of a wedged in-flight-promise singleton, not
an ongoing resource-pressure condition.

### 9.2 The mechanism

`apps/api/src/data-sources/twse-openapi-client.ts`'s `getStockDayAllRows()` — the exact function all
three endpoints share (§8.2) — has an in-flight-request-dedup pattern:

```ts
if (_stockDayAllInflight) return _stockDayAllInflight;
...
_stockDayAllInflight = (async () => { try { ... } catch { ... } finally { _stockDayAllInflight = null; } })();
return _stockDayAllInflight;
```

`_stockDayAllInflight` is a **module-level singleton** — every concurrent caller across the entire
process (all 3 endpoints, any number of concurrent requests) receives and awaits the exact same
promise reference. Its cleanup (`_stockDayAllInflight = null`) lives in a `finally` block, which by
definition only executes once the promise **settles** (resolves or rejects) — it does not run while
the promise is still pending.

Before this fix, the only thing awaited inside that async IIFE that had **no bound at all** was
`isTwTradingDay()`'s raw `db.execute()` (§8.2, already fixed earlier on this branch). If that specific
query hung (rather than erroring) even once, the whole async IIFE never settled, its `finally` never
ran, and `_stockDayAllInflight` stayed pointed at a permanently-pending promise **for the rest of the
process's life** — every subsequent call to `getStockDayAllRows()`, from any of the 3 endpoints, for
any symbol, from any request, simply returned that same forever-pending promise. This is why all three
endpoints hung *together*, *consistently* (not intermittently), and why nothing but a full process
restart (which resets `_stockDayAllInflight` back to its initial `null`) could ever recover them.

### 9.3 Why it took ~2 hours after the restart to manifest

The wedge requires the STOCK_DAY_ALL self-heal branch to actually fire (primary feed's date must look
stale relative to a confirmed trading day) or, for `kgi-core`, simply requires its unconditional
`_isKgiHeatmapAfterHours()` call — the difference between "recovers instantly, every time" (which
would have made this obvious immediately after every past restart) and "wedges 2 hours after this
particular restart" is that the underlying `isTwTradingDay()` DB query had to *actually hang* on that
one occasion, not just run normally. This agent cannot confirm what made that one query hang at that
specific moment (see §9.4) — but the wedge mechanism itself fully explains why, once it happened once,
every endpoint sharing the singleton stayed broken for the remaining ~12+ hours regardless of the DB
subsequently recovering on its own.

### 9.4 Fix (this commit)

Restructured `getStockDayAllRows()` (and, for structural consistency, `getTpexMainboardCloseRows()`'s
matching `_tpexDailyCloseInflight` singleton) so the in-flight promise stored in module state is
itself wrapped in an outer `Promise.race` against a 20s timeout, with the `finally` cleanup moved to
that **outer** race instead of the inner attempt:

```ts
const attempt = (async () => { /* same body, no longer owns the finally cleanup */ })();
_stockDayAllInflight = Promise.race([
  attempt,
  new Promise<StockDayAllRow[]>((resolve) => setTimeout(() => resolve([]), 20_000))
]).finally(() => { _stockDayAllInflight = null; });
return _stockDayAllInflight;
```

This is a **structural** guarantee, not a duplicate of the `isTwTradingDay()` bound already added:
`_stockDayAllInflight` is now provably cleared within 20s no matter what happens inside `attempt` —
including anything added inside it in the future that isn't yet bounded, which is exactly the failure
mode that caused this incident (the dedup pattern predates `isTwTradingDay()`'s own addition to the
call chain, and nothing re-audited the pattern's settlement guarantee when that call was added). On
timeout, resolves to an empty array **without** populating the success cache — a timeout is a
transient degraded read, not a confirmed empty result, so the next call retries upstream rather than
serving a falsely-confirmed empty heatmap for the rest of the process's life.

Applied the identical restructuring to `getTpexMainboardCloseRows()` for consistency, even though its
own inner await was already `AbortSignal`-bounded (not proven wedgeable today — hardened anyway rather
than relying on "nothing inside happens to be unbounded" as the only safety net, which is precisely
the assumption that silently broke for `getStockDayAllRows()`). Checked
`finmind-aggregate-client.ts`'s equivalent `_inflight` Map pattern (`fetchWholeMarket()`) — already
structurally safe (its only inner await is bounded, no DB call in the chain) — left unmodified.

### 9.5 Complete Causal Chain (final)

```
[unknown trigger] a transient DB-pool pressure spike occurs at some point
  ~2h after the 12:00Z restart
  -> the next getStockDayAllRows() call that happens to need the STOCK_DAY_
     ALL self-heal branch (heatmap/twse, quote/realtime) or kgi-core's
     unconditional _isKgiHeatmapAfterHours() call hits isTwTradingDay()'s
     then-unbounded db.execute()
  -> that one query hangs instead of erroring
  -> the async IIFE backing _stockDayAllInflight never settles
  -> its finally-block cleanup never runs -> _stockDayAllInflight stays
     wedged, pointing at a permanently-pending promise
  -> every subsequent call to getStockDayAllRows(), from ANY of the 3
     endpoints, for the rest of the process's life, returns that same
     wedged promise and hangs identically
  -> heatmap/twse, heatmap/kgi-core, companies/:id/quote/realtime all hang
     -> apps/web's buildMarketIntelPayload() (calls heatmap/twse via a
        different upstream path) inherits the hang through its own missing
        per-call timeout (fixed independently in PR #1292)
  -> market-intel SSR route hangs -> iframe permanently blank
  -> market-intel.spec.ts Playwright smoke test times out identically
     across every concurrently-open PR -> ~12+ hours of cross-PR CI red,
     all-team merge blocked
  -> #1292 merges -> API service restarts as a side effect of the deploy
     -> _stockDayAllInflight resets to null at module load -> all 3
        endpoints instantly recover, confirming the wedge (not sustained
        pool exhaustion) was the actual mechanism
  -> this fix (PR #1294, same branch) makes the wedge structurally
     impossible going forward: isTwTradingDay() bounded+cached, and the
     in-flight singleton itself outer-timeout-guaranteed to always clear
```

### 9.6 Residual Open Item (narrowed from §7)

What specifically caused the DB query to hang on that one occasion ~2h post-restart (rather than
merely being slow, as it evidently was on every other occasion before and since) is still not
independently confirmed by this agent — no live Postgres telemetry access. This no longer blocks
closing the incident, though: the wedge mechanism itself is now structurally impossible regardless of
whether that transient DB pressure recurs, because `_stockDayAllInflight` can no longer stay pinned to
a non-settling promise. If the underlying transient DB pressure is itself worth investigating
separately (e.g. to understand what caused it, or whether it recurs), that's a `pg_stat_activity`/
Railway-metrics question for whoever has prod DB access — not blocking, and not part of this fix's
verification criteria.
