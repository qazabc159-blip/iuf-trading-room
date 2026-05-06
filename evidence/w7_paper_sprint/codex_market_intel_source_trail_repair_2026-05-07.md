# Codex Market Intel Source-Trail Repair - 2026-05-07

Status: READY FOR PR
Trade Capability Score: +1

## Scope

Repaired `/market-intel` from a corrupted / mojibake surface into a source-traced market intelligence page.

Changed file:

- `apps/web/app/market-intel/page.tsx`

## User-Visible Workflow Improved

The operator can now open `重大訊息` and understand:

- which official source is being queried,
- which symbols are in the current observation pool,
- whether TWSE OpenAPI announcements returned LIVE / EMPTY / BLOCKED,
- how many announcement rows and affected companies were returned,
- whether some symbol lookups failed,
- whether FinMind TaiwanStockNews is LIVE / EMPTY / BLOCKED / DEGRADED,
- and that no unapproved news feed or AI summary is being shown as official content.

## Endpoints / Sources

- `GET /api/v1/companies`
- `GET /api/v1/strategy-ideas?decisionMode=paper&includeBlocked=true&limit=20&sort=score`
- `GET /api/v1/companies/:id/announcements?days=30`
- `GET /api/v1/data-sources/finmind/status`

## State Semantics

- `LIVE`: at least one official TWSE announcement row is returned.
- `EMPTY`: official routes responded, but selected symbols have no announcement rows in the last 30 days.
- `BLOCKED`: company list or announcement route fails enough that the page cannot honestly present a feed.
- FinMind TaiwanStockNews is shown only as dataset state and row freshness; it is not rendered as a news feed unless backend rows exist.

## Stop-Line Proof

- No FinMind token value is rendered or logged.
- No `/order/create`.
- No KGI write-side.
- No real submit.
- No fake live announcement.
- No buy/sell recommendation.
- No Sharpe / equity curve / win rate / strategy ranking.
- No FinMind or K-line data is used as fill or risk source.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build`: PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`: PASS
- `pnpm.cmd --filter @iuf-trading-room/web build`: PASS
- `git diff --check`: PASS, CRLF warning only
- Mojibake sentinel scan on `apps/web/app/market-intel/page.tsx`: PASS
- Added-line stop-line grep: PASS

## Next

After merge/deploy, the next useful slice is either:

- production smoke of `/market-intel` with real authenticated session, or
- backend/frontend follow-up to render stored `tw_stock_news` rows if the backend exposes a safe read-only listing endpoint.
