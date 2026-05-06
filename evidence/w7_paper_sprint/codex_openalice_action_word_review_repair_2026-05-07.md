# Codex OpenAlice Action-Word Review Repair

Time: 2026-05-07 06:40 TPE
Branch: `fix-openalice-reviewer-action-word-nuance-2026-05-07`
Trade Capability Score: `+1`

## Problem

Production logs showed OpenAlice jobs were being claimed and completed, but the AI reviewer auto-rejected drafts with "Content contains a trading action word." This blocks the daily-content loop even when the draft only references factual market-data labels such as institutional buy/sell flow.

## Change

- `apps/api/src/openalice-ai-reviewer.ts`
  - Reviewer prompt now distinguishes actionable trade advice from factual Taiwan-stock source labels.
  - It explicitly does not reject source labels such as `tw_institutional_buysell`, `TaiwanStockInstitutionalInvestorsBuySell`, `買賣超`, or `三大法人`.
  - It still rejects actionable wording, target prices, guarantees, fallback templates, empty sections, and wrong-date drafts.
- `apps/api/src/openalice-pipeline.ts`
  - Publish-gate classifier now sanitizes source/dataset labels before running raw `buy` / `sell` legacy checks.
  - Explicit red-tier checks still catch "you should buy/sell", target price, guarantee, Sharpe, and win-rate claims.
- `apps/api/src/openalice-pipeline.test.ts`
  - Added regression coverage proving institutional buy/sell source labels remain Green while trade advice remains Red.

## Sources

- Production API logs: OpenAlice `/jobs/claim`, `/heartbeat`, and `/result` are returning 200.
- Production API logs: AI reviewer auto-rejected drafts due trading action words.
- Code paths: OpenAlice content draft reviewer and publish gate.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/api exec tsx src/openalice-pipeline.test.ts` PASS, 20 tests
- `pnpm.cmd --filter @iuf-trading-room/api build` PASS
- `git diff --check` PASS with CRLF warnings only

## Stop-Lines

No token value, no OpenAI key value, no FinMind secret touch, no order route, no KGI write-side, no migration/schema/destructive DB, no fake daily brief, no buy/sell recommendation, no strategy metric.
