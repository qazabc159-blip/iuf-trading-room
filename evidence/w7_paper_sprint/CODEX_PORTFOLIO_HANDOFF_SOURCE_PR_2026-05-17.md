# CODEX Portfolio Handoff Source PR Evidence - 2026-05-17

## Scope

- Frontend-owned fix in `apps/web`.
- Preserves `/portfolio` handoff source query params for existing frontend entry points:
  - `from_strategy`
  - `from_home`
  - `from_run`
- Surfaces source-specific labels in the outer iframe title/ARIA and the paper trading room SIM prefill metadata.
- Keeps AI recommendation handoff behavior intact via `from_rec`.

## Shipped

- `/portfolio` and `/final-v031/portfolio` now forward `from_strategy`, `from_home`, and `from_run` into `/api/ui-final-v031/paper-trading-room`.
- Wrapper titles no longer label non-AI handoffs as AI recommendation handoffs:
  - `from_strategy` => `首頁策略帶入 / 來源 首頁策略`
  - `from_home` => `首頁紙上交易帶入 / 來源 首頁紙上交易`
  - `from_run` => `策略 Run 帶入 / 來源 策略 Run`
  - `from_rec` remains `AI 推薦帶入 / 來源 AI 推薦`
- Final v0.31 paper-room parsing maps source params into `PaperPrefillHandoff.source`.
- SIM prefill banner and prefill watchlist metadata use source-specific labels.
- Static paper-room chart fallback now avoids invalid empty SVG path data when only placeholder bars are available.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed before UI smoke.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed before the final smoke cycle and will be rerun after this evidence file.
- Browser smoke with local owner-session cookie and same-origin API stubs:
  - `/portfolio?ticker=2330&prefill=true&from_strategy=home&entry=950&stop=920&tp=985`
  - `/portfolio?prefill=true&from_home=paper_preview`
  - `/portfolio?ticker=2317&prefill=true&from_run=true`
- Smoke assertions:
  - iframe `src` preserves source params.
  - outer `main[aria-label]` and iframe title include source-specific mode and source labels.
  - paper-room `#rec-prefill-box` includes `來源 首頁策略`, `進場 950`, `停損 920`, and `目標 985`.
  - console errors: `0`.
  - non-aborted failed requests: `0`.

## Browser Artifact

- Screenshot: `evidence/w7_paper_sprint/portfolio-handoff-source-1366x900.png`

## Safety

- No broker write path touched.
- No API broker/risk/contracts touched.
- No real-order promotion.
- No default live execution mode.
- No prohibited paper/live promotion wording.
- No secrets or identity material added.
