# Codex Dashboard Data Truth - 2026-05-06

## Summary

- PR slice: dashboard data-truth repair.
- Trade Capability Score: +1.
- Workflow improved: the first page no longer treats stale signals, empty OpenAlice rows, failed auth, or blocked backend sources as today trading intelligence. It routes the operator toward company page K-line/paper preview, portfolio readout, daily brief status, and ops diagnostics.
- Scope: frontend only. No backend schema, DB migration, KGI write-side, Railway secret, token, or order route changed.

## Files

- `apps/web/app/page.tsx`
- `apps/web/components/PageFrame.tsx`
- `apps/web/app/globals.css`

## Sources / Endpoints

- `GET /api/v1/data-sources/finmind/status`
- `GET /api/v1/diagnostics/finmind`
- `GET /api/v1/market-data/overview`
- `GET /api/v1/ops/snapshot`
- `GET /api/v1/themes`
- `GET /api/v1/ideas`
- `GET /api/v1/signals`
- `GET /api/v1/runs`

## Behavior

- Dashboard is now framed as `資料健康與交易工作流`, not as a fake news/intelligence page.
- LIVE / EMPTY / BLOCKED semantics are explicit on each source group.
- Stale or unavailable source groups are moved into a "not today's intelligence" lane instead of being removed or shown as live.
- Formal order remains marked as locked; paper workflow is described as preview and risk explanation only.
- PageFrame labels are restored to clean Traditional Chinese and paper wording.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Local production visual QA at `http://127.0.0.1:3350/` PASS:
  - Desktop 1365px screenshot: `evidence/w7_paper_sprint/local_visual_qa_dashboard_truth_2026-05-06/desktop1365_dashboard_truth.png`
  - Mobile 390px screenshot: `evidence/w7_paper_sprint/local_visual_qa_dashboard_truth_2026-05-06/mobile390_dashboard_truth.png`
  - Manifest: `evidence/w7_paper_sprint/local_visual_qa_dashboard_truth_2026-05-06/manifest.json`

## Stop-Line Proof

- No token value in UI/log/evidence.
- No fake-live conversion.
- No live submit.
- No KGI/broker write-side.
- No migration/schema/destructive DB action.
- No FinMind/TradingView paper fill or risk source change.
- No buy/sell recommendation wording.
- No strategy metrics, Sharpe, equity curve, win rate, or ranking.

## Known Caveat

Local visual QA used a non-secret local session marker only. The API correctly returned invalid-session BLOCKED states, which verifies the no-fake-live behavior. A production logged-in source-health smoke still belongs to Bruce or a valid session holder and should not require storing credentials in evidence.
