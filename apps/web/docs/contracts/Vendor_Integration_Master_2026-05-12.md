# Vendor Integration Master Index
# IUF Trading Room — 2026-05-12

廠商設計完成後，依本文件逐頁接皮。每頁 contract 定義了首屏問題、API 清單、5 種 state 語言、禁止工程詞、接皮 props。

---

## 全頁面 Contract 清單

| # | 頁面 | 路由 | Contract 文件 | 複雜度 | 優先接皮 |
|---|---|---|---|---|---|
| 1 | 首頁 | `/` | [01_homepage.md](01_homepage.md) | 高（12 API 並行）| P0 |
| 2 | 市場情報 | `/market-intel` | [02_market_intel.md](02_market_intel.md) | 中 | P1 |
| 3 | 每日簡報列表 | `/briefs` | [03_briefs_list.md](03_briefs_list.md) | 中 | P1 |
| 4 | 每日簡報詳情 | `/briefs/[id]` | [04_briefs_detail.md](04_briefs_detail.md) | 低 | P2 |
| 5 | 警示中心 | `/alerts` | [05_alerts.md](05_alerts.md) | 低 | P2 |
| 6 | 訊號牆 | `/signals` | [06_signals.md](06_signals.md) | 低 | P2 |
| 7 | 紙上交易室 | `/portfolio` | [07_portfolio.md](07_portfolio.md) | 高（KGI 即時）| P1 |
| 8 | 策略想法 | `/ideas` | [08_ideas.md](08_ideas.md) | 中 | P1 |
| 9 | 研究批次 | `/runs` + `/runs/[id]` | [09_runs.md](09_runs.md) | 中 | P1 |
| 10 | 量化研究室 | `/lab` + `/lab/three-strategy/*` | [10_lab_strategy.md](10_lab_strategy.md) | 高（chart + toggle）| P2 |
| 11 | 公司 | `/companies` + `/companies/[symbol]` | [11_companies.md](11_companies.md) | 極高（KGI streaming）| P0 |

---

## 廠商接收順序（建議）

```
Phase A（優先接皮，用戶首看）
  1. 首頁 (/)             — operator 每日開盤前必看
  2. 公司詳情 (/companies/[symbol]) — 個股交易核心頁

Phase B（主流程）
  3. 策略想法 (/ideas)
  4. 研究批次 (/runs + /runs/[id])
  5. 紙上交易室 (/portfolio)

Phase C（輔助流程）
  6. 市場情報 (/market-intel)
  7. 每日簡報列表 (/briefs)
  8. 每日簡報詳情 (/briefs/[id])
  9. 訊號牆 (/signals)
 10. 警示中心 (/alerts)
 11. 量化研究室 (/lab + three-strategy)
```

---

## 預估接皮 ETA（基準：廠商設計稿交付後起算）

| Phase | 頁面 | 預估工時 |
|---|---|---|
| A | 首頁 | 2 天 |
| A | 公司詳情 | 3 天（KGI streaming panels 需對齊）|
| B | 策略想法 | 1 天 |
| B | 研究批次 (list + detail) | 1.5 天 |
| B | 紙上交易室 | 1.5 天 |
| C | 市場情報 | 1 天 |
| C | 簡報 (list + detail) | 1.5 天 |
| C | 訊號牆 | 0.5 天 |
| C | 警示中心 | 0.5 天 |
| C | 量化研究室 | 2 天（chart 接皮複雜）|
| **合計** | | **~14 工作天** |

---

## 通用接皮規則

1. **Props 來源**：全部由現有 backend API 端點驅動，不自行造假資料。
2. **State language**：嚴格使用各 contract §3 定義的繁中文字，不改措辭。
3. **禁止工程詞**：各 contract §4 列表為硬規則，廠商設計師收到時必須一併告知。
4. **adapter shim 位置**：轉換邏輯統一放 `apps/web/lib/page-contracts.ts`，不散在各頁面。
5. **KGI streaming**：五檔 + 成交 + 即時報價是 30s poll 模式，廠商皮接收 4-state（loading / live / blocked / empty）。
6. **TW 漲跌色慣例**：上漲 = 紅色 `#ef5350`，下跌 = 綠色 `#4caf50`（台灣市場慣例，與西方相反）。

---

## adapter shim 型別位置

```
apps/web/lib/page-contracts.ts   — 所有頁面 adapter Props type 定義集中地
```

廠商皮完成後，各頁 import 由此 file 提供型別，不在 page.tsx 中重定義。

---

*Jim 製，2026-05-12*
*基於真實 API payload 與現有頁面 code 實地驗證，無假料。*
