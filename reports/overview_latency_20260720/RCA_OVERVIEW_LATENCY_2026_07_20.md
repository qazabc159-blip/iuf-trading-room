# RCA: /api/v1/market-data/overview 8s P0 latency regression (2026-07-20)

## TL;DR
**Neither #1317 nor #1321 is the algorithmic cause.** Live measurement traced the
~8s cost to a pre-existing (April 2026, untouched by either commit) hot path:
`getMarketDataOverview()` independently re-derives the full multi-source
quote/history snapshot **3x per request** (`getEffectiveMarketQuotes`, then
`getMarketQuoteHistoryDiagnostics`, then `getMarketBarDiagnostics`), and the two
diagnostics calls each do an **unfiltered full-cache scan + per-entry Zod parse
+ sort** before applying the caller's symbol filter. Cost scales with total
cached entries across the whole ~2000-symbol universe, not with what's actually
requested. No revert needed; fix is to memoize the two hot functions.

## Evidence (live prod, curl with owner session, 3+ repeats each)

| Probe | Latency |
|---|---|
| `/market-data/overview` (full) | 7.6-8.9s stable, one 18.8s spike (self-heal coincidence) |
| `/market-data/quotes?limit=500` | 0.3-0.4s |
| `/market-data/effective-quotes` (500 symbols, limit=200) | 0.63s |
| `/market-data/history/diagnostics` (500 symbols) | 4.2-4.3s |
| `/market-data/history/diagnostics` (**50** symbols) | 4.2-4.6s — **same** |
| `/market-data/bars/diagnostics` (500 symbols) | 3.7-3.8s |

The 50-vs-500-symbol test is the smoking gun: if the cost were proportional to
requested symbols (or caused by an O(n) growth in the *symbol set itself*), a
10x-smaller request would be faster. It wasn't — because
`listCachedProviderQuotes`/`listCachedProviderQuoteHistory` (called by
`resolveMarketQuotes`, in turn called 3x per overview request) always scan+parse+sort
**every** cached entry for a source before any symbol filter is applied.
`listCachedProviderQuoteHistory` in particular can hold up to `getQuoteHistoryLimit()`
(default 512) entries per (source, symbol) key across ~2000 symbols x up to 5
sources — the dominant cost, confirmed by `bars/diagnostics` also being ~3.8s
(bars are aggregated from the same quote-history cache, "generatedFrom": "quote_history").

`getMarketQuoteHistoryDiagnostics` + `getMarketBarDiagnostics` run via
`Promise.all(...)` in `getMarketDataOverview`, but their cost is CPU-bound
(Zod validation + array sort on the same single-threaded event loop), so they
do not overlap in wall-clock time — total ≈ sum (4.2s + 3.8s ≈ 8s), matching
the measured overview latency almost exactly.

## Why #1317 and #1321 were plausible but are ruled out

- **#1317** (`5e26d484`, dedupe + MIS-sweep market-tag default fix): the new
  `_dedupeItemsBySymbol()` is only wired into
  `getEffectiveMarketQuotesWithOfficialCloseFallback`, which `/overview` does
  **not** call (it calls `getEffectiveMarketQuotes` directly). The market-tag
  default change (`OTHER`→`TWSE` for ~12% of the universe, confirmed via
  `/market-data/symbols` sample: 60/500 rows tagged `OTHER`) *collapses*
  previously-split `(symbol, market)` resolution groups going forward — this
  reduces the number of groups `resolveMarketQuotes()` has to build, if
  anything a small speed-up, not a slowdown. Live `resolve?symbols=0050,1216,9105`
  today shows exactly one item per symbol (no duplicate-key artifact visible in
  current cache state).
- **#1321** (`3d8b844b`, KGI raw-datetime parse fix): touches only
  `kgi-subscription-manager.ts`'s `fetchKgiLatestTick()`, a per-symbol live-fetch
  path used by `/kgi/quote/*` and heatmap KGI-tick enrichment — not called by
  `/overview`'s DB/cache-backed `resolveMarketQuotes()` flow at all. The new
  `_parseKgiRawDatetime()` is a single regex test + string template, O(1).

Chronological correlation (both merged/deployed within ~2h of the observed
regression) is real, but the mechanism isn't in either diff. The actual trigger
is more likely ordinary intraday growth of the in-process quote/history cache
(crons sweep ~2000 symbols across up to 5 sources continuously through the
trading session) crossing a latency cliff in a hot path that was always
O(total cache size) with a non-trivial Zod-parse constant factor, compounded
today by TWSE's own `STOCK_DAY_ALL` upstream being stuck (`unwedging in-flight
dedup`, `self-heal succeeded` — visible repeatedly in prod logs), which
occasionally also triggers `buildDailyBarMarketContext`'s synchronous FinMind
self-heal (`ohlcv-finmind-sync ... durationMs=7201` observed once live) when
`/overview`'s live-quote market context degrades to EMPTY/half-heatmap.

## Fix applied (no revert)

`apps/api/src/market-data.ts`: added a short (1000ms) in-process memo to
`listCachedProviderQuotes` and `listCachedProviderQuoteHistory`, gated on BOTH:
- a per-workspace write-generation counter (bumped by `pushQuoteEntry` on every
  actual cache write) — exact invalidation the instant new data lands, and
- a 1s TTL — bounds how long a quote can appear "younger" than it truly is if
  no new write arrives, staying an order of magnitude under every source's
  staleness floor (`getQuoteStaleMs()` min 5s / `getBarStaleMs()` 10min /
  `getHistoryStaleMs()` 10min), so it cannot reintroduce a false-fresh /
  false-stale freshness bug (the exact failure class #1321 fixed elsewhere
  today).

This collapses the 3x-per-request (and rapid near-simultaneous cross-request)
redundant full-cache scan+parse+sort down to ~1x actual computation per
workspace/source per second, without touching correctness, `resolveMarketQuotes`
semantics, or any freshness/gate logic.

## Verification
- `pnpm --filter @iuf-trading-room/api exec tsc --noEmit` — clean.
- `pnpm run test` — 1953/1955 pass (2 pre-existing unrelated FinMind-token-env
  failures reproduced identically on unpatched `origin/main`, not caused by this
  change). One test (`ci.test.ts`: "market data resolves preferred source by
  freshness and precedence") initially broke with a naive TTL-only memo (stale
  read across a just-landed write inside the same TTL window) — fixed by adding
  the generation-counter gate; passes clean now.
- Live prod re-measurement pending merge+deploy (see PR).
