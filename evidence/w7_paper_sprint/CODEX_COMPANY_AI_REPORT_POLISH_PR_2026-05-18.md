# Company AI Analyst Report Polish - 2026-05-18

## Scope

- Frontend-only polish for `apps/web/app/companies/[symbol]/AiAnalystReportPanel.tsx`.
- No backend endpoint changes, no migrations, no broker/risk/contracts edits, no KGI write path, no real-order promotion.
- The change keeps the existing Brain ReAct owner-only flow and only replaces raw implementation labels with user-facing Traditional Chinese copy.

## Shipped

- Replaced visible internal copy:
  - `Brain ReAct Agent / Owner only` -> `Brain 推理 / Owner 唯讀`
  - `run_id: ...` polling text -> human-readable waiting copy
  - `REASON / ACT / OBSERVE` trace labels -> `推理 / 工具 / 觀察`
  - `[tool]` badge -> `工具：{tool}`
  - `Tokens` -> `用量`
- Clarified empty/submitting copy that the panel uses read-only data sources and does not create trade orders.
- Updated focused unit coverage for trace labels.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web exec vitest run "app/companies/[symbol]/ai-analyst-report-panel.test.ts"`
  - 23 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - Passed.
- Browser smoke against local Next dev + mock API:
  - `/companies/2330` loads with owner cookie.
  - Idle state shows read-only copy.
  - Generate flow reaches completed report.
  - Trace drawer shows `推理 / 工具 / 觀察`.
  - No visible `Brain ReAct Agent`, `Owner only`, `run_id:`, `REASON`, `ACT`, `OBSERVE`, or `Tokens`.
  - Mobile 390px check found no obvious horizontal overflow inside the AI report panel.
  - No browser console errors or page errors.

## Evidence Files

- `evidence/w7_paper_sprint/company-ai-report-polish-idle-desktop-1366x900.png`
- `evidence/w7_paper_sprint/company-ai-report-polish-complete-desktop-1366x900.png`
- `evidence/w7_paper_sprint/company-ai-report-polish-complete-mobile-390x844.png`
- `evidence/w7_paper_sprint/company-ai-report-polish-smoke-results.json`

## Notes

- The first smoke attempt failed because the mock OHLCV fixture generated invalid April dates after `2026-04-30`; the app correctly rejected those invalid dates. The fixture was corrected to generate legal ISO dates before the final passing smoke run.
