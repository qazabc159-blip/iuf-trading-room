# Codex evidence - Company graph tab activation

Date: 2026-05-18 00:44 TST
Branch: `fix/web-company-graph-tab-2026-05-18`
Owner: Codex frontend (`apps/web`)
Base after rebase: `40db79e` (`feat(web): company page Coverage knowledge + industry graph panels`)

## What changed

- Replaced the `/companies?tab=graph` v2 stub with a live frontend surface.
- The tab now consumes existing backend clients:
  - `getCompanyGraphStats()` for My-TW-Coverage graph coverage, relation types, keywords, and top connected companies.
  - `searchCompanyGraph()` for company/keyword/relation search.
- Kept behavior honest: if the backend is blocked or empty, the UI shows blocked/empty states instead of fake graph data.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Local browser smoke against mock API passed:
  - `/companies?tab=graph` loads with `iuf_session` cookie.
  - `My-TW-Coverage 知識圖譜` source label is visible.
  - Old `即將開放` stub is not visible.
  - Stats, relation types, top keywords, and top connected companies render.
  - Search for `台積` renders the `台積電` result.
  - Console errors: 0.
  - Page errors: 0.
  - Failed requests: 0.
- Rebased after Elva/Jason updates:
  - `f1e2f14` reverted the heatmap EOD enrichment regression.
  - `4a6c75f` added news-ai-selector production work plus Brain Phase B.
  - `40db79e` added company detail Coverage knowledge and industry graph panels.
  - `/companies?tab=graph` still had the v2 stub on `origin/main`, so this PR remains non-duplicative.

## Screenshots

- `evidence/w7_paper_sprint/company-graph-tab-1366x900.png`
- `evidence/w7_paper_sprint/company-graph-tab-mobile-390x844.png`

## Not touched

- No `apps/api` changes.
- No broker/risk/contracts changes.
- No heatmap fallback or KGI/TWSE backend changes while Elva is actively hotfixing that path.
