# CODEX Radar Lab Live-Like Labels PR - 2026-05-16

Scope:
- Frontend-only display wording hardening in `apps/web/lib/radar-lab.ts`.
- Upstream enum keys are preserved:
  - `PAPER_LIVE`
  - `LIVE_CANDIDATE`
  - `IN_LIVE`
- Only their Trading Room display labels changed so Lab live-like states do not render as broker readiness.
- Added cycle sync note under `reports/memos/codex_notes/`.
- No `apps/api`, broker, risk, or shared contract edits.

Display labels after this PR:
- `PAPER_LIVE` -> `SIM 驗證中 / 非正式交易`
- `LIVE_CANDIDATE` -> `正式券商寫入關閉 / 待風控驗收`
- `IN_LIVE` -> `正式券商寫入關閉 / TR 不執行`

Verification:
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web exec tsx -e "...labStatusDisplayWording smoke..."`
- `git diff --check`
- Static scan confirmed no display match in `apps/web/lib/radar-lab.ts` for:
  - `紙上驗證中`
  - `實盤候選`
  - `實盤流程中`
  - `正式送單`
  - `券商送單`
  - `真實下單`

Browser smoke:
- URL: `http://127.0.0.1:3044/quant-strategies`
- Auth gate: local smoke cookie `iuf_session=local-smoke-session`, only to pass middleware.
- Viewport: `1366x900`
- Screenshot: `evidence/w7_paper_sprint/radar-lab-live-labels-quant-1366x900.png`
- Assertions:
  - `/quant-strategies` rendered and did not redirect to `/login`.
  - Old display `實盤候選 / 待明示` absent.
  - Old display `實盤流程中` absent.
  - Old display `紙上驗證中` absent.
  - Literal `PAPER_LIVE` absent from rendered body.
  - Browser console warnings/errors: none.
  - Page errors: none.
  - Failed requests: none.

Safety notes:
- This does not rename upstream status keys or contract vocabulary.
- This does not promote any real-order path.
- This does not set `executionMode='live'`.
- This does not expose secrets, tokens, identity details, KGI credentials, or database URLs.
- This preserves the existing tactical ASCII/CRT/amber layout.
