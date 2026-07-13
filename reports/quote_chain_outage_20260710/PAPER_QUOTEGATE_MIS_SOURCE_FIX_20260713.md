# Paper-channel quoteGate MIS-source mislabel fix (2026-07-13)

## Trigger
Bruce's 2026-07-13 intraday verification (`.claude/worktrees/bruce-monday-prep-20260712/reports/monday_verification_20260713/INTRADAY_RESULTS.md`, 12:2x section): a real paper-channel order (`POST /api/v1/trading/orders`, 2330 limit) returned 422. `riskCheck.decision=warn` (would pass) but `quoteGate.blocked=true`, `reasons:["synthetic_source","non_live_source"]`, `selectedSource:"manual"`.

## Root cause
- `market-data.ts`'s source priority chain is `kgi > tradingview > paper > manual`. KGI market-data-auth has been broken company-wide since ~6/2 (see `reports/quote_chain_outage_20260710/DIAGNOSIS_v1.md`); tradingview/paper buckets have no automated writer today. So the resolved quote for almost every symbol falls to the `manual` bucket.
- That `manual` bucket is *not* hand-typed placeholder data during trading hours — it is filled every ~45s by `_runTwseMisQuoteCron` (Tier A, core symbols) and every ~10s/slice by `_runMisFullSweepSlice` (Tier B, full universe), both of which pull the official TWSE MIS intraday feed and call `upsertManualQuotes(...)`. That call tags the entry `source: "manual"`, indistinguishable from a genuinely hand-typed Admin value (`POST /api/v1/market-data/manual-quotes`).
- `isSyntheticSource()` (`market-data.ts`) unconditionally treats `source === "manual"` as synthetic. `buildConsumerDecision()`'s paper-mode branch computes `safe = usable && readiness === "ready"`, and `readiness` requires `!synthetic && selectedSource === "kgi"` to reach `"ready"`. Any non-kgi source (real or fake) therefore always landed on `decision = "review"`.
- `paper-risk-bridge.ts::evaluatePaperOrderRisk` calls `evaluateExecutionGate({ mode: "paper" })`, and `buildPaperOrderContext()` always sets `overrideGuards: []` — there is no UI/API path for a paper order to supply the `quote_review` override. So `decision === "review"` with no override always resolves to `blocked: true, decision: "review_required"` at the gate.
- Net effect: since KGI went down, **every paper order on every symbol with any quote at all** has been blocked, because the label ("manual") lied about the data's real provenance ("official TWSE MIS real-time feed").

## Fix
Give the MIS-injected feed a distinct, honest source identity instead of relaxing the gate wholesale.

1. **`packages/contracts/src/marketData.ts`** — add `"twse_mis"` to `quoteSourceSchema` (purely additive enum value; naming aligned with the existing `twse_mis_intraday` literal used at the unrelated bidask endpoint, per dispatch instruction).
2. **`apps/api/src/market-data.ts`**:
   - Register `twse_mis` as a 5th `quoteProviderSources` bucket (priority: right after `kgi`, ahead of tradingview/paper/manual — it is real official data, just not KGI infra).
   - New `upsertTwseMisQuotes()` (mirrors the existing `upsertKgiQuotes()`/`upsertPaperQuotes()` pattern) — forces `sourceOverride: "twse_mis"`.
   - `isSyntheticSource()` is **unchanged** — `twse_mis` was never added to its `"manual" || "paper"` check, so it is correctly non-synthetic by construction.
   - `buildProviderReadiness()` — added `|| input.source === "twse_mis"` to the provider-status "degraded" bucket (consistency: real-but-non-kgi source, same treatment as `tradingview`).
   - **The actual behavior change**: `buildConsumerDecision()` and the `safe` computation in `getMarketDataConsumerSummary()` now have a narrow exception — `isPaperTrustedNonKgiSource(mode, selectedSource) = mode === "paper" && selectedSource === "twse_mis"` — which lets `safe`/`decision="allow"` fire without requiring `readiness === "ready"`. This is the *only* place the decision differs from before.
3. **`apps/api/src/server.ts`** — `_runTwseMisQuoteCron` (Tier A) and `_runMisFullSweepSlice` (Tier B) now call `upsertTwseMisQuotes(...)` instead of `upsertManualQuotes(...)`. `_runTwseEodCron` (a different official source — TWSE OpenAPI `STOCK_DAY_ALL` EOD closes, used for after-hours strategy-ideas gating) is deliberately **left untouched** — out of scope for this fix (different feed, different consumer, not the reported incident).

## Why this is a label fix, not a risk relaxation
- `isSyntheticSource("twse_mis")` is `false` — it was never included in the synthetic set. A genuinely hand-typed manual quote is still `source: "manual"`, still synthetic, and the paper-mode decision for it is unchanged: **still `"review"`, still blocked without an override** (see T02/T05 in the new test file — explicit regression lock).
- The leniency is gated on `mode === "paper"` **and** `selectedSource === "twse_mis"` specifically — not on `!synthetic` in general, and not on any other mode.

## Evidence the real-money/execution channel is zero-touch
`buildConsumerDecision()`'s `mode === "execution"` branch is a fully separate code path (`if (input.mode === "execution") { ... return; }`, evaluated *before* the paper/strategy branch) that never references `isPaperTrustedNonKgiSource`. Its `"allow"` case requires `liveUsable && readiness === "ready"`, and `liveUsable = freshnessStatus === "fresh" && selectedSource === "kgi"` (`getEffectiveMarketQuotes`, unmodified) — `twse_mis` can never satisfy `selectedSource === "kgi"`, so `liveUsable` is always `false` for it, regardless of any other change in this diff. Execution-mode decision for a `twse_mis`-sourced quote is therefore unchanged from today's `"manual"`-tagged behavior: `"review"` (new test T03 asserts this explicitly, and asserts it is never `"allow"`).

Diff touches zero lines in `risk-engine.ts`, `broker/trading-service.ts`, `domain/trading/execution-mode.ts`, `kgi-sim-env.ts`, or any file under `services/kgi-gateway/` — confirmed by `git diff --stat` on the PR branch (only `market-data.ts`, `server.ts`, `packages/contracts/src/marketData.ts`, `tests/ci.test.ts`, `package.json`, plus one new test file).

## Escalation note (per task boundary)
`packages/contracts/src/marketData.ts` is outside Jason's normal day-to-day lane (per standing lane convention) but is not one of the harness-hook-enforced lock files (`risk-engine.ts` / `trading-service.ts` / `execution-mode.ts` / `kgi-sim-env.ts` / kgi-gateway files / `read_only_guard.py` / `w6_no_real_order_audit.py` / `ci-security.yml`). The dispatching task explicitly named this exact design ("把 MIS 注入的報價給真實來源身分（例如獨立 twse_mis source）") and framed `market-data.ts`/non-lock areas as directly actionable. Adding one new enum value is additive, backward-compatible (verified: `pnpm typecheck` green across all 10 packages including `apps/web`), and was the only technically sound way to preserve the source distinction through the Zod-validated `Quote` pipeline (a side-channel marker that doesn't survive `quoteSchema.parse()` would have kept the "manual"/synthetic label on real data while silently changing behavior — a bigger honesty violation than an additive schema value). Flagging this explicitly per the task's own escalation clause rather than treating it as implicitly authorized.

## Test coverage (new file)
`apps/api/src/__tests__/paper-quotegate-mis-source.test.ts` (wired into root `pnpm test` in `package.json`):
- T01: paper mode + fresh `twse_mis` quote → `decision: "allow"`
- T02 (regression lock): paper mode + fresh genuinely-`manual` quote → `decision: "review"` (unchanged)
- T03 (regression lock): execution mode + fresh `twse_mis` quote → `decision: "review"`, never `"allow"`
- T04: end-to-end `evaluateExecutionGate({mode:"paper"})` with `twse_mis` source → `blocked: false`
- T05 (regression lock): end-to-end `evaluateExecutionGate({mode:"paper"})` with `manual` source → `blocked: true, decision: "review_required"`

Also updated 3 pre-existing assertions in `tests/ci.test.ts` that hardcoded the previous 4-source count/order (now 5 sources; additive, not behavior-breaking — verified each updated assertion against actual runtime output before editing).

## Verification
- `pnpm run build:packages` — green (5/5 tasks)
- `pnpm typecheck` — green (15/15 tasks, all 10 packages incl. `apps/web`)
- `pnpm --filter @iuf-trading-room/api run build` — green
- `pnpm test` — 1688/1698 pass, 8 skipped, 2 fail (both `apps/api/src/data-sources/finmind-client.test.ts`, confirmed pre-existing/unrelated: caused by a leaked `FINMIND_API_TOKEN` in the local shell env, not by this change — reproduced pass 11/11 for that file with the env var unset)
- `pnpm run smoke` — green (local scripted smoke, 1/1 checks passed)
- Playwright P0 — not run locally (per repo convention, self-hosted GHA runner is the source of truth); this change touches zero `apps/web` files and the contracts change is additive, so no frontend-visible risk is expected. Will confirm via GHA once the PR is opened.
