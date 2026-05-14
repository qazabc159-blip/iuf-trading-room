# Jim Overnight Push — 2026-05-15 02:50 TST

## PR A — CoverageSection Visual Polish
- Branch: `feat/web-coverage-section-polish-2026-05-15`
- PR: #484 https://github.com/qazabc159-blip/iuf-trading-room/pull/484
- Commit: `acd3698`
- File: `apps/web/app/companies/[symbol]/CoverageSection.tsx`
- typecheck: EXIT 0

### Changes
- BookOpen icon + ChevronDown/ChevronRight in accordion header (lucide-react)
- Header hover: subtle background transition via `.coverage-accordion-btn:hover`
- businessOverview: line-height 1.85 + letter-spacing 0.01em (TC readability)
- Supply chain chips: upstream=teal / midstream=amber / downstream=purple colour tints
- Customer=blue / supplier=orange on NameList chips
- Wikilinks: dotted underline + hover fill feedback via `.coverage-wikilink-btn:hover`
- Peer links: accent border + color on hover
- Loading: RefreshCw spinner + "資料同步中…" text
- Not-found: AlertCircle icon + descriptive tagline "此公司暫未收錄在 My-TW-Coverage 資料庫"
- Mobile (<768px): tighter padding `.coverage-body`, stacking via `@media` query

## PR B — /settings/account Change Password
- Branch: `feat/web-settings-account-change-password-2026-05-15`
- PR: #485 https://github.com/qazabc159-blip/iuf-trading-room/pull/485
- Commit: `9dfc7d4`
- Files:
  - `apps/web/app/settings/account/page.tsx` (new)
  - `apps/web/lib/auth-client.ts` (apiChangePassword added)
  - `apps/web/components/header-dock.tsx` (KeyRound + Link entry)
  - `apps/web/app/globals.css` (.header-account-menu-link CSS)
- typecheck: EXIT 0

### Changes
- `/settings/account` page: 3 password inputs + eye-toggle, client validation, POST endpoint
- Error display: INVALID_CURRENT_PASSWORD / WEAK_NEW_PASSWORD / network mapped to TC
- Success: green panel + 3s countdown → auto-logout → /login
- Dock entry: "帳號設定" under User icon menu → /settings/account
