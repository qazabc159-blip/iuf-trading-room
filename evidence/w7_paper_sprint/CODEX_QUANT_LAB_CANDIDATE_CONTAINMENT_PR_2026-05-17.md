# Codex Evidence - Quant Lab Candidate Text Containment

## Scope
- Frontend-only `/quant-strategies` QA follow-up.
- Keep Lab sanctioned snapshot research-only copy honest while preventing long candidate names/status text from overflowing cards on desktop or mobile.

## Change
- Added visible text compaction for Lab candidate card name/status while preserving full Lab wording in `title` and `aria-label`.
- Added `min-width: 0`, `overflow: hidden`, and `overflow-wrap: anywhere` containment to Lab candidate cards and text blocks.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke with local mock `GET /api/v1/lab/strategies` fixture containing very long Lab candidate names:
  - Desktop `1366x900`: 3 Lab candidate cards render, no card/text overflow, full text metadata present.
  - Mobile `390x844`: candidate cards stack in one column, document has no horizontal overflow, no card/text overflow.
  - No console errors, failed requests, or HTTP >= 400 responses during smoke.

## Screenshots
- `evidence/w7_paper_sprint/quant-lab-candidate-containment-desktop-1366x900.png`
- `evidence/w7_paper_sprint/quant-lab-candidate-containment-mobile-390x844.png`

## Safety
- No backend, broker, risk, contract, or order path changes.
- No `PAPER_LIVE` promotion or live execution wording added.
- No secrets or account identifiers added.
