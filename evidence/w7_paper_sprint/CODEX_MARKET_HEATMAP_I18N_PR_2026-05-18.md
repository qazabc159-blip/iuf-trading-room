# Market Heatmap Industry I18n - 2026-05-18

## Scope

Frontend-only fix for `/market-intel` industry heatmap labels.

Yang reported that the all-market heatmap was showing raw English industry names. This change keeps the vendor tactical layout intact and maps TWSE/KGI English industry keys to the existing Traditional Chinese industry label table in both:

- server-injected `window.__IUF_FINAL_V031_LIVE__`
- client refresh after hydration

The client refresh also now consumes the raw heatmap response shape directly so `{ data: [...] }` is not unwrapped into an array and then accidentally treated as an object, which previously could wash the heatmap back to an empty state after initial render.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- Browser smoke with mock heatmap API containing raw English inputs:
  - `Semiconductors`
  - `Computer Hardware`
  - `Communication Equipment`
  - `Banks`
- Verified rendered labels:
  - `半導體`
  - `電腦硬體`
  - `通訊設備`
  - `銀行`
- Verified raw English labels are absent from the rendered heatmap grid after hydration.

## Screenshots

- `evidence/w7_paper_sprint/market-heatmap-i18n-direct-desktop-1366x900.png`
- `evidence/w7_paper_sprint/market-heatmap-i18n-direct-mobile-390x844.png`
- `evidence/w7_paper_sprint/market-heatmap-i18n-authed-market-intel-desktop-1366x900.png`

## Safety

- No broker/risk/contracts changes.
- No KGI live write path changes.
- No real-order promotion.
- No default live execution mode.
- No PAPER_LIVE wording.
- No OpenAlice source import.
