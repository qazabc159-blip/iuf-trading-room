# CODEX Overnight Evidence - Homepage Sidebar IA

Time: 2026-05-15 TST  
Branch: `feat/web-codex-home-sidebar-2026-05-15`  
Scope: B1 homepage sidebar parity

## Root Cause

The tactical homepage (`apps/web/app/page.tsx`) owns a local `TacticalSidebar` instead of using the root `Sidebar` component. PR #470 updated the app shell sidebar, but `/` still rendered its own hardcoded 12-entry nav.

## Change

- Updated only the local homepage `TacticalSidebar` nav list.
- Reduced homepage sidebar entries from 12 to the same 6-entry IA:
  - 戰情台 -> `/`
  - 市場情報 -> `/market-intel`
  - AI 推薦 -> `/ai-recommendations`
  - 交易室 -> `/portfolio`
  - 公司 / 主題 -> `/companies`
  - 量化策略 -> `/quant-strategies`
- Replaced number codes with the same lucide icon visual slot used by the app sidebar.

## Guardrails

- Did not rewrite the homepage layout.
- Did not touch dashboard data loaders, widgets, broker, risk, API, contracts, Quant Lab, or OpenAlice source.
- Preserved tactical ASCII / CRT visual language.
- Header dock remains fixed in this PR; draggable dock is the next B2 slice.

## Verification

- `pnpm install --frozen-lockfile` EXIT 0.
- `pnpm --filter @iuf-trading-room/contracts build` EXIT 0.
- `pnpm --filter @iuf-trading-room/web typecheck` EXIT 0.
- Chrome headless smoke on `http://127.0.0.1:3012/`:
  - `.tactical-dashboard .tac-nav a` count = 6.
  - Each nav item renders 1 lucide SVG icon.
  - No `/ideas` or `/lab` sidebar link remains on homepage.
  - No browser runtime exceptions captured.

## Screenshot

- `evidence/w7_paper_sprint/screenshots/overnight_home_sidebar_6_entry_desktop.png`
