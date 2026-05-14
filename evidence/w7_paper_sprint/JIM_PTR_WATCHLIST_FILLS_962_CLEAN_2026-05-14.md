---
date: 2026-05-14
author: Jim
task: PTR watchlist + fills + positions/KGI hardcoded 962.xx final cleanup
pr: pending
---

## Scope

Followup to PR #458. Bruce browser audit found 5 remaining 962.xx hardcoded prices
that PR #458 missed (only cleared #depth + OHLC).

## Locations Cleaned

| Location | Line (before) | Old value | New value |
|---|---|---|---|
| wl-my 台積電 `.price .v` | 60 | 962.00 (+8.00 +0.84%) | — / 等待報價 |
| wl-my 鴻海 `.price .v` | 70 | 196.50 (−1.00 −0.51%) | — / 等待報價 |
| wl-sig 台積電 `.price .v` | 90 | 962.00 (+0.84%) | — / 等待報價 |
| wl-paper 台積電 `.price .v` | 125 | 962.00 (+0.84%) | — / 等待報價 |
| positions tbody row | 321 | 2330 · 962.00 · 1,924,000 hardcoded | empty-state: 目前沒有模擬庫存。 |
| KGI tbody rows | 336-337 | 2330 962.00 + 2317 196.50 hardcoded | empty-state: 目前沒有可顯示的券商庫存讀取資料。 |

## Pattern Match Verification

Post-fix grep results:
- `962` → 0 hits
- `956.` → 0 hits
- `965.` → 0 hits
- `945.` → 0 hits
- `920.` → 0 hits
- `182.` → 0 hits
- `196.` → 0 hits

## Hydration Coverage

JS hydration in `final-v031-live.ts` already rewrites:
- `#wl-my` innerHTML entirely (line 931) — watchlist built from `live.watchlist`
- positions tbody (line 947) — built from `live.portfolio`
- KGI tbody (line 949) — built from `live.kgi?.positions`
- fills tbody (line 944) — built from `live.fills`

All HTML empty-state strings now match what hydration falls back to on empty data.

## typecheck

EXIT 0
