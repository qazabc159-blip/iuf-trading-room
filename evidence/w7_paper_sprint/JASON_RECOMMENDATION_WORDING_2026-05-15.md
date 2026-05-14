# JASON_RECOMMENDATION_WORDING_2026-05-15

**Task**: WARN-02 fix — recommendation mock invalidation.rule wording
**Source**: Mira MIRA_OVERNIGHT_WORDING_SCAN_2026-05-15.md
**Branch**: fix/api-recommendation-invalidation-wording-2026-05-15
**Timestamp**: 2026-05-15 03:30 TST

## Changes

File: `apps/api/src/recommendation-store.ts`

| ticker | line | before | after |
|--------|------|--------|-------|
| 2330 | 78 | `"日收破 920 出場，停損 ~4%"` | `"跌破 845 月線支撐則結構失效，建議減倉觀望"` |
| 0050 | 139 | `"日收破 178 出場，停損 ~5%"` | `"跌破 50 日均線結構轉弱，建議調整曝險"` |
| 2454 | 197 | `"日收破 1010 不介入"` | `"跌破 880 主升結構失效，建議離場觀察"` |

## Compliance

- Schema unchanged (`invalidation.rule` still string)
- No order endpoint touched (mock data only)
- No token leak
- Wording follows spec pattern: 「跌破 X 結構失效」+ neutral advisory, no 「停損」/「出場」operational instruction
- Lane boundary maintained

## Status

DONE — 3 strings patched, awaiting PR + build green.
