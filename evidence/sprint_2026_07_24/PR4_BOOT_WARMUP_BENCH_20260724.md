# PR-4 boot-warmup — local cold-start bench results (Jason-2, 2026-07-24)

Branch: `perf/overview-boot-warmup-pr4-jason2-20260724`. Plan: `reports/design_redesign_20260722/OVERVIEW_2S_ARCH_PLAN_20260722.md` §3 D-lite.

## Motivation (立案證據)

Bruce's prod terminal verify (`evidence/sprint_2026_07_23/BRUCE_PROD_VERIFY_5MERGE_20260723.md` §10): warm `/overview` p50 = 0.324s (well under the 2s target), but run 1 (first hit after the #1357 deploy) was **6.348s** — flagged, not root-caused, as a possible cold-path outlier for Jason-2 to pick up.

## Root cause (this PR)

`computeMarketDataOverview()` calls `ensurePersistedQuoteHistoryLoaded(workspaceSlug)` on every call, but it's a one-shot guard (`persistedQuoteHistoryLoaded` Set) — the FIRST call after a process boot pays for reading the workspace's entire persisted JSONL quote-history file off `/data` and replaying every entry (`JSON.parse` + Zod `.parse` + `pushQuoteEntry`, which also builds the PR-2/PR-3 `historyAggregateCache`) synchronously into memory. At prod scale (~1826 twse_mis symbols × ~511 ticks ≈ 933K entries — same scale as PR-1/PR-3's benches), this is the dominant cold cost. PR-1/PR-3's existing benches never exercised this path — they seed prod-scale data directly into the in-memory cache via `upsertTwseMisQuotes`, bypassing `ensurePersistedQuoteHistoryLoaded` entirely.

## Fix

`apps/api/src/server.ts`'s boot callback (fires after `serve()`'s `'listening'` event, i.e. the port is already accepting connections) now fires a **non-awaited** (`void`) warmup call — the exact same `getMarketDataOverview()` a real `/overview` request calls, same params as the homepage's SSR fetch (`includeStale=true&topLimit=20`) — for the resolved scheduler workspace. Failure is caught and logged, never thrown past the boundary (silent degrade to pre-PR-4 behavior: first real request pays the cost).

## Bench methodology

New script: `apps/api/src/__tests__/overview-boot-warmup-bench-pr4.ts` (not in `pnpm test`'s whitelist — matches PR-1/PR-3 convention, prod-scale seeding has no place in the fast CI loop). Unlike PR-1/PR-3's benches, this one seeds the **persisted JSONL file directly on disk** (`appendPersistedQuoteEntries`, bypassing the in-memory cache) for two separate workspaces, to simulate exactly what a fresh process sees after a deploy/restart (empty in-memory cache, a day's history sitting on the volume).

- **Part A (BEFORE)**: fresh workspace, `resetMarketDataWorkspaceState()`, time the FIRST `getMarketDataOverview()` call — no warmup ran (today's behavior).
- **Part B (AFTER)**: fresh workspace, run the exact same warmup call (untimed, simulating it happening at boot before traffic), wait past the (now 2000ms, see below) top-level memo TTL, then time a `getMarketDataOverview()` call with the SAME params — proving the speedup comes from the underlying per-symbol caches staying resident (matching Bruce's own diagnosis), not a trivial memo hit.
- **Part C**: a concurrent 20ms `setTimeout`-chain heartbeat running during Part B's warmup call, recording the max observed gap between ticks, as a (methodologically bounded — see caveat below) proxy for "how long would a concurrent `/health` request be queued behind this synchronous work".

Run command:
```
node --import ./tests/setup-test-env.mjs --import tsx/esm apps/api/src/__tests__/overview-boot-warmup-bench-pr4.ts
```

## Results (2 runs, local machine)

| Run | Seed (2×933K entries) | BEFORE (cold, no warmup) | AFTER (post-warmup, past TTL, same params) | Heartbeat max gap |
|---|---|---|---|---|
| 1 | 2311ms | **3791ms** | **153ms** | 20ms (7 ticks) |
| 2 | 5463ms | **4914ms** | **48ms** | 67ms (6 ticks) |

**BEFORE reproduces the outlier order of magnitude** (3.8-4.9s locally vs 6.35s on prod — plausible given machine/IO differences) and **exceeds the 2s target**. **AFTER is 25-100x faster and comfortably under 2s**, confirming the fix targets the actual cold-start mechanism (not a coincidental improvement).

## Health/ready regression check

Two independent arguments, one measured (bounded), one architectural:

1. **Measured (bounded)**: the concurrent heartbeat never showed a multi-second stall (max observed gap 20-67ms across 2 runs) during the ~4s warmup window. Caveat: a chained `setTimeout` heartbeat can itself be starved by long microtask chains without necessarily reporting a large "gap" the way a real incoming TCP connection's event delivery would — so this is supporting evidence, not a hard guarantee, and is called out as such rather than oversold.
2. **Architectural (the real guarantee)**: `serve()`'s callback (where the warmup call lives) only fires after the Node `'listening'` event — the port is already bound and OS-level accepting connections *before* any warmup code runs. The warmup call is `void`-ed (fire-and-forget, never awaited), so it does not delay the `console.log("...listening...")` line (already logged before it), nor any of the boot steps after it (`initRiskStore`, `seedOwnerIfEmpty`, scheduler launch). This PR does not introduce a new blocking source — the exact same synchronous JSONL-replay cost already exists today on whichever request happens to trigger `ensurePersistedQuoteHistoryLoaded` first; this PR only moves *when* that one-time cost is paid, from "first real user's request" to "boot, before traffic normally arrives".

`/health` itself (`apps/api/src/server.ts` route) has zero dependency on the warmup — it's a pure synchronous JSON response with no DB/cache reads.

## Request-memo TTL evaluation (順手評估, per dispatch)

`overviewMemoTtlMs` raised **1500ms → 2000ms** (`apps/api/src/market-data.ts`), matching the existing `#1334` precedent (`getKgiMarketOverview`/`getKgiCoreHeatmap`'s own 2000ms memo). Reasoning:

- Bruce's own finding (§10 of the cited evidence): this memo only de-dupes near-simultaneous identical-params callers — it does **not** explain why warm requests stay fast several seconds apart (that's the underlying per-symbol caches staying resident, confirmed by this PR's own Part B methodology: the AFTER measurement is taken *past* the TTL window on purpose).
- The bump is freshness-contract-neutral: quote/history/bar staleness is computed from each entry's own `lastTimestamp` vs wall clock at read time, independent of this memo; 2000ms remains far under every source's stale-floor (quotes min 5s, history/bars 10min) — same margin #1334 already established as safe.
- Updated the one test that waited past the old TTL (`market-data-overview-concurrency-memo.test.ts`, wait bumped 1700ms → 2200ms) so it still asserts a real TTL-expiry recompute.

This is a minor, low-risk piggyback on the boot-warmup PR since it was explicitly called out as "順手評估" in the same dispatch — it does not itself close the cold-start gap (the boot warmup does).

## Freshness/risk-output boundary

Zero changes to `apps/api/src/risk-engine.ts`, `packages/contracts/src/risk.ts`, freshness computation logic, or any staleness threshold. The TTL bump only widens the request-level de-dup window (see above); the boot warmup calls the exact same production code path a real request calls — no new computation, no new "warm approximation".
