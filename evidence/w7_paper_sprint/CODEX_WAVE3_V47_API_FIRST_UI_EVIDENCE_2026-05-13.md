# Codex Wave 3 Evidence - v47 API-first strategy UI

Date: 2026-05-13
Owner: Codex
Scope: TR strategy detail UI / v47 return display contract

## What changed

- Updated `/lab/three-strategy/[strategyId]` chart panel wiring so `cont_liq` uses the live TR API snapshot first:
  - `GET /api/v1/lab/strategy/cont_liq_v36/snapshot`
  - embedded snapshot is now fallback only.
- Corrected the embedded fallback for `cont_liq_v36`:
  - status: `RESEARCH_FORWARD_OBSERVATION`
  - strategy same-window return: `400.89`
  - 0050 same-window return: `95.25`
  - excess return: `305.64`
- Removed the deprecated ambiguous return field from the frontend API type.
- Removed legacy return field names from the render path and API type.
- Reworded lifecycle status and chart-title copy so internal status enums do not leak into user-facing surfaces.

## Verification

Commands run:

```powershell
pnpm.cmd --filter @iuf-trading-room/web typecheck
pnpm.cmd --filter @iuf-trading-room/api typecheck
node --test --import tsx/esm apps/api/src/__tests__/lab-strategy-snapshot.test.ts
py -3 C:\Users\User\Desktop\小楊機密\交易\IUF_QUANT_LAB\scripts\analysis\build_tr_strategy_snapshot_contract_v47.py
```

Results:

- Web typecheck: PASS
- API typecheck: PASS
- Lab snapshot tests: PASS, 9/9
- v47 scanner: PASS, `findingCount = 0`, `p0Count = 0`, `p1Count = 0`
- Full TR regression after final cleanup: PASS, `252 passed, 0 failed`

## Remaining scanner findings

None after the second pass.

## Hard-line status

- No production broker write.
- No real order.
- No registry state change.
- No shared contract edit.
- No token or credential output.
- No strategy promotion wording added.
