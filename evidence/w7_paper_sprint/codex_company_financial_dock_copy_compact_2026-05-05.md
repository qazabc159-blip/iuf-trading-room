# Codex Company Financial Dock Copy Compact - 2026-05-05

Status: READY FOR REVIEW

## Scope

- Page: `apps/web/app/companies/[symbol]`
- Component: `FinancialsPanel`
- Source: official FinMind company datasets surfaced by existing web API helpers.

## Change

- Cleaned the company financial dock copy to readable Traditional Chinese.
- Kept every table paginated at 10 rows per page so valuation / market value rows do not push the page into long empty vertical space.
- Added full date + Taipei time to the source-state line so data freshness is not ambiguous.
- Preserved source semantics:
  - `正常` = live official dataset rows returned.
  - `無資料` = official endpoint returned zero rows.
  - `暫停` = endpoint/read path blocked or failed.
  - `載入中` = fetch pending.

## Tests

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS, only CRLF normalization warning

## Stop-line Proof

- No token value added.
- No fake data added.
- No KGI write-side path touched.
- No live submit path touched.
- No migration / DB / backend schema touched.

## OpenAlice Freshness Note

OpenAlice old content is not a frontend refresh problem. The frontend can only reveal freshness truthfully. New daily content requires the backend worker / daily brief generation chain to produce a new source-traced brief. Until that lands, UI must show stale / missing / blocked states instead of pretending the brief is current.
