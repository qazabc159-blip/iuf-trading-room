# Trading Room Live Price Pulse - 2026-06-02

Scope:
- Frontend-only trading-room quote pulse.
- No broker write path changes.
- No real-order promotion.
- K-line iframe is not reloaded by the pulse.

Change:
- Adds `refreshPaperQuotePulse()` for `/api/v1/companies/:id/quote/realtime`, `/api/v1/kgi/quote/bidask`, and `/api/v1/kgi/quote/ticks`.
- Updates selected price, header quote, watchlist row, order preview price, five-level depth, and tape from live quote/tick data.
- Keeps the full `refreshClientLive()` hydration at 15 seconds, but adds a lighter 3-second quote pulse for live market feel.
- Adds a single-interval guard and 15-second backoff when quote endpoints are unavailable, so a degraded quote source does not spam requests.

Local verification:
- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

Browser verification:
- URL: `http://127.0.0.1:3037/api/ui-final-v031/paper-trading-room?rev=local-live-pulse-mock&symbol=2330`
- Mocked quote source only for local frontend verification.
- Result:
  - `selected.price` updated to `2360`.
  - Five-level depth updated from bid/ask data.
  - Tape updated from tick data.
  - K-line iframe source stayed stable: `/final-v031/portfolio/kline-frame?symbol=2330`.

Screenshots:
- `evidence/w7_paper_sprint/screenshots/trading-room-local-live-pulse-mock-20260602.png`
- `evidence/w7_paper_sprint/screenshots/trading-room-local-live-pulse-backoff-20260602.png`

Pending after merge:
- Production owner-session verification against real KGI quote/ticks during market hours or gateway-live window.
