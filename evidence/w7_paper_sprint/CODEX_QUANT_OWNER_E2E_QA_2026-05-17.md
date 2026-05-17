# CODEX - Quant strategies owner E2E QA - 2026-05-17

## Scope

Frontend-owned QA pass for `/quant-strategies`.

Flow covered:

1. Production unauthenticated probe for `/quant-strategies`.
2. Local authenticated owner-style smoke with mock API.
3. `/quant-strategies` list page.
4. `/quant-strategies/cont_liq_v36` detail page.
5. SIM-only subscription modal and POST payload.
6. `/quant-strategies?tab=subscriptions` subscriptions tab.
7. Desktop and mobile horizontal overflow checks.

Hardlines preserved:

- No KGI live broker write.
- No real-order path promotion.
- No default `executionMode="live"`.
- Subscription proxy sends `executionMode: "paper"` and `sim_only: true`.
- Copy remains research-only / SIM-only.
- No backend broker/risk/contracts files touched.

## Environment

- Branch: `qa/web-quant-owner-e2e-2026-05-17`
- Base: `origin/main` at `551716c`
- Worktree: `IUF_TRADING_ROOM_APP_quant_owner_e2e_worktree`
- Mock API:
  - `GET /api/v1/lab/strategies`
  - `POST /api/v1/quant-strategies/:id/subscribe`
  - `GET /api/v1/quant-strategies/:id/subscriptions/my`
- Local web:
  - `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:<mock-port>`
  - `NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG=primary-desk`
  - Local-only cookie gate for browser smoke.

## Result

Passed.

Production probe:

- `https://app.eycvector.com/quant-strategies`
- Final URL: `https://app.eycvector.com/login?next=%2Fquant-strategies`
- Interpretation: production authenticated owner QA still needs a real session from Yang/Elva. The unauthenticated auth gate is working.

Local owner-style smoke:

- List page rendered Lab sanctioned snapshot and SIM-only boundary copy.
- Detail page rendered capital range, holdings table, charts, and SIM-only subscription launcher.
- Invalid capital below `50,000` kept submit disabled.
- Valid capital `100,000` plus explicit confirmation opened the modal.
- Confirm action posted through the frontend proxy.
- Mock backend verified payload:
  - `executionMode: "paper"`
  - `sim_only: true`
  - `capital_twd` within allowed range.
- Success state rendered on detail page.
- Subscriptions tab loaded the newly created mock subscription and existing mock row.
- Desktop and mobile pages had no horizontal overflow.
- Playwright page errors: none.
- Browser console errors: none.

Dev-server note:

- Next dev logged the known Sentry/OpenTelemetry dynamic dependency warning during compile.
- This did not appear as a browser runtime error and did not block the flow.

## Screenshots

- `quant-owner-prod-auth-gate-1366x900.png`
- `quant-owner-e2e-list-1366x900.png`
- `quant-owner-e2e-detail-ready-1366x900.png`
- `quant-owner-e2e-subscribe-success-1366x900.png`
- `quant-owner-e2e-subscriptions-1366x900.png`
- `quant-owner-e2e-detail-mobile-390x844.png`
- `quant-owner-e2e-subscriptions-mobile-390x844.png`

## Verification Commands

```powershell
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
pnpm.cmd --filter @iuf-trading-room/web typecheck
node .codex-smoke\quant-owner-e2e.cjs  # local-only Codex smoke script, not committed
```

Verification status:

- `@iuf-trading-room/contracts build`: pass.
- `@iuf-trading-room/web typecheck`: pass.
- Quant owner E2E smoke: pass.
- Re-run after fast-forwarding over `#623` and `#624`: pass.

## Blockers / owners

- Production authenticated owner-session QA is still blocked by missing browser session in Codex context.
  - Owner: Yang / Elva if a real production owner-session pass is required.
- Backend persistence and real API contract health remain Jason-owned.
  - This cycle used the existing frontend proxy shape and a local mock API only.

## Frontend fix status

No frontend-owned regression was found in this pass, so no UI code change was needed.

This PR is evidence/release-hygiene only.
