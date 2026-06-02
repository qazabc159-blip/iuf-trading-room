# Trading Room Fast Shell Evidence - 2026-06-02

## Scope

Fixes the Trading Room first-paint bottleneck without removing any real data wiring.

The `/api/ui-final-v031/paper-trading-room` HTML response no longer blocks on paper portfolio, fills, orders, KGI positions, KGI status, strategy ideas, company lookup, quote, bid/ask, ticks, or OHLCV before returning the shell. The real data still loads through the existing client refresh path immediately after first paint and then continues on the existing 15 second refresh interval.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
  - 28 files passed
  - 247 tests passed
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Local Route Timing

Target: `http://127.0.0.1:3033/api/ui-final-v031/paper-trading-room?rev=portfolio`

After first Next compile:

| Run | Response time |
| --- | ---: |
| 2 | 360.9 ms |
| 3 | 206.4 ms |
| 4 | 237.4 ms |
| 5 | 203.4 ms |

The response includes `fastShell: true`.

## Browser Smoke

Target: `http://127.0.0.1:3033/api/ui-final-v031/paper-trading-room?rev=portfolio`

- `.troom` visible: 395 ms
- `#real-kline-frame` visible: 423 ms
- page width: 1200 / scroll width: 1200
- right panel width: 320 / scroll width: 318
- K-line frame: 632 x 471

Screenshot:

`evidence/w7_paper_sprint/screenshots/trading-room-local-fast-shell-20260602.png`

## Production Owner Session Baseline Before This PR

After PR #903, production owner-session verified:

- `/portfolio` iframe width: 1200
- no horizontal overflow
- right order panel visible
- paper and KGI SIM buttons visible
- switching `2330 -> 1514` updates the embedded K-line frame
- K-line frame remains stable after 10 seconds
- indicator toggles do not resize the canvas

Screenshot:

`evidence/w7_paper_sprint/screenshots/trading-room-prod-owner-switch-1514-20260602.png`

