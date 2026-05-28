# Codex Portfolio Industry Label PR - 2026-05-29

## Scope

- Page: `/portfolio?symbol=2330`
- Surface: final-v031 paper trading room selected-symbol header and live symbol metadata.
- Goal: prevent My-TW-Coverage / company master English industry labels such as `Semiconductors` from leaking into the production trading-room UI.

## Change

- Normalize selected-symbol sector labels through the existing `industryLabel()` map before serializing paper-room payloads.
- Normalize the embedded final-v031 client header render path as a second guard.
- No backend, broker, KGI SIM, order, contract, migration, or F-AUTO code touched.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
- Production pre-fix browser capture confirmed `/portfolio?symbol=2330` exposed `Semiconductors` while the page otherwise loaded real paper/KGI-read-only surfaces.
- Local direct final-v031 browser smoke confirmed no `Semiconductors` text remains in the rendered trading room path.

## Evidence Paths

- Production pre-fix screenshot:
  `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_daily_smoke_fix_20260528\packages\qa-playwright\evidence\w7_paper_sprint\portfolio-prod-2330-initial-20260529.png`
- Production pre-fix JSON:
  `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_daily_smoke_fix_20260528\packages\qa-playwright\evidence\w7_paper_sprint\portfolio-prod-qa-20260529.json`
- Local fixed screenshot:
  `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_portfolio_i18n_20260529\packages\qa-playwright\evidence\w7_paper_sprint\portfolio-local-direct-2330-industry-i18n-20260529.png`
- Local fixed JSON:
  `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_portfolio_i18n_20260529\packages\qa-playwright\evidence\w7_paper_sprint\portfolio-local-direct-2330-industry-i18n-20260529.json`

