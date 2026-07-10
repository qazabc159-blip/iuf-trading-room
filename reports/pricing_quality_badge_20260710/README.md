# Pricing-quality badge + homepage padding align — 2026-07-10 (Jim)

Two independent Pete-review follow-ups in one DRAFT PR, branch
`feat/pricing-quality-badge-jim-20260710`.

## 1. `pricingQuality` degraded-pricing badge (Pete #1192)

`GET /api/v1/portfolio/f-auto/nav` now marks each `navCurve` point
`"official" | "mis_fallback_full"` (#1192, 2026-07-09). Wired into the shared
`FAutoNavPanel.tsx` (`/ops/f-auto` + `/track-record`):

- Curve level: an amber annotation line (reusing `DataStateBadge` `state="delayed"`,
  same four-state honest-vocabulary component as the rest of the product) appears
  only when at least one point in the curve is `mis_fallback_full`. Plain-Chinese
  copy — "以驗證行情回退計算（非官方收盤）" — no raw enum literal in the UI.
- Weekly table: a compact `DataStateBadge` dot next to the `W{n}` label on any
  week whose date range contains a degraded point.
- `official` (or the field simply absent, e.g. `/track-record`'s public whitelist
  payload, which doesn't carry this field at all) renders nothing extra — no noise.

Pure decision helpers (`hasDegradedPricing` / `degradedPricingCount` /
`weekHasDegradedPricing`) live in a hook-free `apps/web/lib/fauto-nav-pricing-quality.ts`,
unit-tested directly with fixture arrays (both all-official and mixed) in
`fauto-nav-pricing-quality.test.ts` — matches this repo's existing pattern for
component-adjacent pure logic (`weekly-review-format.ts`, `member-quote-cap.ts`).

## 2. Homepage `.tac-content` 981-1000px padding desync (Pete #1198 💭)

Mobile M5 (#1198, merged just before this round) moved `.tactical-dashboard`'s
single-column collapse to `@media (max-width: 1000px)` but left `.tac-content`'s
padding override at the old `980px` block — a 981-1000px band rendered the
single-column stack with the desktop 32px gutter instead of the narrower mobile
one. Moved `.tac-content` into the 1000px block (see `globals.css` comment
near line ~14304).

## Screenshots (this directory)

- `tac_content_padding_995px_desktop-chromium.png` — computed
  `.tac-content` `padding-left` = `18px` at 995px (mid-band; was `32px` before
  the fix, real Playwright run against prod data confirmed the regression
  before moving the rule and the fix after).
- `tac_content_padding_1001px_desktop-chromium.png` — boundary check,
  `padding-left` = `32px` unaffected just above the collapse breakpoint.
- `fnav_1280px_ops_f_auto_desktop-chromium.png` — `/ops/f-auto` at 1280px:
  page-level overflow assertion passed. Visual content was blocked by a
  pre-existing local-harness artifact (client-side `apiGetMe()` Owner gate
  false-negatives under a rewritten-domain cookie talking cross-origin to the
  prod API from `localhost` — same class of issue previously logged for
  `/portfolio`'s embedded iframe, not something introduced by this change).
- `fnav_1280px_track_record_desktop-chromium.png` — `/track-record` (same
  shared `FAutoNavPanel`, no Owner gate) at 1280px: full real render, no
  layout regression, no badge (prod ledger data is currently all official —
  correctly renders quiet).
- `fnav_390px_track_record_mobile-iphone-13.png` — same page at 390px, no
  regression to the M3 weekly-table scroll-wrapper fix.

## Verification commands run

```
pnpm typecheck                          # 15/15 green
pnpm --filter @iuf-trading-room/web test  # 505/505 green (+9 new)
pnpm run build:web                      # all routes compile clean
npx playwright test tests/jim_pricing_quality_badge_20260710.spec.ts \
  --project=desktop-chromium --project=mobile-iphone-13   # 6/6 pass (5 self-skip on the other project)
```

Local dev server run against the live prod API
(`NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`) with a real
`SEED_OWNER_*` session cookie (railway CLI → `/auth/login` → `auth.setup.ts`'s
existing cookie-domain rewrite), same recipe as prior mobile rounds.
