# W4 Frontend Cutover — Screenshot Manifest

**Date**: 2026-04-28 (overnight augment)
**PR**: #8 (DRAFT)
**Note**: Screenshots cannot be taken in automated context. This manifest defines what Bruce should capture before merge.

---

## §1 Pages to Screenshot Before Merge

| Priority | Route | Purpose |
|----------|-------|---------|
| P0 | `/` (dashboard) | Confirm TopKpiStrip 7-cell renders |
| P0 | `/companies/[symbol]` e.g. `/companies/2330` | Confirm StockDetailPanel layout |
| P0 | `/companies/[symbol]` — inspector state | RightInspector sheet open |
| P1 | `/companies` (list) | Confirm list rows have click affordance |
| P1 | ⌘K open on any page | Confirm ACTION group renders at top |
| P2 | `/portfolio` | Confirm no visual regression (pre-existing page) |
| P2 | `/ideas` | Confirm no visual regression |
| P2 | `/runs` | Confirm no visual regression |

---

## §2 States to Capture

### Dashboard `/`
1. **Loaded** — TopKpiStrip 7 cells visible, mock data showing
2. **Dashboard full** — scroll down, confirm existing sections not displaced

### `/companies/[symbol]` (e.g. `/companies/2330`)
3. **OrderLockedBanner visible** — top of StockDetailPanel, amber `[LOCKED]` text
4. **PositionContainmentBadge visible** — bottom of StockDetailPanel, gold border, containment wording
5. **Mock K-line** — candlestick chart with mock data, `[MOCK]` FreshnessBadge
6. **BidAskLadder** — 5 rows, either live data or `——` empty rows
7. **TickTape** — scrollable tick list
8. **Interval toggle** — 8 buttons (1m/5m/15m/1h/4h/D/W/M), one active
9. **Error state (if gateway down)** — `[ERR→MOCK]` badge on BidAsk + TickTape

### RightInspector
10. **Inspector open** — slide-in sheet, mini K-line visible, radar chart visible, "查看個股頁 →" CTA
11. **Inspector backdrop** — background page dimmed, sheet at right edge
12. **Inspector closed** — Esc or backdrop click closes, no animation jank

### CommandPalette
13. **⌘K open — ACTION group** — "指令" group at top with tz/iv items
14. **⌘K — tz action active** — highlighted row, gold-bright border
15. **⌘K — filter** — type partial match, action items filter correctly

### Locked / Containment States
16. **OrderLockedBanner** — `[LOCKED] 下單功能未啟用 · Read-only 模式` amber text
17. **PositionContainmentBadge** — `持倉資料目前不可用（containment 模式）` gold text

---

## §3 Suggested Viewport Sizes

| Viewport | Why |
|----------|-----|
| 1440×900 | Standard laptop — primary design target |
| 1920×1080 | Desktop — for TopKpiStrip 7-cell full width |
| 375×812 | Mobile — confirm not broken (not primary use case) |

**Browser**: Chrome 124+ recommended (for exact CSS rendering match)
**Theme**: Dark mode / CRT theme (default)

---

## §4 Where Bruce Should Put Screenshots

Target directory:
```
evidence/path_b_w3_read_only_2026-04-27/screenshots/w4_cutover_verify/
```

Naming convention:
```
{seq}_{route}_{state}.png

Examples:
01_dashboard_topkpistrip_loaded.png
02_companies_symbol_panel_locked_banner.png
03_companies_symbol_panel_containment_badge.png
04_companies_symbol_kline_mock.png
05_companies_symbol_bidask_ladder.png
06_right_inspector_open.png
07_right_inspector_radar.png
08_command_palette_action_group.png
09_companies_list_rows.png
10_portfolio_no_regression.png
```

**After capturing**: Update `INDEX.md` in `evidence/path_b_w3_read_only_2026-04-27/` with screenshot list.

**Timing**: Capture after local `pnpm dev` confirms all pages render. Do NOT capture in production until AFTER merge + smoke test pass.
