# RCA round 6: /overview shared history snapshot (architecture fix) — 2026-07-21

## Recap
Round 5 (`RCA_ROUND2_REAL_PROFILING_2026_07_20.md` + session handoff) proved that under
continuous live MIS-sweep write traffic, `listCachedProviderQuoteHistory("twse_mis")`'s
write-generation+TTL memo (rounds 1/4/5) almost never survives the gap between
`historyQuality`'s and `barQuality`'s independent calls into it — a genuinely new tick lands
in that gap on essentially every real request, so `/overview` was still paying for the
~932K-entry scan **twice** per request even after rounds 3-5's fixes. Round 5's own
conclusion: no cache-validity strategy (TTL, generation, or smarter invalidation) can close
that gap, because the two calls are genuinely reading at two different instants and the
underlying data genuinely changes between them. Documented prod steady-state after rounds
3-5: **~4.2-4.5s** (session handoff 2026-07-20).

## Fix (this round)
Architecture change, not another memo tweak: `getMarketDataOverview` now computes the
per-source quote-history snapshot **once, synchronously**, before starting either
`historyQuality` or `barQuality`, and threads it down as an explicit `rawHistoryBySource`
parameter through `listMarketQuoteHistory` / `getMarketQuoteHistoryDiagnostics` /
`listMarketBars` / `getMarketBarDiagnostics`. Both sub-calls now consume the identical
precomputed `Map<QuoteSource, Quote[]>` — sharing is now a property of the call graph, not
of a cache's timing luck. All other (non-overview) callers of those four functions omit the
parameter and keep the exact previous per-call-scan behavior untouched.

Also removed in this PR: all `[overview-perf]` temporary diagnostic `console.log` /
`performance.now()` instrumentation added in rounds 2-5 (was noisy in prod logs, printed
`workspace slug` pre-order-submit, and its job — locating the bottleneck — is done).

Files: `apps/api/src/market-data.ts` only. Function signatures touched (all purely additive
optional parameters, default omitted = unchanged legacy behavior for every other caller):
`listMarketQuoteHistory`, `getMarketQuoteHistoryDiagnostics`, `listMarketBars`,
`getMarketBarDiagnostics`. New private helper: `snapshotCachedProviderQuoteHistoryBySource`.

## Freshness output — byte-identical, verified
`withFreshness()` itself is untouched by this PR. The shared-snapshot mechanism only changes
*how many times* the scan runs and *whether both consumers see the same computed array* — it
does not change the computation itself. Verified via full existing test suite (see below);
no test assertions were loosened.

## Local evidence (no full 932K-entry live server available locally — see methodology note)

### Isolated hot-path microbenchmark (synthetic entries, exact prod scale from round 2's logs)
Reproduces `withFreshness()` + the filter/flatMap/sort scan verbatim, at the exact per-source
entry counts captured live in `RCA_ROUND2_REAL_PROFILING_2026_07_20.md`
(twse_mis=932158, manual=54742, kgi=9728, tradingview=1, paper=0):

```
OLD (scan x2 per /overview request): median=827.5ms
NEW (shared snapshot, scan x1):      median=425.2ms
Speedup: 1.95x
```

### Deterministic real-code E2E benchmark (real write path, real read path, prod-representative scale)
Seeds the actual in-memory quote-history cache through the real `upsertTwseMisQuotes()` write
path (1826 symbols x 512 history depth = 934,912 twse_mis entries — 99.7% of round 2's live
932,158), then times the real exported `listMarketQuoteHistory()` — with one real intervening
write between the two calls to **deterministically** reproduce round 5's proven mechanism
(rather than relying on timing-lucky concurrent-writer interleaving, which was tried first and
found unreliable at local desktop scale — see inline comments in the bench script for why):

```
OLD pattern (listMarketQuoteHistory x2, 1 real intervening write): median=5992.5ms  (n=5)
NEW pattern (1 scan, reused for 2nd logical read):                  median=2920.7ms  (n=5)
Speedup: 2.05x
```

### Projected prod /overview total (estimate, not a guarantee)
Applying the measured ~2.0-2.05x reduction in the scan-dominant cost to the last documented
live prod steady-state (~4.2-4.5s, itself effectively all double-scan cost per round 5's own
finding that the memo doesn't help under real traffic): **projected ~2.1-2.2s**. This is very
close to the <2s target but the projection carries real uncertainty (local hardware ≠ prod
container, other concurrent cron/GC load on prod not modeled, other overview overhead —
`effectiveSelection`, `buildMarketContext`, provider/company fetch — not re-measured this
round). **This has not been confirmed <2s by a live measurement** — every prior round in this
incident (1-5) required live prod re-measurement after merge+deploy to confirm a local/
theoretical estimate, and this round is no different. Recommended next step: merge + deploy +
re-curl `/overview` on prod, same methodology as rounds 2-5.

### Methodology note
The in-memory quote-history cache cannot be seeded to full prod scale (932K real entries) by
running a real local server, because it is intentionally never persisted at that granularity
(`quote_last_close` DB table is the persisted fallback; the deep per-tick history cache is
in-memory-only by design, rebuilt from hours of live MIS-sweep cron traffic) — there is no
practical way to reach that scale locally except by driving the exact write path 512 times, as
done above (takes ~5.4s to seed 934,912 entries). Both benchmarks above use real production
code (`withFreshness()` verbatim in the first, the actual exported `listMarketQuoteHistory()`
in the second) — the second is the stronger evidence of the two since it exercises the true
write path, dedup logic, generation-bump mechanism, and read path together, not a hand-rolled
replica.

## Verification
- `pnpm run build:packages` — 5/5 green
- `pnpm run build:api` — green (includes `@iuf-trading-room/integrations`, needed alongside
  `build:packages` for a full `tsc --noEmit`)
- `pnpm run test` — 1953/1963 pass, 8 skip, 2 fail (`finmind-client.test.ts` T3/T11 — confirmed
  pre-existing: caused by a `FINMIND_TOKEN` value already present in this shell's environment
  polluting the test, reproduces identically on unpatched `origin/main`, unrelated to this PR)
- Direct re-run of the market-data-adjacent test files (`market-data-overview.test.ts`,
  `effective-quotes-official-close-fallback.test.ts`, `effective-quotes-dedupe-by-symbol.test.ts`,
  `kbar.test.ts`, `quote-hardening.test.ts`, `quote-realtime-wire.test.ts`,
  `quote-realtime-persisted-supersede.test.ts`, `heatmap-consistency.test.ts`,
  `market-data-integrity-gate.test.ts`, `mis-sweep-market-mapping.test.ts`) — 103/103 pass
