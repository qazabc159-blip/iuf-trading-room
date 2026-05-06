# Jason Axis 4 — Strategy Registry Wire into OpenAlice Daily Brief

**Date**: 2026-05-07  
**Branch**: feat/openalice-daily-brief-strategy-registry-2026-05-07  
**TCS delta**: +2 (Tests 11 + 12)

## §1 What was built

Wired IUF Quant Lab strategy registry into the OpenAlice `daily_brief` job parameters.

## §2 Files changed

- NEW `data/lab/strategies-snapshot.json` — trimmed snapshot (4 strategies, no code internals)
- MOD `apps/api/src/openalice-pipeline.ts` — added `StrategyRegistryEntry` type + `loadStrategySnapshot()` (exported)
- MOD `apps/api/src/server.ts` — `runDailyBriefDispatcherTick`: loads snapshot, extends `instructions` + adds `strategyRegistry` to `parameters`
- MOD `apps/api/src/openalice-pipeline.test.ts` — Tests 11 + 12 (strategy snapshot shape + yellow-tier gate)

## §3 Snapshot shape

```json
{ "strategyId": "strategy_001_inst_followon", "name": "...", "type": "short_term",
  "status": "BACKTESTED_RAW", "latestSummary": { "totalTrades": 87, "rawPnl": 12269.78,
  "maxDd": 7488.03, "avgHoldingDays": 2.10 }, "caveats": ["NOT_PAPER_READY", ...] }
```

## §4 Parameters shape change

Before: `{ targetDate: "2026-05-07", autoDispatched: true }`  
After:  `{ targetDate: "2026-05-07", autoDispatched: true, strategyRegistry: [...4 entries] }`

## §5 AI reviewer gate — strategy section risk assessment

- Strategy section content contains keyword "strategy" → `classifyDraftTier` returns `"yellow"` → `awaiting_review` (not auto-published). This is by design.
- Hard reject rules (buy/sell/目標價/必賺/勝率) are structurally excluded from the instructions prompt. Instructions explicitly prohibit these keywords.
- `NOT_PAPER_READY` caveat mandatory on all 4 BACKTESTED_RAW strategies — no promotion language possible.
- Test 12 asserts yellow-tier classification for strategy-section content. AI reviewer final gate unchanged.

## §6 Graceful degradation

`loadStrategySnapshot()` returns `null` when snapshot is missing or malformed — dispatcher silently omits `strategyRegistry` from parameters. No fake data, no crash.

## §7 Build / test results

- `pnpm --filter @iuf-trading-room/api build`: PASS (0 errors)
- `openalice-pipeline.test.ts`: 19/19 PASS (added tests 11 + 12)
- Lane: clean — did not touch risk / broker / frontend / market-data core
