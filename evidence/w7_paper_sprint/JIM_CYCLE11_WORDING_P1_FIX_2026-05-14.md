# Jim Cycle 11 — Wording P1 Fix (2026-05-14 ~04:50 TST)

## Trigger
Mira prod-wide firewall scan CYCLE11: 2 P1 WARN, both in apps/web.

## Fixes Applied

### WARN-01
- File: `apps/web/app/signals/page.tsx:521`
- Before: `等待下一批訊號進場`
- After: `等待下一批訊號更新`

### WARN-02
- File: `apps/web/app/lab/three-strategy/[strategyId]/StrategyDetailClient.tsx:796`
- Before: `出場規則`
- After: `退出條件（研究規格）`

## Validation
- typecheck: EXIT 0
- No other strings touched

## Scope
- 2 files, 2 string changes only
- No backend / contracts / broker touched
