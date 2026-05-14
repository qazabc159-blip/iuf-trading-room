# CODEX_REC_PORTFOLIO_PREFILL_2026-05-15

Branch: `fix/web-rec-portfolio-prefill-2026-05-15`

## Scope

- Closed the frontend loop from `/ai-recommendations` to `/portfolio`.
- Preserved `ticker`, `prefill`, `from_rec`, `entry`, `stop`, and `tp` when the portfolio page mounts the final iframe.
- Parsed those query params in `/api/ui-final-v031/paper-trading-room` with capped/sanitized values.
- Added a visible AI recommendation handoff panel inside the trading-room ticket.
- Applied entry price into `#t-price`, updated chart level labels, and kept the selected symbol at the top of the watchlist.
- Removed TypeScript-only casts from the final hydration script so the browser can execute the live wiring.

## Safety

- No `apps/api` broker/risk/contracts edits.
- No PAPER_LIVE promotion.
- No KGI live broker write.
- No default live execution mode.
- Submit lane remains the existing SIM/paper guarded flow.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - PASS

- Local dev server:
  - `http://localhost:3020`

- Headless Chrome direct-frame smoke:
  - URL: `/api/ui-final-v031/paper-trading-room?rev=test6&ticker=2330&prefill=true&from_rec=rec-test&entry=865-870&stop=845&tp=920`
  - PASS: `#rec-prefill-box` rendered.
  - PASS: watchlist first row shows `AI 推薦帶入 · rec-test`.
  - PASS: ticket price input rendered with `value="865.00"`.
  - PASS: chart labels updated to `建倉 865-870`, `停損 845`, `目標 920`.
  - PASS: preview recalculated to `2330 買進 1 lot @ 865.00`.

- Screenshot:
  - `evidence/w7_paper_sprint/CODEX_REC_PORTFOLIO_PREFILL_2026-05-15.png`

## Residual

- Unauthenticated `/portfolio` redirects to `/login?next=%2Fportfolio`, so query-preserving post-login behavior still needs owner-session QA. Direct final-frame behavior is verified.
