---
verifier: Bruce
date: 2026-05-12 ~22:30 TST
scope: Wave 2 Partial Verify — PR #391 #392 #393
deployment_context: PR #391 (4cb7d55) deployed at 14:45 UTC; PR #392+#393 CI pass → deploy completed 14:57 (PR#393) and 15:08 (PR#394)
---

## == Bruce Wave 2 Partial Verify 2026-05-12 ==

```
PR #391 v47 UI: PASS — compoundReturn render hits=0 (JS bundles clean), 3-col grid=YES, common-window=YES
PR #392 brief backfill publish: PASS — 5/8/5/11/5/12 all status=published
PR #393 market data backfill:
  companies_ohlcv:
    ingest-status rowCount: 0 (DISPLAY BUG in PR #393 count query)
    finmind/status TaiwanStockPriceAdj rowCount: 28917 (LIVE, latestDate=2026-05-12) — TRUE state
    backfill endpoint: BROKEN — skipReason=no_tickers (bug: missing Array.isArray fallback at finmind-full-ingest.ts line 782)
  tw_institutional_buysell:
    ingest-status rowCount: 42405 state=LIVE (continuous auto-ingest + smoke backfill)
    backfill endpoint smoke (batch_size=5): tickersAttempted=5 rowsUpserted=175 state=synced PASS
  tw_margin_short:
    ingest-status rowCount: 10389 state=LIVE
    backfill endpoint smoke (batch_size=5): tickersAttempted=5 rowsUpserted=35 state=synced PASS
  state=LIVE: PARTIAL — tw_institutional_buysell + tw_margin_short LIVE; companies_ohlcv LIVE (real data) but ingest-status display BROKEN
v47 scanner P0 count: 0 — compoundReturn removed from all JS bundles (4 chunks verified: 7246, 8519, 5288, a71a, main-app all 0 hits)
Production broker write: 0 — stop-line scan clean on all 3 PRs
Token leakage: FALSE — no hardcoded secrets in diff
Verdict: WAVE2_PARTIAL_PASS_WITH_DEFECTS
Next Owner: Jason (2 bugs), Codex/Jim (1 stop-line risk)
```

---

## Deployment Chain (verified)

| SHA | PR | GHA Deploy | Railway StartedAt | Status |
|-----|-----|-----------|------------------|--------|
| 4cb7d55 | #391 v47 UI closure | SUCCESS 14:45 UTC | 14:48 UTC | LIVE |
| 30c7031 | #392 brief backfill | CI cancelled (merged under #391) | — | MERGED INTO #393 CHAIN |
| 47ff774 | #393 market data backfill | SUCCESS 14:54 UTC | 15:03 UTC | LIVE |
| b207a4b | #394 structural ordering v47 API | SUCCESS 15:08 UTC | pending restart | IN FLIGHT |

---

## PR #391 — v47 UI Closure (4cb7d55) PASS

### compoundReturn render path check
- `StrategyChartPanel.tsx:334`: comment only: `// v47: only use strategyNetAbsoluteReturnPct (compoundReturn removed from render path)`
- `StrategyDetailClient.tsx:53`: comment only + hardcode replaced: `compoundReturn` removed, `strategyNetAbsoluteReturnPct: 2.2202` used
- `lib/api.ts:2275`: TypeScript type definition only (`compoundReturn?: number`) — not render path
- JS bundles verified (curl): 7246, 8519, 5288, a71a5595, main-app — ALL 0 hits for `compoundReturn`
- Production HTML at `/lab/three-strategy/cont_liq_v36`: `compoundReturn` NOT present

**VERDICT: compoundReturn render hits = 0. PASS.**

### 3-column grid (ExcessVs0050Card)
- `StrategyChartPanel.tsx:377-394`: `gridTemplateColumns: "repeat(3, 1fr)"` with:
  - Col 1: 策略絕對報酬 (strategyNetAbsoluteReturnPct)
  - Col 2: 0050 同窗報酬 (benchmark0050ReturnPct)
  - Col 3: 超額報酬 (excessVs0050Pp)
- Production HTML: `repeat(3,` found 2 hits (inline styles)
- **VERDICT: 3-col grid = YES. PASS.**

### Common-window dates (v47 canonical)
- `StrategyDetailClient.tsx:119-120`:
  - `commonWindowStart: "2025-04-10"` ← v47 canonical
  - `commonWindowEnd: "2026-03-06"` ← v47 canonical
- Production HTML: `2025-04-10` found 8 hits, `2026-03-06` found 8 hits
- **VERDICT: common-window dates correct. PASS.**

### STOP-LINE RISK (P2 — not deploy-blocking for lab page)
- `StrategyChartPanel.tsx:382,387,392`: Engineering field names rendered as 9px sub-labels:
  - `strategyNetAbsoluteReturnPct`, `benchmark0050ReturnPct`, `excessVs0050Pp`
- Per product-grade UI rule: "UI 不准 surface enum / debug wording"
- Mitigating factor: /lab/three-strategy is internal research tool, not product page
- **Owner: Codex/Jim** — replace 9px labels with Chinese descriptions or remove
- P2: fix before next lab page promotion, not blocking Wave 2

---

## PR #392 — Codex Brief Backfill Fix (30c7031) PASS

### Brief publish status
| Date | status | id (prefix) |
|------|--------|-------------|
| 2026-05-08 | published | bede2d1f |
| 2026-05-11 | published | d6acc58c |
| 2026-05-12 | published | 5a18441d |
| 2026-05-07 | published | 74ca1324 |
| 2026-05-03 | published | 1cb0e978 |

5/8, 5/11, 5/12 all published. **PASS.**

### PR #392 code changes
- `openalice-pipeline.ts`: `buildSourceOnlyBriefPayload()` + `evaluateSourceOnlyBackfillGate()` + `tryPublishSourceOnlyBackfillDraft()` 
- Source-only backfill uses confidence=0.72, reviewerVerdict="approve" — passes evaluatePublishGate
- Tests: CI confirmed in GHA run before merge

---

## PR #393 — Market Data Source Backfill (47ff774) PARTIAL_PASS

### companies_ohlcv
**Backfill endpoint result:**
```json
{"tickersAttempted":0,"rowsUpserted":0,"skipped":true,"skipReason":"no_tickers","state":"synced"}
```

**BUG CONFIRMED: `finmind-full-ingest.ts` line 782**
```ts
// BROKEN: missing Array.isArray fallback
const allCompanies = ((companyRows as { rows?: Record<string, unknown>[] })?.rows ?? []) as Record<string, unknown>[];
// SHOULD BE (like other DB result parsers in the same file):
const allCompanies = ((companyRows as {rows?:...})?.rows ?? (Array.isArray(companyRows) ? companyRows : [])) as ...
```
When `db.execute()` returns a plain array (not `{rows: [...]}`), `companyRows.rows` is `undefined` → `allCompanies = []` → `ohlcvTickers = []` → `runOhlcvFinmindSync([])` → `tickersAttempted=0`.

**ACTUAL companies_ohlcv state (via finmind/status):**
- rowCount = 28917 (from normal OHLCV scheduler sync, not backfill)
- latestDate = 2026-05-12
- state = LIVE
- circuitOpen = false

**ingest-status display bug (also PR #393):**
- `queryAllDatasetStatus()` line 622: same Array.isArray issue → rowCount=0 shown for companies_ohlcv
- True count is 28917 but display shows 0/EMPTY
- **Owner: Jason** — add Array.isArray fallback at line 622 and 782

### tw_institutional_buysell
- Backfill smoke (batch_size=5, from=2026-05-01, to=2026-05-12): `tickersAttempted=5 rowsUpserted=175 state=synced` PASS
- ingest-status: `rowCount=42405 state=LIVE lastIngestedAt=2026-05-12 15:07:50`
- Auto-ingest running continuously (row count increasing)

### tw_margin_short
- Backfill smoke (batch_size=5, from=2026-05-01, to=2026-05-12): `tickersAttempted=5 rowsUpserted=35 state=synced` PASS
- ingest-status: `rowCount=10389 state=LIVE lastIngestedAt=2026-05-12 15:08:13`

### Full batch_size=200 backfill status
- companies_ohlcv: CANNOT RUN (endpoint broken, no_tickers bug)
- tw_institutional_buysell: timeout (endpoint works, 3469 tickers × API calls = long-running, smoke verified only)
- tw_margin_short: timeout (endpoint works, smoke verified)

**NOTE**: The full batch_size=200 runs that the task spec requested cannot be verified synchronously — they take >120s. The endpoint works for tw_institutional_buysell and tw_margin_short (smoke verified). The auto-ingest scheduler is already running successfully for these tables.

---

## Stop-Line Verification (all 3 PRs)

| Check | Result |
|-------|--------|
| No broker write calls in PR diff | PASS — grep found no order/submit/buy/sell in changed lines |
| No hardcoded API keys/secrets | PASS — only process.env references and test assertions |
| No fake Sharpe/equity/winrate | PASS — no fabricated stats found |
| compoundReturn removed from render | PASS — 0 hits in JS bundles |
| Production broker write calls | 0 |

---

## Defect Summary

| # | Severity | Description | Owner | File |
|---|----------|-------------|-------|------|
| D1 | P1 | `runDatasetBackfill` companies_ohlcv: missing Array.isArray fallback → no_tickers | Jason | `finmind-full-ingest.ts:782` |
| D2 | P1 | `queryAllDatasetStatus` companies_ohlcv count: same parsing bug → shows 0 rows | Jason | `finmind-full-ingest.ts:622` |
| D3 | P2 | Lab page 3-col grid shows engineering field names (9px labels): strategyNetAbsoluteReturnPct etc | Codex/Jim | `StrategyChartPanel.tsx:382,387,392` |
| D4 | P2 | IUF_QUANT_LAB strategy_snapshots not pushed to GitHub → snapshot endpoint always 404 | Athena/Lab | `IUF_QUANT_LAB/reports/trading_room/strategy_snapshots/` |

---

## Can Deploy?

- PR #391: DEPLOYED, PASS
- PR #392: DEPLOYED (via #393 chain), PASS  
- PR #393: DEPLOYED, PARTIAL_PASS (endpoint works for 2/3 tables; companies_ohlcv has display+backfill bug but actual data is LIVE via scheduler)
- PR #394: GHA SUCCESS, Railway restart in flight

**OVERALL: WAVE2_PARTIAL_PASS. Safe to proceed.** D1+D2 are bug fixes for Jason (P1). D3+D4 are P2 non-blocking. The briefs pipeline is unblocked (5/8/5/11/5/12 published).

---

## Can Declare Live/收口?

**NOT YET.** Conditions not met:
1. D1: companies_ohlcv backfill endpoint broken (full historical range cannot be loaded on-demand)
2. D4: snapshot endpoint always 404 (IUF_QUANT_LAB files not pushed)
3. PR #394 Railway restart still in flight (API structural ordering not confirmed live)

**Can declare Wave 2 partial收口 for PR #391 + #392** (UI + brief pipeline) — these are clean.
**PR #393 收口 requires** Jason fixing D1+D2 (can be done in a quick patch PR).
