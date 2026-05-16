# CODEX Login SIM Broker-Closed Copy PR - 2026-05-16

Scope:
- Frontend-only copy hardening for `/login`.
- Updated `apps/web/app/login/page.tsx` so the unauthenticated account entry point says SIM workflow / broker write closed.
- Added cycle sync note under `reports/memos/codex_notes/`.
- No `apps/api`, broker, risk, or shared contract edits.

Why:
- `origin/main` still had login copy that said broker submission would happen before or after SDK completion:
  - `正式券商送單前`
  - `凱基 SDK 補齊後再開正式送單`
- The login page is visible before authentication, so it should keep the product boundary explicit.

Verification:
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Static copy scan confirmed no `/login` match for:
  - `正式券商送單前`
  - `再開正式送單`
  - `正式送單`
  - `PAPER_LIVE`
  - `券商送單`

Browser smoke:
- URL: `http://127.0.0.1:3042/login?next=%2Fportfolio%3Fsymbol%3D2330`
- Viewport: `1366x900`
- Screenshot: `evidence/w7_paper_sprint/login-sim-broker-closed-1366x900.png`
- Assertions:
  - `券商寫入關閉中` present.
  - `SIM 工作台入口` present.
  - `正式券商寫入需產品、風控與後端契約驗收後另行開啟` present.
  - Old `正式券商送單前` absent.
  - Old `再開正式送單` absent.
  - `PAPER_LIVE` absent.
  - Browser console warnings/errors: none.
  - Page errors: none.
  - Failed requests: none.

Safety notes:
- This does not promote any real-order path.
- This does not set `executionMode='live'`.
- This does not add or expose secrets, tokens, identity details, KGI credentials, or database URLs.
- This preserves the existing tactical ASCII/CRT/amber layout.
