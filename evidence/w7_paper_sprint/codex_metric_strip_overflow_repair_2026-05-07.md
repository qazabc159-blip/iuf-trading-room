# Codex Metric Strip Overflow Repair - 2026-05-07

Trade Capability Score: +1

## Problem

Production pages were showing bright browser-level horizontal scrollbars when metric strips contained long non-numeric values such as dataset names, OpenAlice queue descriptions, or status/source labels. This made dashboard, daily brief, and FinMind diagnostic surfaces look broken and could hide nearby controls.

## Root Cause

`MetricStrip` rendered every metric value with the `num` class. The shared `.quote-last.num` rule keeps text on one line, which is correct for compact numeric values but wrong for source names and workflow text.

## Change

- `apps/web/components/RadarWidgets.tsx`
  - Detects numeric-looking metric values.
  - Uses `num` only for numeric displays.
  - Uses `quote-last-text` for text/status values.
- `apps/web/app/globals.css`
  - Adds `quote-last-text` styling with Traditional Chinese sans font and safe wrapping.

## Source / Endpoint

No endpoint changed. This repairs presentation of existing real-data surfaces that already read:

- FinMind diagnostics
- OpenAlice daily brief state
- market-data overview
- paper health/readiness
- strategy ideas/runs

## Stop-Line Proof

- No token display or logging.
- No order route.
- No KGI write-side.
- No migration/schema/destructive DB.
- No fake live data.
- No unapproved strategy metrics.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS with CRLF warnings only
