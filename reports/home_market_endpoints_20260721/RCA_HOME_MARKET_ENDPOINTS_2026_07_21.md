# RCA: homepage market-content endpoints latency — 2026-07-21

## Dispatch
Elva: homepage shell/Suspense is already fast (TTFB 0.4s, confirmed by Jim). The
hero band's market CONTENT still takes 4-9s to fill because the ~11-way concurrent
request fan-out on page load makes 4 specific market-source endpoints slow down
under concurrency (reported: 0.5-3.8s standalone → 3.3-4.1s concurrent). Dispatch's
working hypothesis: "same root cause as PR #1333's `withFreshness()` Zod-parse CPU
bottleneck, different endpoints."

## Per-endpoint RCA

| Route | Backing function(s) | Own hot-path cost (code review) | Verdict |
|---|---|---|---|
| `/market/overview/twse` | `getTwseMarketOverview()` (`twse-openapi-client.ts`) | SWR-cached (`_overviewLastGood`, 15-min max age) + 1-min flat cache (`getOverviewCached`). Warm-path: **0ms** (bench). Cold-path (no LKG yet): blocking `MI_5MINS_INDEX` fetch, ~500ms in this bench's mocked-latency model. | **Not the bottleneck** — already has the exact SWR pattern PR #1333 introduced for `/overview`. No `withFreshness()`/Zod hot loop in this path at all. |
| `/market/heatmap/twse` | `getTwseIndustryHeatmap()` + `_getTwseOfficialIndustryMap()` (4h cache) + FinMind/TWSE fallback chain | All 3 layers are cached (60s FinMind / 4h industry map / in-memory heatmap cache). Warm-path: **0ms** (bench). Cold-path: ~730ms (STOCK_DAY_ALL fetch, deduped/coalesced across concurrent callers via `_stockDayAllInflight`). | **Not the bottleneck** — same reasoning as above. No Zod-parse hot loop. |
| `/market/overview/kgi` | `getKgiMarketOverview()` (`kgi-subscription-manager.ts`) | **Zero caching** (unlike its TWSE counterpart) — every call fires 2 fresh gateway HTTP round-trips (`fetchKgiLatestTick("^TWII")` + `("^TPEX")`), even for near-simultaneous callers. | **Root cause #1 (fixed this PR)**: no memoization → redundant gateway round-trips under any overlapping-caller load. |
| `/market/heatmap/kgi-core` | `getKgiCoreHeatmap()` (40-symbol `Promise.all` fan-out to the gateway) + `getStockDayAllRows()`, awaited **sequentially** despite a code comment claiming "in parallel" | (a) Zero caching, same as above, but the fan-out is 40 gateway round-trips (not 2) — the single largest concurrent I/O burden of the 4. (b) The two calls have **no data dependency** on each other yet were awaited one-after-another, paying the sum instead of the max. | **Root cause #1 AND #2 (both fixed this PR)**. |

**None of the 4 endpoints touch `market-data.ts`'s `withFreshness()` or the
per-source quote-history cache PR #1333 fixed.** Dispatch's "same root cause"
hypothesis is only partially correct: the *class* of bug (redundant per-request
work under concurrency) is the same, but the *mechanism* is different — these 4
are I/O-bound (uncached external HTTP fan-out), not CPU-bound (Zod-parse over a
large in-memory array). See "CPU-contention validation" below for the piece of
dispatch's hypothesis that IS confirmed.

## Fixes (this PR)

### Fix A — TTL memo on `getKgiMarketOverview()` / `getKgiCoreHeatmap()`
`apps/api/src/kgi-subscription-manager.ts`. Both functions gained a 2000ms
in-process Promise-memo (shorter than the endpoint's own advertised
`staleAfterSec: 5` freshness contract, so no response is ever served staler than
what the endpoint already promises). Mirrors the pattern already validated in PR
#1323 (TTL-memoized Promise, concurrent callers share one real round-trip).
Cleared by `_resetSubscriptionManager()` for test isolation (existing test
convention, already called before every test in the suite).

### Fix B — parallelize the two independent awaits in `/market/heatmap/kgi-core`
`apps/api/src/server.ts`. `getKgiCoreHeatmap()` and `getStockDayAllRows()` have no
data dependency on each other (different external services, no shared state) but
were awaited sequentially — the route's own comment ("Fetch TWSE STOCK_DAY_ALL in
parallel") no longer matched the code. Changed to `Promise.all`.

## Local evidence (deterministic, real exported code, mocked network)

Methodology: imports the real, unmodified-by-this-PR exported functions
(`getKgiMarketOverview`, `getKgiCoreHeatmap`, `getTwseMarketOverview`,
`getTwseIndustryHeatmap`) via `tsx`, with `globalThis.fetch` replaced by a
calibrated mock (KGI gateway modeled as a bounded-concurrency queue —
concurrency=6, 150ms/request, an explicit ASSUMPTION not a prod measurement,
chosen so a 2-way fan-out stays fast while a 40-way fan-out lands in the
multi-second range the dispatch RCA reported; TWSE endpoints use flat latency
since they are not the reported bottleneck). Every scenario below was run against
BEFORE (via `git stash`) and AFTER (this PR's diff) using the byte-identical bench
script, so the delta is attributable only to the code change, not to random
variance in the mock.

### Scenario 1 — standalone (isolated single caller, cold cache)
```
getKgiMarketOverview:            176ms  (2 gateway calls)
getKgiCoreHeatmap:               1142ms (40 gateway calls)
getTwseMarketOverview (cold):    517ms
getTwseMarketOverview (warm):    0ms
getTwseIndustryHeatmap (cold):   737ms
getTwseIndustryHeatmap (warm):   0ms
```
No change before/after — a single isolated caller never benefits from a memo
(nothing to dedupe against) and the parallelize fix only helps when the second
call isn't already being warmed by a concurrent sibling (see Scenario 3).

### Scenario 2 — the dispatch's actual scenario: 4 endpoints concurrent, once each
This is the direct analogue of the reported "~11-way fan-out" symptom, restricted
to the 4 target endpoints (no CPU-heavy sibling — see the contention section
below for that piece).
```
                          BEFORE      AFTER
Total wall time            1129ms      1122ms
  market/heatmap/kgi-core  1129ms      1122ms
  market/overview/kgi      1111ms      1107ms
  market/overview/twse      503ms       513ms
  market/heatmap/twse       708ms       713ms
```
**Both BEFORE and AFTER are comfortably under the 3s target in this scenario.**
The total barely moves because `/market/heatmap/twse` (a sibling call in the SAME
batch) already fetches `STOCK_DAY_ALL` concurrently and TWSE-openapi-client.ts's
own pre-existing promise-coalescing (`_stockDayAllInflight`) lets
`/market/heatmap/kgi-core`'s own `getStockDayAllRows()` call ride that same
in-flight fetch for free — the sequential-awaits bug in Fix B is largely masked
in THIS specific 4-endpoint batch by a pre-existing, unrelated dedup mechanism.
Fix B's benefit is real but shows up more clearly in isolation (Scenario 3) or in
any caller sequence that doesn't happen to have `/market/heatmap/twse` running
concurrently.

### Scenario 3 — isolates Fix B (sequential vs parallel, same two calls, no sibling)
```
SEQUENTIAL (pre-fix order): 1826ms
PARALLEL (post-fix order):  1110ms
Speedup: 1.64x (saves ~716ms — the STOCK_DAY_ALL fetch that used to add
                fully on top instead of overlapping)
```

### Scenario 4 — isolates Fix A (3 near-simultaneous callers to the SAME endpoint,
models multiple users/tabs loading the homepage within ~2s of each other)
```
getKgiCoreHeatmap, 3 concurrent callers:
  BEFORE: 3200ms, 120 real gateway calls (3 x 40, no dedup)
  AFTER:  1136ms,  40 real gateway calls (deduped to 1 real fan-out)
  Speedup: 2.8x wall-time, 3x fewer gateway round-trips

getKgiMarketOverview, 3 concurrent callers:
  BEFORE: 167ms, 6 real gateway calls (3 x 2, no dedup)
  AFTER:  167ms, 2 real gateway calls (deduped to 1 real pair)
  Wall-time unchanged at this small scale (6 calls fit inside this bench's
  concurrency=6 gateway model in one wave either way) but 3x fewer real
  round-trips — reduces system-wide gateway load under real multi-user traffic
  even where it doesn't move THIS request's own latency.
```

## CPU-contention validation (real code, addresses the OTHER half of dispatch's hypothesis)
Dispatch's framing was "API process CPU 搶資源" — plausible even though NONE of
the 4 endpoints run CPU-heavy code themselves (confirmed above), because Node is
single-threaded for JS execution: a concurrent CPU-bound sibling (e.g. the
residual cost in `/overview`'s `withFreshness()` path, already reduced by PR
#1333 but not to zero) can block the event loop and delay these endpoints' fetch
*callbacks* even though their own network I/O isn't otherwise slow.

Verified empirically with real, unmodified `market-data.ts` code
(`reports/home_market_endpoints_20260721/` bench, not committed — scratchpad
only, same real-write-path-seeding technique as PR #1333's own bench, at a
smaller 153,600-entry scale for speed):
```
CPU-heavy listMarketQuoteHistory() alone:                564ms
getKgiMarketOverview() alone (no concurrent CPU load):     57ms
getKgiMarketOverview() concurrent with the CPU-heavy call: 301ms
Delta attributable to event-loop contention:              244ms
```
This confirms the mechanism dispatch described IS real, but it is **NOT
something this PR's fixes can address** — it originates from CPU cost elsewhere
in the process (tracked separately under PR #1333, which reports its own
projected-but-unconfirmed-live ~2.1-2.2s for `/overview`). If #1333's improvement
holds in prod, the contention this imposes on these 4 endpoints should shrink
proportionally, by the same mechanism. This PR reduces what these 4 endpoints
themselves contribute to total system load (fewer redundant gateway round-trips,
no wasted sequential wait) but cannot fix a CPU cost that lives in a different
module already covered by a different, already-merged PR.

## Freshness / output shape
Neither fix changes response shape or values on the cold/first-call path — the
memo only skips REPEATING identical work within a 2s window (shorter than the
endpoints' own advertised 5s staleness contract), and the parallelize fix
computes the exact same two values, just concurrently instead of sequentially.
Neither endpoint calls `withFreshness()` (that's `market-data.ts`-only,
untouched by this PR).

## Scope
`apps/api/src/kgi-subscription-manager.ts`, `apps/api/src/server.ts` (the single
`/market/heatmap/kgi-core` route only), `apps/api/src/__tests__/kgi-subscription-manager.test.ts`
(2 new tests: QM17/QM18). Zero touch to `market-data.ts`, `apps/web/*`,
`packages/contracts/*`, `risk-engine.ts`, `broker/*`, no DB migration.
