# Codex Paper Company-To-Portfolio Flow Guide - 2026-05-07

Status: READY FOR PR
Trade Capability Score: +1

## Scope

Connects the company-page paper preview surface to the portfolio readout so the paper workflow is no longer a set of isolated panels.

Changed files:

- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`
- `apps/web/app/portfolio/page.tsx`
- `apps/web/app/globals.css`

## Workflow Improved

Operator path:

1. Open `/companies/2330#paper-order`.
2. Confirm the company page is in `PAPER / PREVIEW ONLY` mode.
3. Preview the draft with odd-lot / board-lot clarity.
4. Use the new `查看紙上部位` guide to open `/portfolio`.
5. Read paper positions / fills from backend read-only routes.

This does not create a paper order and does not make live-submit available.

## Endpoint / Source List

Existing sources only:

- Company page paper preview: `POST /api/v1/paper/preview`
- Company page paper health: `GET /api/v1/paper/health`
- Company page paper order list: `GET /api/v1/paper/orders`
- Portfolio readout: `GET /api/v1/paper/portfolio`
- Fill readout: `GET /api/v1/paper/fills`

## State Semantics

- Company page remains preview/check only.
- Portfolio remains read-only.
- If session is expired, portfolio still shows the existing login-repair BLOCKED state.
- Empty positions/fills are shown as real EMPTY states, not fake fills.

## Stop-Line Proof

- No `/order/create`.
- No KGI write-side.
- No route behavior change.
- No submit route enablement.
- No fake fill.
- No fake position.
- No token value display.
- No FinMind or K-line fill/risk usage.
- No buy/sell recommendation.
- 2330 default remains SHARE qty=1; LOT remains explicit as 1 張 = 1,000 股.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build`: PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`: PASS
- `pnpm.cmd --filter @iuf-trading-room/web build`: PASS
- `git diff --check`: PASS, CRLF warning only
- Added-line stop-line grep: PASS

## Next

After merge/deploy, run authenticated production smoke:

- `/companies/2330#paper-order` loads the guide.
- `查看紙上部位` opens `/portfolio`.
- `/portfolio` keeps PAPER / READ ONLY and does not show fake fills.
