# JIM — quant-strategies displayStatus polish
date: 2026-05-15
branch: fix/web-quant-strategies-displayStatus-polish-2026-05-15
bug: BUG-C3-02

## Changes

### 1. displayStatus mapping
- Added `DisplayStatus = "PASS" | "WATCH" | "FAIL" | null` type to strategy-data.ts
- Added `displayStatus` field to `QuantStrategy` type
- Seeded each strategy: cont_liq_v36=WATCH, class5_revenue_momentum=PASS, family_c_sbl_overlay=null
- `DisplayStatusBadge` component maps enum → product wording + tint:
  - PASS → 驗證通過 (green #58d68d)
  - WATCH → 觀察中 (amber #e2b85c)
  - FAIL → 未通過驗證 (red #e63946)
  - null → 研究中 (grey #8899aa)
- Replaced hardcoded `gateLabel` logic (`sharpe === null ? "WATCH" : "SIM OBS"`) with `DisplayStatusBadge`

### 2. Polish
- Card hover: `.cardHoverable` — translateY(-2px) + accent border glow, 0.18s transition
- "同步中" → "讀取中" (cycle 5 wording firewall)
- Mobile responsive: existing `@media (max-width: 1180px)` grid → 1-col already covered

## Files modified
- apps/web/app/quant-strategies/strategy-data.ts
- apps/web/app/quant-strategies/page.tsx
- apps/web/app/quant-strategies/QuantStrategies.module.css

## Validation
- typecheck: EXIT 0
- No backend changes
- No sidebar changes
