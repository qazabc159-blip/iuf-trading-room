---
name: heatmap-data-honesty-gating-pattern
description: 熱力圖/banner 資料誠實 gating 類 PR 的固定審查重點（3-tier fallback + no_data 重分類 + 跨源日期一致性）
metadata:
  type: project
---

IUF 熱力圖引擎（`apps/api/src/kgi-heatmap-enricher.ts`）是 3(+1.5) tier fallback：
live → twse_mis_intraday → twse_eod → cache → no_data。這條線這幾週（7/14 起）反覆出現同一類
bug：某個 tier 結構性拿不到完整資料，卻被貼上跟「正常完整格」相同的 sourceState，導致前端顯示
「有價無漲跌」或「假 0%」。已修過的具體案例：quote_last_close（Tier2.5）無 prevClose/change
欄位卻標 twse_eod（[[pr1297-heatmap-honesty]]，PR #1297，2026-07-17）；TWSE STOCK_DAY_ALL 給
exact-zero Change 但跟 MIS 官方源矛盾（同一 PR，`isZeroChangePlausible()` 用自身前一日快取反證）。

**Why 這類 PR 審查要點固定**：楊董對「熱力圖一堆 0%/空缺」已經抓過至少兩輪（7/14 灰磚佔位改真
公司遞補、7/17 這輪的 no_data 重分類），每次根因都不同但呈現症狀相同——review 時不能只看
「這次修的兩個 symbol 對不對」，要驗證三件事：(a) 新 gating 邏輯是否會誤殺真實極端值（漲跌停/
真平盤）(b) 前端 `isUsableTile()`／`prepareTiles`／`primaryRowsForSector` 這條「no_data 排除 +
真公司遞補」的鏈路是否真的不用改（通常不用，這條線已經在 7/14 定案且穩定，除非前端本身也在這次
diff 裡）(c) 任何「用自身快取反證」的 guard 都有 cold-start 已知限制（process 剛重啟/無前一日
資料時無法反證），要看 PR 是否誠實揭露而非隱瞞。

**How to apply**：下次遇到 `kgi-heatmap-enricher.ts` 或熱力圖相關 PR，先讀這份 memory 建立
「這條 pipeline 的固定病灶」的心智模型，再對照 diff 判斷是新病灶還是同病復發；`industry-heatmap.tsx`
若不在 diff 內，可直接引用 pre-existing `isUsableTile()` 的既有行為當作驗證基礎，不需要重新從頭
審查前端渲染邏輯。

Link: [[banner-cross-source-date-consistency-risk]]
