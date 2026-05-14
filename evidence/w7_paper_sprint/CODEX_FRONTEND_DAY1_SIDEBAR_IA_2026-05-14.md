# CODEX Frontend Day 1 Evidence - Sidebar IA

Time: 2026-05-14 TST  
Branch: `feat/web-sidebar-ia-restructure-2026-05-14`  
Scope: `apps/web`

## Changes

- Reduced left tactical sidebar from 12 entries to 6 main entries:
  - 戰情台 -> `/`
  - 市場情報 -> `/market-intel`
  - AI 推薦 -> `/ai-recommendations`
  - 交易室 -> `/portfolio`
  - 公司 / 主題 -> `/companies`
  - 量化策略 -> `/quant-strategies`
- Added lucide icons for the 6 main entries while preserving the existing tactical sidebar shell.
- Added `HeaderDock` with bell drawer stub, briefs shortcut, system status stub, and account menu.
- Added 301 redirects in `apps/web/next.config.ts`:
  - `/ideas` -> `/ai-recommendations`
  - `/lab` -> `/quant-strategies`
- Removed `/ideas` from the middleware final-v031 rewrite map so the new redirect is not bypassed.
- Preserved `/lab/*` subroutes.
- Added Day 2-3 and Day 4-5 stub pages:
  - `/ai-recommendations`
  - `/quant-strategies`
- Updated command palette labels to match the new IA while keeping hidden routes reachable.

## Safety Notes

- Did not edit `apps/web/app/page.tsx`; 戰情台 homepage content remains untouched.
- Did not touch broker, risk, contracts, API, Lab repo, or shared contracts.
- New strategy page copy is SIM-only; no live broker path or live execution toggle was added.
- Stub pages show pending data states only; no fake score or fake recommendation data was introduced.

## Verification

- `pnpm install --frozen-lockfile` completed after the clean worktree needed workspace dependency links.
- `pnpm --filter @iuf-trading-room/contracts build` EXIT 0.
- `pnpm --filter @iuf-trading-room/web typecheck` EXIT 0.
- Dev server smoke: `http://127.0.0.1:3010`.
- Chrome headless visual smoke:
  - `evidence/w7_paper_sprint/screenshots/day1_ai_recommendations_desktop.png`
  - `evidence/w7_paper_sprint/screenshots/day1_ai_recommendations_bell_drawer.png`
  - `evidence/w7_paper_sprint/screenshots/day1_quant_strategies_mobile.png`
- Browser metrics:
  - `/ai-recommendations`: 6 sidebar entries, 4 dock buttons, dock drawer opens.
  - `/quant-strategies` mobile 390px: body width 390px, 6 sidebar entries, 4 dock buttons, no horizontal page overflow.
  - `/lab/three-strategy`: authenticated browser navigation stays on `/lab/three-strategy`; it does not redirect to `/quant-strategies`.
- Redirect smoke:
  - `/ideas` returns 301 -> `/ai-recommendations`.
  - `/lab` returns 301 -> `/quant-strategies`.
