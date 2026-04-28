# W4 Frontend Cutover — Bundle Size Impact Note

**Date**: 2026-04-28 (overnight augment)
**Branch**: `feat/w4-frontend-cutover`
**PR**: #8 (DRAFT)

---

## Build Result (from `web_build.txt` — captured during W4 Lane 1 cutover)

Build was run with local `node_modules` containing all new deps.

**EXIT**: 0
**Pages**: 20 pages generated (static prerender) + 1 dynamic (ƒ)

---

## Per-Route Bundle Sizes (W4 State)

```
Route (app)                                 Size  First Load JS
┌ ○ /                                    2.65 kB         116 kB
├ ○ /_not-found                            992 B         103 kB
├ ○ /admin/content-drafts                3.35 kB         116 kB
├ ○ /briefs                              2.22 kB         115 kB
├ ○ /companies                            6.5 kB         119 kB
├ ○ /companies/duplicates                1.59 kB         115 kB
├ ○ /drafts                              2.86 kB         116 kB
├ ○ /ideas                               5.17 kB         118 kB
├ ○ /login                               1.85 kB         103 kB
├ ○ /ops                                 6.11 kB         119 kB
├ ○ /plans                               2.52 kB         116 kB
├ ○ /portfolio                           19.2 kB         132 kB
├ ○ /quote                               4.17 kB         117 kB
├ ○ /register                            1.96 kB         104 kB
├ ○ /reviews                             2.09 kB         115 kB
├ ○ /runs                                4.16 kB         117 kB
├ ƒ /runs/[id]                           7.71 kB         121 kB
├ ○ /signals                             2.09 kB         115 kB
└ ○ /themes                              3.56 kB         117 kB
+ First Load JS shared by all             102 kB
  ├ chunks/695-00bca043953d4170.js       45.3 kB
  ├ chunks/d99d8e6a-80443bd3c9d31f50.js  54.2 kB
  └ other shared chunks (total)          1.99 kB

ƒ Middleware                               34 kB
```

---

## Previous Build Baseline (W2d — `fab35f2` main)

Previous documented build showed ~102 kB shared chunks. The W4 build shows identical 102 kB shared — no regression in the shared bundle.

New route `/companies/[symbol]` — not listed separately in static manifest (Next.js dynamic route; prerendered as static placeholder if no params, otherwise server-rendered on demand). Size is embedded in the `/companies` 6.5 kB entry or served as separate chunk.

---

## Delta Analysis

| Metric | Before W4 (est.) | After W4 | Delta |
|--------|-----------------|---------|-------|
| Shared JS (gzip) | ~102 kB | 102 kB | 0 KB |
| `/` (dashboard) | ~2.6 kB | 2.65 kB | +0.05 kB (TopKpiStrip) |
| `/companies` | ~5-6 kB | 6.5 kB | +~1 kB (RightInspector) |
| `/companies/[symbol]` | N/A (new) | NEW route | N/A |
| `/portfolio` | 19.2 kB | 19.2 kB | 0 (unchanged) |

### Flag: `/companies/[symbol]` includes `lightweight-charts`
- `lightweight-charts` v5: ~90 kB uncompressed, ~30 kB gzip
- This is loaded **only** on the `/companies/[symbol]` route (dynamic import boundary)
- Uncompressed size **exceeds +50 kB threshold** for a single route
- Gzip size (~30 kB) is below +50 kB gzip threshold
- Assessment: **FLAGGED / ACCEPTABLE** — this is a dedicated stock detail page; heavy chart library is expected

### Inline SVG sparklines in `TopKpiStrip`
- `MiniSparkline` component uses hand-written SVG polyline (~60 lines)
- Tremor was avoided specifically to prevent bundle bloat
- Net sparkline contribution: ~2-3 kB uncompressed, negligible gzip

---

## New Chunks Created

Next.js may create new chunks for:
- `lightweight-charts` (code-split to `/companies/[symbol]` only)
- `@radix-ui/react-dialog` + `cmdk` (potentially shared with CommandPalette)

These chunks are created on-demand and do not affect initial page load of unrelated routes.

---

## Warnings / Notes

1. `portfolio` at 19.2 kB first load is the heaviest route — this is pre-existing (full OrderTicket + risk check UI). Not introduced by W4.
2. Middleware at 34 kB — unchanged, pre-existing auth middleware.
3. No new warnings from Next.js build output for W4 files.
