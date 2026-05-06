# Codex Strategy-To-Paper Preview Flow - 2026-05-07

Trade Capability Score: +1

## Problem

Strategy ideas and strategy batch detail pages showed candidates, but the next safe trading workflow was not explicit. Users could see scores and directions without a clear product path to company research, K-line, source state, and paper preview.

## Change

- `apps/web/app/ideas/page.tsx`
  - Adds a `紙上預覽` action for each candidate linking to `/companies/:symbol#paper-order`.
  - Clarifies that candidates are not buy/sell advice and do not create orders.
- `apps/web/app/runs/[id]/page.tsx`
  - Adds the same `紙上預覽` action to strategy batch candidate rows.
  - Clarifies batch candidates are not recommendations and remain read-only until backend contracts and risk gates allow.

## Endpoint / Source

- `GET /api/v1/strategy-ideas?decisionMode=paper&includeBlocked=true&limit=30&sort=score`
- `GET /api/v1/strategy-runs/:id`
- Downstream paper preview anchor: `/companies/:symbol#paper-order`

No endpoint, schema, DB, or order route changed.

## Workflow Improved

`策略想法 / 策略批次 -> 公司頁 -> K 線 / FinMind source state -> 紙上預覽 -> portfolio readout`

This closes a navigation gap without enabling submit.

## Stop-Line Proof

- No `/order/create`.
- No submit enablement.
- No KGI write-side.
- No token display.
- No fake fill.
- No fake strategy metric.
- No buy/sell recommendation wording.

## Checks

Pending in PR run:

- contracts build
- web typecheck
- web build
- diff-check
- added-line stop-line grep
