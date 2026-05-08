# PR #238 Desk Review — Pete 2026-05-07

## 1. PR Intent
- Wire Athena Lab strategy registry (axis 4) into OpenAlice daily brief pipeline.
- Add `data/lab/strategies-snapshot.json` (4 BACKTESTED_RAW strategies), `loadStrategySnapshot()` in
  `openalice-pipeline.ts`, and strategy section instructions into the daily_brief job.
- `classifyDraftTier` yellow gate ensures strategy content never auto-publishes.
- Commit: `8f899e2`  |  Base branch: not confirmed in diff (assumed main).

## 2. Diff Summary
- 3 files changed: `apps/api/src/openalice-pipeline.ts`, `data/lab/strategies-snapshot.json`,
  `apps/api/src/server.ts` (implicit — strategy wiring in dispatcher).
- 19/19 unit tests pass per PR description.

## 3. IUF Blocker Checklist

| Item | Result |
|------|--------|
| A1: Kill-switch / EXECUTION_MODE toggle | PASS — no grep hits |
| A2: place_order / submit_order / kgi.order.create | PASS — no grep hits |
| A3: Paper sprint — no KGI /order/create call | PASS |
| A4: Feature flag default OFF | N/A — no flag added |
| B1: New endpoint auth gate | PASS — dispatcher-debug is Owner-only; global session middleware covers /api/v1/* |
| B2: Hardcoded API key / token / password | PASS — snapshot JSON has no secrets |
| B3: .env.example / env var hygiene | N/A — no new env vars |
| B4: person_id / sessionId leak in log/response | PASS — pipeline logs contain only jobId, tick, date, source counts |
| C1: DB schema change + migration pair | N/A — no new tables |
| C2: enum / status strings synced | PASS — StrategyRegistryEntry type aligns with JSON values |
| C3: State machine LEGAL_TRANSITIONS | N/A |
| C4: Runtime module-level var restart risk | PASS — _lastPipelineState already existed; no new unbounded state |
| D1: PR title sprint pattern | PASS — feat/openalice-daily-brief-strategy-registry-2026-05-07 |
| D2: Conventional commits | Assumed conventional — not confirmed from diff |
| D3: Stacked chain base branch | Not verifiable from review scope — flag to Elva |
| D4: PR description lists evidence / gap | Provided via this PR task |
| E1: No agent lane crossing | PASS |
| E2: No governance bypass | PASS |
| E3: No KGI /order/create | PASS |
| E4: No redaction policy violation | PASS — rawPnl is synthetic backtest, not user PII |

## 4. Findings — Priority Ranked

### Blockers (must fix before ready)
None.

### Suggestions (should fix)

1. **[Architecture gap]**: `loadStrategySnapshot()` is defined in `openalice-pipeline.ts` but
   NOT called within `generateDailyBrief()` (the `runPipelineTick` code path, lines 451-504).
   Strategy wiring exists ONLY in the legacy `server.ts` dispatcher (line 6414). Result: the
   new `runPipelineTick` pipeline flow (the main PR #238 path) produces briefs WITHOUT strategy
   context. The two dispatch paths are not symmetric.
   - Location: `openalice-pipeline.ts` lines 451-504 vs `server.ts` line 6414.
   - Suggested fix: call `loadStrategySnapshot()` inside `generateDailyBrief()` and append
     strategy instructions before enqueue. OR document explicitly which dispatcher is canonical
     and retire the other.

2. **[rawPnl exposed in AI prompt]**: `server.ts:6419` interpolates `rawPnl` and `maxDd` into
   the AI instruction string sent verbatim to the LLM. These are real backtest TWD figures.
   The red-tier classifier (`classifyDraftTier`) does NOT scan the *instructions* string — it
   only scans the *generated output* payload. So if the LLM mirrors these numbers into the
   brief body as "performance" claims, the yellow gate would catch it (keyword "metrics") but
   only route to `awaiting_review`, not hard-reject. This is within acceptable risk for an
   operator-only tool, but the intent coupling is worth clarifying.
   - Location: `server.ts` line 6419.
   - Suggested fix: replace `rawPnl=${s.latestSummary.rawPnl} TWD` with a qualitative descriptor
     ("positive/negative edge signal") to avoid any downstream quoting of raw TWD figures.

### Nits (nice to have)

1. `latestSummary.rawPnl` field name is a misleading export surface — "rawPnl" implies a
   publishable profit figure. Rename to `backtestNetTwd` or similar to make the backtest-only
   semantics explicit at the type level.

2. Test 11 accepts `null` as a valid outcome when the snapshot file is not resolvable from test
   runner CWD. This means the NOT_PAPER_READY caveat assertion (line 289) is only exercised when
   the file resolves — which depends on CWD at runtime. Consider a fixture path for deterministic
   coverage.

### Praise

- `loadStrategySnapshot()` try/catch is textbook graceful degradation: file-not-found, malformed
  JSON, empty array — all return null with no throw. Exactly what the review focus asked for.
- All 4 strategies carry `NOT_PAPER_READY` as first caveat. Athena verdict alignment confirmed.
- `classifyDraftTier` yellow gate for "strategy" keyword is correct: strategy content goes to
  `awaiting_review`, never auto-publishes. Test 12 explicitly covers this.
- Red-tier patterns cover buy/sell/進場/賣出/買進/出脫/目標價/guarantee/必賺/勝率/Sharpe. No
  fake-Sharpe passes through. No order-placement call anywhere in the diff.

## 5. Verdict
- [x] APPROVED — 0 blockers; 2 suggestions (architecture gap + rawPnl in prompt); merge viable.

Note: "architecture gap" (suggestion #1) is flagged as suggestion not blocker because the
server.ts dispatcher is the live-path today. If PR #238 intends to migrate to runPipelineTick
as the canonical dispatcher, owner should fix before next PR in the chain — otherwise technical
debt accretes.

## 6. Suggested Owner for Fixes
- Suggestion #1 (architecture gap) → Jason + Elva to confirm which dispatcher is canonical
- Suggestion #2 (rawPnl in prompt) → Jason (1-line change in server.ts:6419)

## 7. Re-review Required
NO — suggestions only; no blocker.

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint
