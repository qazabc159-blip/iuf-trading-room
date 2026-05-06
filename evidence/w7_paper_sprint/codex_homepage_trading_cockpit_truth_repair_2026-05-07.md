# Codex Homepage Trading Cockpit Truth Repair - 2026-05-07

Status: READY FOR PR
Branch: `fix-web-homepage-trading-cockpit-truth-2026-05-07`
Trade Capability Score: `+1`

## Why This Exists

The homepage had drifted into a stale and low-value surface: old or missing data, unclear workflow status, and Traditional Chinese label corruption from earlier page-frame text. This repair turns `/` back into the trading-room cockpit entry: data source health, company verification, OpenAlice daily workflow, paper workflow state, quant bundle gate, and market-intel gap are shown as explicit truth states.

## Files

- `apps/web/app/page.tsx`
- `apps/web/components/PageFrame.tsx`
- `evidence/w7_paper_sprint/homepage_truth_repair_2026-05-07_1365_auth.png`

## Source / Endpoint List

- `GET /api/v1/data-sources/finmind/status`
- `GET /api/v1/diagnostics/finmind`
- `GET /api/v1/market-data/overview`
- `GET /api/v1/ops/snapshot`
- `GET /api/v1/briefs`
- `GET /api/v1/content-drafts`
- `GET /api/v1/paper/health`
- `GET /api/v1/strategy-ideas`
- `GET /api/v1/strategy-runs`

## Behavior

- Homepage hero now explains the actual product mission: verified Taiwan-stock data, OpenAlice source trail, paper preview, and risk-controlled workflow.
- FinMind panel shows token presence, quota, tier, available/pending/blocked datasets, and latest request without exposing token values.
- Market panel shows tracked stocks, paper-preview readiness, blocked symbols, K-line availability, and latest quote timestamp.
- OpenAlice panel shows runner, dispatcher, queue, and daily-brief closure instead of vague healthy labels.
- Paper panel shows preview, submit, gate, queue, and final fill state while keeping real broker submission outside the UI.
- Quant panel shows only candidate/status readiness and explicitly withholds unapproved performance metrics.
- PageFrame Traditional Chinese labels were cleaned so global navigation/header strings stop showing corrupted or misleading wording.

## 4-State Semantics

- `LIVE`: source returned usable data.
- `EMPTY`: source returned no usable rows or a publishable item is missing.
- `BLOCKED`: source/API failed or backend did not return status.
- `HIDDEN`: no unsupported metric is displayed; unapproved quant metrics remain absent.

## Screenshot Manifest

```json
{
  "route": "/",
  "viewport": "1365x768",
  "screenshot": "evidence/w7_paper_sprint/homepage_truth_repair_2026-05-07_1365_auth.png",
  "authMode": "local cookie bypass for layout QA",
  "note": "Local API was not authenticated, so panels correctly render BLOCKED/EMPTY instead of fake LIVE."
}
```

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` - PASS
- `git diff --check` - PASS with CRLF warnings only
- Code diff stop-line grep - PASS
- 1365px browser screenshot - PASS

## Stop-Line Proof

- No token value in UI, logs, or evidence.
- No `/order/create` or real broker route added.
- No KGI SDK / broker write-side touched.
- No backend schema, migration, or destructive DB action.
- No fake live data; failed local calls render blocked states.
- No fake strategy metrics, Sharpe, equity curve, win rate, or ranking.
- No buy/sell recommendation.
- No FinMind/K-line used as fill price or risk gate.
