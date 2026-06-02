# Trading Room Layout + K-line Stability PR Evidence — 2026-06-02

## Scope

- Trading Room final-v031 shell only.
- K-line iframe embedding and order-ticket layout containment.
- No broker write path, no real-order promotion, no KGI live write.

## Fixed

- Right order ticket no longer creates horizontal overflow in desktop trading room.
- Real K-line iframe is marked `scrolling="no"` and isolated with `contain: layout paint`.
- Same-symbol live hydration no longer calls K-line frame update on every refresh.
- K-line frame reloads are counted through `window.__IUF_REAL_KLINE_FRAME_RELOAD_COUNT__` for browser regression checks.
- Unauthenticated K-line state no longer exposes raw JSON such as `{"error":"unauthenticated"}`; it shows a product-readable owner-session message.

## Browser Verification

- URL: `http://127.0.0.1:3000/api/ui-final-v031/paper-trading-room?symbol=2330&rev=layout-final-browser`
- Viewport: 1920 x 1080
- Screenshot: `evidence/w7_paper_sprint/screenshots/trading-room-local-final-layout-stability-20260602.png`

Measured in browser after waiting for quote pulse:

- body horizontal overflow: `0`
- trading-room grid horizontal overflow: `0`
- right ticket pane horizontal overflow: `0`
- order form horizontal overflow: `0`
- real K-line iframe shell horizontal overflow: `0`
- real K-line frame reload count after wait: `0`
- frame symbol: `2330`

## Tests

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
- `pnpm.cmd --filter @iuf-trading-room/qa-playwright typecheck`

## Notes

- Local browser verification used production API base but did not have owner cookies, so K-line data correctly showed an authenticated-data degraded state instead of fake K-line data.
- Owner-session production smoke remains the source of truth for live K-line data visibility after deploy.
