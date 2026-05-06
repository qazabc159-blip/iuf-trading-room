# Codex Paper Preview Truth Panel - 2026-05-06

Trade Capability Score: +1

## Workflow Improved

Company-page paper order drafting is now safer and clearer before any submit flow exists:

- The panel explicitly labels the workflow as `PAPER / PREVIEW ONLY`.
- Default 2330 draft remains `quantity_unit=SHARE`, quantity `1`, meaning one odd-lot share.
- Switching to `LOT` clearly shows `1 張 = 1,000 股` and the actual share count.
- Estimated notional is shown against demo capital `NT$20,000`.
- Risk result, quote decision, quote source, quote readiness, quote freshness, and preview timestamp are rendered when preview returns.
- The company-page submit button is locked as `送出暫停`, so this PR cannot create a paper order.

## Endpoint / Source List

- Reads: `GET /api/v1/paper/health`
- Reads: `GET /api/v1/paper/orders`
- Preview only: `POST /api/v1/paper/preview`
- No submit route is enabled by this PR.

## State Semantics

- `LIVE`: preview returned and risk/quote result is visible.
- `EMPTY`: no preview has been requested yet, or informational source-only note.
- `BLOCKED`: frontend validation or backend risk/quote gate blocks the draft.
- `PAPER / PREVIEW ONLY`: this is not a real broker order and does not create a paper ledger row.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS with CRLF warnings only
- Local visual QA: `evidence/w7_paper_sprint/local_visual_qa_pass129_paper_truth_panel_2026-05-06/manifest.json`

## Proofs

- No-token proof: PASS
- No-fake-live proof: PASS; FinMind/K-line is explicitly described as display data, not fill price or risk source.
- No-order proof: PASS; local QA captured zero `/api/v1/paper/submit` or `/order/create` calls.
- Odd-lot proof: PASS; default `2330` draft shows `零股 / SHARE`, `1 股`, and `實際 1 股`.
- Board-lot proof: PASS; `LOT` mode shows `整張 / LOT`, `1 張`, and `實際 1,000 股`.
- Demo-capital proof: PASS; panel shows `模擬資金 NT$20,000`.
