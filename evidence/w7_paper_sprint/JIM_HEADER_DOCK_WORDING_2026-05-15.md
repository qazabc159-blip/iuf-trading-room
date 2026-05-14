---
type: evidence
author: Jim
date: 2026-05-15
task: fix/web-header-dock-day6-wording-2026-05-15
---

# Header Dock Alerts Wording Fix

## Change
File: `apps/web/components/header-dock.tsx` line 303–304

Before:
- `<span>DAY 6</span>` — sprint-day engineering label leaked to user
- `<b>Notification Center</b>` — English jargon in Chinese UI

After:
- `<span>今日警示</span>`
- `<b>警示中心</b>`

## Scope
- Single component, 2-line change
- Draggable logic untouched
- No backend, no contracts

## Validation
- typecheck: EXIT 0 (no output)
- Build: not run (wording-only change, no structural risk)
