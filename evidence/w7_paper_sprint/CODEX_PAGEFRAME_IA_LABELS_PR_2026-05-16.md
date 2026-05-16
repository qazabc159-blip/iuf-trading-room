# CODEX_PAGEFRAME_IA_LABELS_PR_2026-05-16

## Scope
- Updated shared `PageFrame` code labels to align with the frozen 6-entry IA.
- `06` / `06-PORT` now display `交易室` instead of `模擬交易室`.
- `AI-*` codes now display `AI 推薦 / 明細`.
- `QNT-*` codes now display `量化策略 / 明細`.
- `AI` and `QNT` prefix labels were added for shared panels/pages.

## Intent
- Keep the app shell consistent with the sidebar/header IA while preserving the existing page layouts.
- Do not rewrite the tactical homepage or the vendor visual system.
- Keep `/lab/*` legacy labels as `量化研究` because those routes remain internal/Athena-facing rather than public sidebar entries.

## Verification
- `git diff --check origin/main..HEAD`
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Static scan: `rg -n "模擬交易室|AI 推薦|量化策略|QNT|AI-" apps/web/components/PageFrame.tsx`
- Local route smoke:
  - started Next dev on `127.0.0.1:3026`
  - `GET /ai-recommendations` -> 200, contains `AI 推薦`, old `模擬交易室` absent
  - `GET /quant-strategies` -> 200, contains `量化策略`, old `模擬交易室` absent
  - `GET /plans` -> 200, old `模擬交易室` absent
  - stopped the local dev process after smoke

## Safety
- No `apps/api`, broker, risk, contracts, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS` edits.
- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` promotion.
- No secrets.
