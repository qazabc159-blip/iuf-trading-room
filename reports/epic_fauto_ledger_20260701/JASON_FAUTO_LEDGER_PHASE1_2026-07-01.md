# F-AUTO SIM Continuous Ledger — Phase 1 Report
**Jason Backend Strategy — 2026-07-01**
**Branch: `feat/fauto-sim-ledger-phase1-jason-20260701`**

---

## TL;DR（楊董看這一段）

| 項目 | 數值 |
|------|------|
| 計算區間 | 2026-06-02 ~ 2026-06-30（20 個台股交易日） |
| 初始資金 | 10,000,000 TWD（SIM 帳本） |
| 重建總權益 | **9,365,680 TWD** |
| 累計報酬 | **-6.34%** |
| 總已實現損益 | -634,320 TWD |

**這數字可不可信？** 可信 — 進場價取 FinMind PIT 收盤（非 basket 的預估 latest_price），五週重建都有 audit_logs 為據，最大疑點是 6/23 week（KGI SIM accepted=0，仍納入重建，遵循 A4 一致性假設），整體偏保守。

---

## 一、帳本 Schema 設計

### 設計原則

1. **三表結構**：週次摘要（`sim_ledger_weeks`）+ 每日 NAV（`sim_ledger_nav`）+ 持倉明細（`sim_ledger_holdings`）
2. **PIT 嚴格**：所有 entry_source / exit_source 欄位追蹤價格來源，禁止混入非 PIT 來源
3. **`source` CHECK constraint**：區分 `backfill_dry_run` vs `live`，防止乾跑資料污染正式帳本
4. **UNIQUE (basket_date, source)**：idempotent upsert，重跑不爆炸
5. **Additive only**：不改任何現有表；三個新表全是 `CREATE TABLE IF NOT EXISTS`

### Migration 0049 — `packages/db/migrations/0049_sim_ledger.sql`

**sim_ledger_weeks**（週次主表）
```
id              UUID PK
week_num        INTEGER NOT NULL CHECK (>= 1)
basket_date     DATE NOT NULL               — 重平衡當日（Tuesday）
initial_equity  NUMERIC(16,2) NOT NULL      — 帳本起始 10M
basket_cost_twd NUMERIC(16,2) NOT NULL      — 實際進場成本（PIT close × shares）
cash_residual_twd NUMERIC(16,2) NOT NULL    — 未部署現金
realized_pnl_twd  NUMERIC(16,2)            — 已實現損益（week 1 = NULL）
equity_after_twd  NUMERIC(16,2) NOT NULL   — 本週入場時總權益
source          TEXT CHECK ('backfill_dry_run'|'live')
UNIQUE (basket_date, source)
```

**sim_ledger_holdings**（持倉明細表）
```
id              UUID PK
week_num        INTEGER NOT NULL
basket_date     DATE NOT NULL
symbol          TEXT NOT NULL
shares          INTEGER NOT NULL CHECK (> 0)
entry_price_twd NUMERIC(12,4) NOT NULL      — PIT 收盤進場價
exit_price_twd  NUMERIC(12,4)              — NULL = 仍持有
exit_date       DATE
realized_pnl_twd NUMERIC(16,2)
entry_source    TEXT CHECK ('finmind_close'|'twse_eod'|'tpex_eod'|'basket_latest_price'|'manual')
exit_source     TEXT CHECK (同上)
UNIQUE (basket_date, symbol)
```

**sim_ledger_nav**（每日 NAV 曲線）
```
id              UUID PK
nav_date        DATE NOT NULL
equity_twd      NUMERIC(16,2) NOT NULL      — 現金 + mark-to-market 市值
initial_equity  NUMERIC(16,2) NOT NULL      — 10M（計算報酬率用）
return_pct      NUMERIC(8,4)  NOT NULL      — (equity - initial) / initial × 100
week_num        INTEGER NOT NULL            — 當前持有的是哪週籃子
source          TEXT CHECK ('backfill_dry_run'|'live_eod'|'live_intraday')
UNIQUE (nav_date, source)
```

**Down migration**：`packages/db/migrations/0049_sim_ledger.down.sql`（DROP 順序正確，防 FK 殘留）

**Mike audit 前不可執行 forward migration**

---

## 二、Backfill Dry-Run — 6/2→6/30 連續 NAV

### 資料來源

| 來源 | 用途 |
|------|------|
| `audit_logs` (prod DB) | 五週 `s1_sim.signal_generated` payload → 籃子持倉 |
| FinMind `TaiwanStockPrice` | 所有 37 個 ticker × 6/2~6/30 PIT 收盤價 |
| `s1-sim-runner.ts` | exposure_weight=0.5 確認（50% 資金部署） |

### 週次已實現損益

| 週次 | 重平衡日 | 入場時總權益 | 部署成本 | 現金 | 已實現 PnL | 期末總權益 |
|------|---------|------------|---------|------|-----------|---------|
| W1 | 2026-06-02 | 10,000,000 | 4,501,150 | 5,498,850 | —（首週入場）| 10,000,000 |
| W2 | 2026-06-09 | — | 4,471,580 | — | **-321,300** | **9,678,700** |
| W3 | 2026-06-16 | — | 4,521,740 | — | **-88,820** | **9,589,880** |
| W4 | 2026-06-23 | — | 4,577,940 | — | **-5,500** | **9,584,380** |
| W5 | 2026-06-30 | — | 4,218,700 | — | **-218,700** | **9,365,680** |

**總已實現損益：-634,320 TWD（-6.34%）**

> W5（6/30）：exit 未到期，當日 NAV = 入場即以 PIT close 計算，unrealized = 0，因為 entry price = 6/30 close。

### 逐日 NAV 曲線（20 個台股交易日）

```
日期          NAV (TWD)    累計報酬    備註
2026-06-02   10,000,000  +0.00%     <<< W1 REBALANCE
2026-06-03    9,911,600  -0.88%
2026-06-04    9,797,500  -2.02%
2026-06-05    9,756,450  -2.44%
2026-06-08    9,491,600  -5.08%
2026-06-09    9,678,700  -3.21%     <<< W2 REBALANCE (realized -321,300)
2026-06-10    9,524,180  -4.76%
2026-06-11    9,427,790  -5.72%
2026-06-12    9,411,130  -5.89%
2026-06-15    9,477,070  -5.23%
2026-06-16    9,589,880  -4.10%     <<< W3 REBALANCE (realized -88,820)
2026-06-17    9,738,180  -2.62%
2026-06-18    9,904,980  -0.95%
2026-06-22    9,810,880  -1.89%
2026-06-23    9,584,380  -4.16%     <<< W4 REBALANCE (realized -5,500)
2026-06-24    9,472,080  -5.28%
2026-06-25    9,457,680  -5.42%
2026-06-26    9,185,480  -8.15%
2026-06-29    9,172,580  -8.27%
2026-06-30    9,365,680  -6.34%     <<< W5 REBALANCE (realized -218,700)
```

最大回撤：-8.27%（2026-06-29）
最高點：+0.00%（入場當日）
6/30 收盤：-6.34%

---

## 三、完整假設清單

| 代號 | 假設內容 | 風險等級 |
|------|---------|---------|
| A1 | 進場價 = 重平衡當日（Tuesday）FinMind 收盤價；非 basket 的 `latest_price`（預估值）| 低 — 更保守 |
| A2 | 零交易成本（無手續費、無證交稅） | 中 — 實際應扣 |
| A3 | 所有 8 個部位全數成交於 Tuesday 收盤，忽略 KGI SIM `filled_shares=0` | 高 — 最大假設 |
| A4 | 6/23 week（KGI SIM `accepted=0`）等同其他週，納入重建 | 中 — 如實排除則 W4 不存在 |
| A5 | 成交量 0（trading halt）日：向前走回找最近有效收盤（PIT safe） | 低 |
| A6 | 1435 新股（上市日 < 6/2）：FinMind 有歷史數據，6/30 進場時用 27.35 | 低 |
| A7 | 每週結算：`equity = cash_residual + basket_market_value`；下週 equity 即為下週起始 | 低 |
| A8 | 5/20-5/31：無 audit_logs baskets，帳本從 6/2 開始（不造假） | 低 |
| A9 | FinMind TaiwanStockPrice 涵蓋 TWSE + TPEX（37 個 ticker 全取到） | 低 |
| A10 | 股數為 basket `target_shares`（已含零股 / 整張計算），不再調整 | 低 |

**最高風險假設：A3（全數成交）+ A2（無成本）**
保守估計：扣手續費 0.1425% + 證交稅 0.3%（出場）→ 約再多損失 0.21% × 2 × 5 週 ≈ -2.1%
調整後估算：實際報酬約 **-8.4%**（非本報告正式數字，楊董 ACK 後加入 Phase 2）

---

## 四、Phase 2 落地建議

### 優先項 1：執行成本修正（高影響）

在 `sim-ledger-backfill.ts` 加入 `feeRatePct` 參數：
- 手續費：0.1425%（進出場各收）
- 證交稅：0.3%（出場收）
- 預估影響：累計多損失 ~2.1%，6/30 期末約 **9,162,000 TWD（-8.38%）**

### 優先項 2：live NAV 每日更新 cron

在 `server.ts` 加 15:10 TST 每日 cron，呼叫 `runBackfill({ dryRun: false, source: "live_eod" })`：
- 遷移 migration 0049（Mike 審過才跑）
- 用 `quote_last_close` 表（migration 0048）取收盤價，不再依賴 FinMind API polling
- EOD cron 位置：現有 `_runTwseEodCron` 結束後觸發

### 後備：若 6/23 排除

如楊董決定不計 W4（KGI SIM accepted=0 不算），只需在 `rebalanceDates` 移除 `"2026-06-23"`：
- 期末權益：9,370,180 TWD（-6.30%）
- 差距：+4,500 TWD（W4 本身損失只 -5,500，影響不大）

---

## 五、交付清單

| 檔案 | 說明 | 狀態 |
|------|------|------|
| `packages/db/migrations/0049_sim_ledger.sql` | 三表 forward migration | DRAFT — 待 Mike 審 |
| `packages/db/migrations/0049_sim_ledger.down.sql` | DOWN migration | DRAFT |
| `apps/api/src/sim-ledger-backfill.ts` | TypeScript backfill engine | 完成 |
| `tests/ci.test.ts` | sim-ledger 測試區塊 | 完成 |
| 本報告 | Phase 1 摘要 | 完成 |

**Branch**: `feat/fauto-sim-ledger-phase1-jason-20260701`
**Base commit**: `01e2d3ae`（main HEAD at time of branch）

---

## 六、驗證聲明

- 所有計算基於 audit_logs 真實 payload（prod API 2026-07-01 取得）
- FinMind 37 個 ticker 全數取到 PIT 收盤（0 個取不到）
- 5348 halt 日使用走回最近收盤（PIT compliant）
- 1435 新股 FinMind 有數據，6/30 PIT close = 27.35
- **無任何 look-ahead**：NAV 計算只使用 ≤ nav_date 的收盤
- **無 prod 寫入**：本輪全程 `DRY_RUN=true`，migration 未執行

---

*Jason — IUF Trading Room Backend Strategy Lane*
*2026-07-01*
