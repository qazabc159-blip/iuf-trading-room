# RCA round 2: /overview 8-10s+ P0 — real profiling (not theory)

## What round 1 got wrong
Round 1's RCA (`RCA_OVERVIEW_LATENCY_2026_07_20.md`) correctly identified the 3x-redundant-call
architecture and correctly ruled out #1317/#1321, but the fix (short TTL+generation memo) did
**not** meaningfully help in prod: post-deploy re-measurement showed 10.1-10.9s (same or worse
than the pre-fix 7.6-8.9s). Root cause of round 1's miss: the memo reduces *how often* the
expensive scan re-runs, but never measured *how expensive a single scan actually is* — and on a
live server with continuous MIS-sweep writes, the write-generation gate busts the memo before the
concurrent `historyQuality`/`barQuality` calls can ever share one computation, so in practice it
was hitting close to 0% of the time anyway.

## Real per-segment timing (temporary `[overview-perf]` instrumentation, live Railway logs)

One real `/overview` request, prod, post-#1323-deploy:

```
quotes.length=1000  qualitySymbols.count=1000
effectiveSelection=120ms
listCachedProviderQuoteHistory(manual)     MEMO_MISS keysForSource=1242 rawEntryCount=54742  scanMs=238
listCachedProviderQuoteHistory(paper)      MEMO_MISS keysForSource=0    rawEntryCount=0       scanMs=9
listCachedProviderQuoteHistory(tradingview)MEMO_MISS keysForSource=1    rawEntryCount=1        scanMs=1
listCachedProviderQuoteHistory(kgi)        MEMO_MISS keysForSource=19   rawEntryCount=9728     scanMs=33
listCachedProviderQuoteHistory(twse_mis)   MEMO_MISS keysForSource=1826 rawEntryCount=932158   scanMs=5004   <-- HERE
... (repeats a 2nd time for the barQuality-side call, ~4400-5000ms again)
historyQuality_inner=11295ms
barQuality_inner=11277ms
TOTAL=54798ms   (this particular request also hit a slow buildDailyBarMarketContext / cold path;
                 typical requests measured 10.1-10.9s at the HTTP layer)
```

**`listCachedProviderQuoteHistory("twse_mis")` alone: ~932,158 cached tick entries
(1826 symbols x up to the per-source history cap, `getQuoteHistoryLimit("twse_mis")` = 512),
taking ~4.5-5.0 seconds to scan+parse+sort — twice per `/overview` request** (once for
`historyQuality`, once for `barQuality`, since bars are aggregated from the same quote-history
cache). This single number accounts for essentially the entire `historyQuality_inner`/
`barQuality_inner` cost (~9.5-10s of the ~11.2-11.3s each reports, plus ~0.5s from the smaller
sources) — i.e., **this one thing is the P0**, not the 3x-redundant-call architecture itself
(that's real but a much smaller multiplier on top of this).

## Why is the per-entry scan itself ~5s for ~932K entries?

`listCachedProviderQuoteHistory` calls `.map(withFreshness)` on every entry. `withFreshness()`
was calling `quoteSchema.parse({...entry, ageMs, isStale})` — a full Zod schema validation —
**per entry**. Microbenchmark (`node` in a clean process, same schema, 932,158 synthetic
entries): `quoteSchema.parse()` = **894ms**; equivalent plain object construction (explicit field
list, no Zod) = **69ms** — a **~13x** difference for the parse step alone. Prod's real ~5000ms is
higher than the 894ms microbenchmark predicts (shared CPU with schedulers/crons, GC pressure, more
varied real timestamps affecting the sort, and the `Date.parse`-based `ageMs` computation per
entry), but the ~13x relative win should transfer proportionally.

## Confirmed direction, not yet re-measured post-fix
- The workspace quote/history cache is confirmed **in-memory only** (documented gotcha:
  "deploy 重啟會洗掉 in-memory quote store"), wiped on the 16:30 restart — this rules out a
  persisted/api-volume explanation for why the fix didn't help; the cache simply rebuilt to
  similar scale (932K twse_mis entries) within the hours since restart via continuous MIS-sweep
  writes across ~1826 symbols x up to 512-entry retention each.

## Fix (this round)
`withFreshness()` in `apps/api/src/market-data.ts`: replaced `quoteSchema.parse({...entry, ...})`
with an explicit plain-object construction (same field list, so `QuoteCacheEntry`'s extra
`updatedAt` field is still NOT leaked into the `Quote` shape — matching what `.parse()`'s silent
unknown-key stripping did before). No retention/architecture change; every response is still
validated at its own outer schema boundary (`effectiveMarketQuoteSchema.parse`,
`marketDataBarDiagnosticsResponseSchema.parse`, etc.) — this only removes a **redundant**
re-validation of data this module already constructed itself from already-validated inputs, in
the single hottest inner loop.

Round 1's memo (generation+TTL gated) is left in place — it's still a legitimate, low-risk
win for the cases where it *does* hit (quieter periods with fewer concurrent writes), just not
sufficient on its own.

## Verification
- `pnpm --filter @iuf-trading-room/api exec tsc --noEmit` — clean
- `pnpm run test` — 1953/1955 (2 pre-existing unrelated FinMind-token-env failures, unchanged)
- Microbenchmark: 894ms -> 69ms for 932,158-entry `withFreshness`-equivalent parse, isolated
- **Pending**: live prod re-measurement post-merge+deploy (this round's actual goal)
