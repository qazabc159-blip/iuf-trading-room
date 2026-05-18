# P0 Home Market Intel AI News Frontend Gate

## Scope

- Page: `/` homepage, `MARKET INTEL` panel.
- Change: consume `GET /api/v1/market-intel/news-top10` before official announcements so AI-selected market news is visible on the homepage.
- Truth state: keep `GET /api/v1/market-intel/announcements?days=30&limit=20&scope=market` as an official-announcement source; when it returns empty, show `官方公告暫無` instead of leaving a large blank panel.

## Production Source Snapshot

- `news-top10`: 10 items, `selection_mode=ai`, `input_row_count=77`, `stale_reason=last_run_over_11h_ago`.
- `announcements`: 0 items, `source=empty`, `stale_reason=no_official_market_announcements`.

## Browser Evidence

- Desktop: `local-home-market-intel-panel.png`
- Mobile: `local-home-market-intel-panel-mobile.png`
- Desktop JSON: `local-browser-verify.json`
- Mobile JSON: `local-browser-verify-mobile.json`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke against local Next dev server with production API and owner cookie.

## Notes

- No mock news added.
- No fake official announcements added.
- `last_run_over_11h_ago` is retained in evidence JSON but translated in UI to `上次 AI 精選已超過 11 小時，等待排程更新`.
- Scheduler freshness remains a Jason/Elva backend owner item.
