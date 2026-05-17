# OpenAlice Trading-as-Git — IUF 自刻 Design Memo v1

**作者**: Jason (backend-strategy lane)  
**日期**: 2026-05-17  
**狀態**: DESIGN_ONLY — 不含實作程式碼，不含 migration  
**AGPL 合規聲明**: 本 memo 僅參考 OpenAlice 公開 GitHub README/docs 的概念架構，未引用任何 OpenAlice source code。所有 schema、命名、endpoint 設計均為 IUF 自行撰寫。

---

## 1. What is Trading-as-Git（OpenAlice 概念）

OpenAlice（https://github.com/TraderAlice/OpenAlice）的核心設計哲學之一是「Trading-as-Git」——把交易的所有狀態變更視為 Git commit，讓持倉、策略參數、訂單歷史都有：

1. **版本快照（Snapshot）**：任意時間點的完整持倉狀態可以被「commit」，形成一個可回頭查看的版本節點。
2. **差異比較（Diff）**：兩個版本之間的持倉變動可以用 diff 格式呈現（哪些股票新增、哪些賣出、哪些持倉數量變化）。
3. **分支（Branch）**：策略實驗可以在「分支」上進行，不影響「主幹」已確認的策略配置，分支確認後 merge 回主幹。
4. **回滾（Rollback）**：若策略配置或持倉出問題，可以 rollback 到某個過去的 commit 狀態重新執行。
5. **變更記錄（Blame/Log）**：每個持倉變化的原因可以追溯（哪個策略信號、哪個 Brain 決策、哪個手動操作觸發）。

這個模式讓整個交易系統具備「軟體工程等級的版本控制」，使策略回顧、風控審計、A/B 測試都更有依據。

---

## 2. Pattern：Snapshot + Diff + Linked List

Trading-as-Git 的工程基礎來自兩個領域的成熟模式：

### 2.1 Database Temporal Table（SQL:2011）

資料庫時序表（Temporal Table）是 SQL 標準的一部分，記錄每個時間點的「有效狀態」：

- `valid_from` + `valid_to` 欄位定義「此版本在哪個時間區間有效」
- 查詢某個時間點的狀態：`WHERE valid_from <= $ts AND ($ts < valid_to OR valid_to IS NULL)`
- 不同於 Event Sourcing 的「事件序列重播」，Temporal Table 直接儲存投影後的 ready-to-read 狀態

### 2.2 Merkle Tree / Linked List（Git 概念）

Git commit 的資料結構：

```
Snapshot C3 (最新)
  ├── parent: C2
  ├── snapshot_at: 2026-05-17T14:30:00Z
  └── positions: { "2330": 1000, "2317": 2000 }

Snapshot C2
  ├── parent: C1
  ├── snapshot_at: 2026-05-16T14:30:00Z
  └── positions: { "2330": 500, "2454": 3000 }

Snapshot C1 (root)
  ├── parent: null
  └── ...
```

`diff(C2, C3)` = `{ added: [], removed: ["2454"], changed: [{ symbol: "2330", from: 500, to: 1000 }] }`

---

## 3. IUF 現有對應

### 3.1 audit_logs（委託審計，非持倉快照）

`audit_logs` 記錄每次 action（`paper_submit`, `quant_strategy.subscribe`...），是 append-only 事件日誌，但：
- 不提供「某時間點完整持倉」的 ready-to-read snapshot
- 需要重播所有 paper fill 事件才能推算當前持倉，沒有直接 snapshot 表

### 3.2 execution_events（委託生命週期）

`execution_events` 記錄 paper order 的 submit/ack/fill/cancel 事件，是 Trading-as-Git 的「事件原料」，但：
- 沒有持倉快照（需要聚合計算）
- 沒有版本 diff 機制
- 沒有「策略參數版本」的概念

### 3.3 strategy_runs（策略執行紀錄）

`strategy_runs` 記錄每次策略 run 的 tick count、信號、選股結果，但：
- 不是完整持倉快照
- 沒有 parent-child 版本關係
- 沒有 rollback 語意

### 3.4 strategy-toggle-mode.ts（策略模式切換）

`strategy-toggle-mode.ts` 記錄 `paper` / `live` 模式切換事件，是策略配置的「狀態轉移」，但不是 Git-style 帶 diff 的版本控制。

---

## 4. Gap Analysis

### Gap A：缺乏持倉快照表（Portfolio Snapshot）

目前沒有一張表記錄「某時間點整個 workspace 的完整持倉狀態」。要知道昨天收盤時的持倉，需要：

1. 從 `execution_events` 撈出所有 fill 事件
2. 聚合計算每個 symbol 的 net position

這個計算在 paper 環境下尚可接受，但 live 環境（真實持倉）沒有這個 source of truth。

### Gap B：缺乏版本 diff 語意

兩個策略 run 之間「換了哪些持倉」沒有 first-class 的 diff record。策略回顧時只能人工比較。

### Gap C：缺乏策略參數版本控制

策略的關鍵參數（如 cont_liq_v36 的 `sector_cap=4`、`regime_filter=true`）沒有版本紀錄。若策略員修改參數，無法追溯「用哪個參數版本做了哪幾個 run」。

### Gap D：缺乏 Rollback 語意

若某個策略錯誤下單（選錯一批股票），沒有「rollback 到上個 snapshot 的持倉」的 API。目前只能手動建立 counter 訂單。

### Gap E：缺乏 Branch 概念

A/B 測試兩個策略版本時，兩個 run 的結果無法在同一個 namespace 下做正式比較，缺少 branch 隔離。

---

## 5. IUF Trading-as-Git v1 Design（Proposed）

### 5.1 Schema Delta

```sql
-- 持倉快照：workspace 某時間點的完整持倉
CREATE TABLE portfolio_snapshots (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID    NOT NULL REFERENCES workspaces(id),
  parent_id        UUID    NULL REFERENCES portfolio_snapshots(id), -- Git parent commit
  snapshot_at      TIMESTAMPTZ NOT NULL,
  trigger          TEXT    NOT NULL,
  -- trigger 種類: "strategy_run", "manual", "eod_auto", "risk_event", "rollback"
  trigger_ref_id   TEXT    NULL,        -- e.g. strategy_run_id, audit_log_id
  positions        JSONB   NOT NULL,    -- { "2330": { qty: 1000, avgCost: 850.0 }, ... }
  total_market_value NUMERIC(16,2) NULL,
  total_cost       NUMERIC(16,2) NULL,
  cash_balance     NUMERIC(16,2) NULL,
  metadata         JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- 任意附加資訊
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 持倉 diff：兩個 snapshot 之間的差異（pre-computed，避免每次查詢重算）
CREATE TABLE portfolio_diffs (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  from_snapshot_id UUID    NOT NULL REFERENCES portfolio_snapshots(id),
  to_snapshot_id   UUID    NOT NULL REFERENCES portfolio_snapshots(id),
  diff             JSONB   NOT NULL,
  -- diff 結構:
  -- {
  --   added:   [{ symbol, qty, estimatedCost }],
  --   removed: [{ symbol, qty, estimatedProceeds }],
  --   changed: [{ symbol, fromQty, toQty, delta }],
  --   unchanged: ["2330", ...]   -- symbols with same qty
  -- }
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_snapshot_id, to_snapshot_id)
);

-- 策略參數版本：策略每次修改關鍵參數時建立版本記錄
CREATE TABLE strategy_param_versions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID    NOT NULL REFERENCES workspaces(id),
  strategy_id      TEXT    NOT NULL,   -- e.g. "cont_liq_v36"
  version_label    TEXT    NOT NULL,   -- e.g. "v36-sector_cap4"
  parent_version_id UUID   NULL REFERENCES strategy_param_versions(id),
  params           JSONB   NOT NULL,   -- 所有策略參數的 snapshot
  -- params 範例: { "sector_cap": 4, "regime_filter": true, "top_n": 20 }
  author_id        UUID    NULL REFERENCES users(id),
  note             TEXT    NULL,       -- 修改原因說明
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,  -- 目前哪個版本是 active
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- index
CREATE INDEX portfolio_snapshots_workspace_time_idx ON portfolio_snapshots (workspace_id, snapshot_at DESC);
CREATE INDEX portfolio_snapshots_parent_idx ON portfolio_snapshots (parent_id);
CREATE INDEX strategy_param_versions_strategy_idx ON strategy_param_versions (workspace_id, strategy_id, created_at DESC);
```

### 5.2 核心演算法：Diff Computation

```
function computeDiff(fromPositions, toPositions):
  fromMap = Map<symbol, qty>(fromPositions)
  toMap   = Map<symbol, qty>(toPositions)

  added   = symbols in toMap not in fromMap
  removed = symbols in fromMap not in toMap
  changed = symbols in both where qty differs
  unchanged = symbols in both where qty same

  return { added, removed, changed, unchanged }
```

Diff 在 `portfolio_snapshots` 寫入時同步計算（若 `parent_id` 存在），存入 `portfolio_diffs`。避免每次 API 查詢重算。

### 5.3 Endpoint Design

**建立持倉快照（手動 commit）**

```
POST /api/v1/portfolio/snapshots
Body: { positions?, trigger?, note? }
  -- positions 若省略，自動從 paper_ledger / kgi positions 讀取
Response: 201 { id, snapshotAt, parentId, diffSummary? }
```

**查詢快照清單（Git log）**

```
GET /api/v1/portfolio/snapshots
Query: { limit?, before?, after? }
Response: 200 {
  snapshots: [{ id, snapshotAt, trigger, parentId, positionCount }],
  hasMore
}
```

**查詢單一快照（Git show）**

```
GET /api/v1/portfolio/snapshots/:id
Response: 200 { id, snapshotAt, positions, totalMarketValue, cashBalance, parentId }
```

**比較兩個快照（Git diff）**

```
GET /api/v1/portfolio/snapshots/diff
Query: { from, to }   -- snapshot IDs
Response: 200 {
  diff: { added, removed, changed, unchanged },
  fromSnapshot: { id, snapshotAt },
  toSnapshot:   { id, snapshotAt }
}
```

**策略參數版本管理（Git commit for strategy config）**

```
POST /api/v1/strategies/:strategyId/param-versions
Body: { versionLabel, params, note? }
Response: 201 { id, versionLabel, parentVersionId }

GET /api/v1/strategies/:strategyId/param-versions
Response: 200 { versions: [...] }  -- Git log for strategy params
```

---

## 6. Phase A（3 天可實作 Increment）

**目標**：最小可用 Trading-as-Git — 持倉快照 + diff，讓回顧與審計有資料基礎。

**Day 1**：
- 新增 `portfolio_snapshots` + `portfolio_diffs` migration（additive-only）
- `portfolio-snapshot-store.ts`：`createSnapshot()`, `listSnapshots()`, `getSnapshotById()`
- `computePositionDiff()` 純函數（接受兩個 positions JSONB，輸出 diff 物件）

**Day 2**：
- `POST /api/v1/portfolio/snapshots` 路由：從 paper_ledger 讀取當前持倉 → 建立 snapshot → 計算 diff（若有 parent）
- `GET /api/v1/portfolio/snapshots` 路由：分頁 list（cursor = snapshot_at）
- `GET /api/v1/portfolio/snapshots/diff` 路由：讀 `portfolio_diffs`，若無則 on-the-fly 計算

**Day 3**：
- EOD auto-snapshot job（每日 14:30 TST 自動建立當日持倉快照）
- `strategy_param_versions` migration + `POST` 路由（最小版）
- CI test：snapshot → diff round-trip

**範圍邊界**：
- Branch 語意（實驗性分支）：Phase B 再做
- Rollback 執行（自動建立 counter 訂單）：Phase B 再做
- Live broker 持倉 snapshot（目前 paper 持倉）：Phase B 整合 UTA 後再做

---

## 7. Risks

### R1：positions JSONB Schema 演進

`portfolio_snapshots.positions` 是無 schema 的 JSONB。若持倉格式（欄位）需要演進（加 `avgCost`、`costBasis`），舊 snapshot 無法自動 migrate。  
緩解：Phase A 定義 `positions` 的標準格式並在 `portfolio-snapshot-store.ts` 中強制 validate（用 Zod）；版本欄位留在 `metadata.schema_version` 做日後 upcaster 用。

### R2：Diff Pre-computation vs On-the-fly

預計算 diff（寫入 `portfolio_diffs`）可以加速查詢，但若 snapshot 數量多、每次 create 都觸發 diff 計算，寫入效能會受影響。  
緩解：Phase A 只計算 child → parent diff（最常見的查詢），cross-snapshot diff（`from=C1, to=C3` 跳過 C2）改為 on-the-fly 計算。

### R3：EOD Auto-Snapshot 在假日的行為

若 14:30 job 在台股假日觸發，paper_ledger 可能沒有當日交易，snapshot 等同前一日。  
緩解：Auto-snapshot job 先查台股交易日曆（現有 `tw-market-calendar.ts`），假日 skip。

### R4：strategy_param_versions 與 strategy-engine 解耦

現有 `strategy-engine.ts` 的參數是 hardcoded 在 code 中（cont_liq_v36 的各種常數）。`strategy_param_versions` 是 DB record，兩者需要對齊 — 若 code 改了 hardcoded 參數但沒建新 DB version，版本記錄就不準確。  
緩解：Phase A 的 `strategy_param_versions` 做為「人工登記」用途，不要求與 code 自動同步；Phase B 再設計 code-driven param version。

---

## 8. References

| 來源 | URL | 用途 |
|------|-----|------|
| OpenAlice GitHub | https://github.com/TraderAlice/OpenAlice | 架構概念參考（僅 README/docs） |
| SQL:2011 Temporal Tables | ISO/IEC 9075-2:2011 §4.12 | 時序資料建模標準 |
| Git 資料結構 | https://git-scm.com/book/en/v2/Git-Internals-Git-Objects | Commit / Tree / Blob 設計參考 |
| Martin Fowler — Snapshot Pattern | https://martinfowler.com/eaaDev/Snapshot.html | Portfolio snapshot 設計 |
| IUF execution_events | apps/api/src/broker/execution-events-store.ts | IUF 現有委託事件記錄 |
| IUF strategy_runs | apps/api/src/strategy-runs-store.ts | IUF 現有策略執行紀錄 |

---

**AGPL 合規聲明（重申）**：  
本文件所有 schema 設計、演算法、endpoint 命名均為 IUF 獨立設計，未引用 OpenAlice 任何 source file。對 OpenAlice 的參考限於其公開 GitHub README 與 docs 層級的架構說明。
