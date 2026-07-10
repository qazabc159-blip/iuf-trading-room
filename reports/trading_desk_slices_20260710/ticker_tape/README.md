# Ticker Tape — Evidence (2026-07-10)

Epic slice: `reports/epic_trading_desk_20260702/EPIC_TRADING_DESK_EXCHANGE_GRADE.md` (S5 relative — dispatch
broadened scope to a site-wide layout banner, not scoped to the trading-room iframe click-to-switch behavior).

Branch: `feat/ticker-tape-jim-20260710`. Component: `apps/web/components/TickerTape.tsx` +
`TickerTape.module.css`, pure helpers in `apps/web/lib/ticker-tape.ts` (+ `.test.ts`, 15 vitest assertions).
Wired at root layout level (`apps/web/app/layout.tsx`), consumes the **existing**
`GET /api/v1/market-data/overview` endpoint (already called server-side by the homepage and `/m` mobile
brief) — zero new backend, one client-side request per page load.

## Verification method (why some screenshots are mocked)

Ran a real local `next dev` server (port 3100 — port 3000 was already held by another concurrent worktree
session) with `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`, real owner session
(`auth.setup.ts`, `SEED_OWNER_*` from `railway variables --service api --kv`), via Playwright
(`packages/qa-playwright/tests/jim_ticker_tape_20260710.spec.ts`).

The prod API's CORS allowlist (`CORS_ORIGINS` on the Hono server) only allows the real prod web origin
(`https://app.eycvector.com`) — a `localhost:*` origin gets a genuine browser CORS rejection calling
`market-data/overview` directly. This is a **pre-existing, already-documented local-harness limitation**
(same wall `apiGetMe()` in `auth-client.ts` hits under identical conditions; see per-agent memory
`local_playwright_cross_site_cookie_2026_07_09.md` from a prior round), not specific to this component,
and does not affect prod (prod's CORS allowlist includes the real web origin — same pattern already
proven working via the account menu / `apiGetMe()` on every page).

- `ticker_tape_desktop_track_record_live_desktop-chromium.png` — **mocked** realistic payload
  (`page.route()` intercept, `overviewFixture({state:"LIVE"})` in the spec), proves full rendering:
  colors (2330 +1.38% red/up, 2317 -0.47% green/down — Taiwan convention, reusing `--tw-up-bright` /
  `--tw-dn-bright`), tabular-nums, header-dock non-overlap, marquee content.
- `ticker_tape_desktop_empty_state_desktop-chromium.png` — **mocked** EMPTY backend state (no
  index/heatmap payload, matching what a real EMPTY response shape looks like) — shows the honest
  "目前沒有盤面資料" message, zero fabricated numbers, zero scrolling item track.
- `ticker_tape_desktop_real_network_honest_degrade_desktop-chromium.png` — **real, unmocked** network
  call against the actual local-harness CORS wall — the actual regression guard: proves the component
  never crashes and always lands on one of the four honest states (`live`/`close`/`delayed`/`empty`)
  instead of showing fake data or an uncaught error, verified against the true failure path.
- `ticker_tape_mobile_390_track_record_mobile-iphone-13.png` — 390px viewport, mocked LIVE payload,
  height asserted `<=32px`, no horizontal page scroll.
- `ticker_tape_reduced_motion_track_record_desktop-chromium.png` — `reducedMotion: "reduce"` browser
  context; asserted `getComputedStyle(trackInner).animationName === "none"`.

## Not yet verified (needs post-deploy prod check)

Real live/close quote numbers rendering in prod (the local harness can only prove the honest-degrade path,
not the actual live-number-population path, per the CORS limitation above). **Next for Bruce**: after
merge+deploy, load any non-`/`/`/login`/`/register`/`/m` page on `https://app.eycvector.com` during trading
hours and confirm the ticker shows real TAIEX + weighted-stock quotes (not stuck on "尚無資料").
