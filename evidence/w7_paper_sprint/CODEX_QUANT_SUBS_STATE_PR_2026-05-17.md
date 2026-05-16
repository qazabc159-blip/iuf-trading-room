# CODEX Quant Subscriptions State PR Evidence - 2026-05-17

## Scope

- Frontend-owned fix in `apps/web`.
- Target: `/quant-strategies?tab=subscriptions`.
- Prevent per-strategy subscription fetch failures from being mistaken for a true empty subscription list.
- No backend, broker, risk, contract, KGI, or order-path changes.

## Shipped

- `QuantSubsPanel` now tracks subscription records and per-strategy fetch failures separately.
- True empty state remains `尚未訂閱任何策略`.
- Partial failure with available records now keeps the loaded table visible and shows a warning banner with sanitized failure reasons.
- All-strategy failure now shows an alert state with retry instead of the empty-state CTA.
- Loading, warning, and error states now expose `aria-live`/alert semantics for owner-session QA and assistive tech.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed before browser smoke and will be rerun after this evidence file.
- Browser smoke with local owner-session cookie and same-origin subscription stubs:
  - Partial malformed response + one valid subscription: table stays visible and warning appears.
  - All malformed responses: guarded error state appears with `重新讀取`; empty-state copy is not shown.
  - All valid empty responses: true empty-state copy appears without warning.
  - Console errors: `0`.
  - Failed requests: `0`.

## Browser Artifact

- Screenshot: `evidence/w7_paper_sprint/quant-subs-state-partial-1366x900.png`

## Safety

- No broker write path touched.
- No API broker/risk/contracts touched.
- No real-order promotion.
- No default live execution mode.
- No prohibited paper/live promotion wording.
- No secrets or identity material added.
