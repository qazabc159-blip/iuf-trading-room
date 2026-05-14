# CODEX_OVERNIGHT quant strategies 2026-05-15

## Scope

- Branch: `feat/web-codex-quant-strategies-2026-05-15`
- Worktree: `IUF_TRADING_ROOM_APP_dock_draggable_worktree`
- Files changed:
  - `apps/web/app/quant-strategies/page.tsx`
  - `apps/web/app/quant-strategies/[strategyId]/StrategyDetailClient.tsx`
  - `apps/web/app/quant-strategies/QuantStrategies.module.css`
- Product request: make `/quant-strategies` usable beyond the placeholder and tighten the SIM-only execution guardrails.

## Implementation

- Strategy list now renders the existing local strategy dataset:
  - `cont_liq_v36`
  - `class5_revenue_momentum`
  - `family_c_sbl_overlay`
- Each list card shows strategy name, role/regime, backtest hit rate, max drawdown, current SIM observation state, and a sparkline.
- Quant score remains `同步中` until Jason's `/api/v1/quant-strategies` endpoint lands; the frontend does not invent a score.
- Detail page now shows a clear orange SIM banner.
- SIM basket panel now enforces the 50,000 - 1,000,000 TWD range.
- SIM basket panel now opens a confirmation dialog before any KGI SIM submit call.
- No real-trading button or toggle is added.

## Verification

Command:

```text
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Browser smoke:

```text
Local URL: http://127.0.0.1:3013/quant-strategies
Cookie gate: local smoke cookie only, no real credentials.
```

Observed:

- Strategy cards: 3.
- SIM banner visible: true.
- No button/link text exposes `真實交易` or `正式交易`.
- Detail page `/quant-strategies/cont_liq_v36` loads.
- Invalid capital `10000` shows the minimum-capital guardrail.
- Valid capital `100000` + ACK opens confirm dialog.
- Smoke stopped at confirm dialog; it did not click `送出 KGI SIM`.

Screenshots:

- `evidence/w7_paper_sprint/screenshots/overnight_quant_strategies_list.png`
  - SHA256: `F2B3EDA52195C37E895C354A69808D8440902F7E0F45BC48560C7CFD5F557CAC`
- `evidence/w7_paper_sprint/screenshots/overnight_quant_strategies_confirm.png`
  - SHA256: `27488ACFAD35676EE6769D7C019EFD5CBDA53A5C7C56323A6311B3BA0D7F15C9`

Known follow-up:

- Replace local strategy data with `GET /api/v1/quant-strategies` once Jason lands the endpoint.
- Replace basket-order loop with `POST /api/v1/quant-strategies/:id/subscribe` once that endpoint lands.

## Safety

- No KGI live broker write path touched.
- No execution mode defaults changed.
- No `apps/api` broker/risk/contracts files touched.
- No IUF_QUANT_LAB or IUF_SHARED_CONTRACTS files touched.
- Browser smoke did not submit any SIM order.
