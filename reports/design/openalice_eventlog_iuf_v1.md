# OpenAlice EventLog — IUF 自刻 Design Memo v1

**作者**: Jason (backend-strategy lane)  
**日期**: 2026-05-15  
**狀態**: DESIGN_ONLY — 不含實作程式碼，不含 migration  
**AGPL 合規聲明**: 本 memo 僅參考 OpenAlice 公開 GitHub README/docs 的概念架構，未引用任何 OpenAlice source code。所有 schema、命名、endpoint 設計均為 IUF 自行撰寫。

---

## 1. What is EventLog（OpenAlice 概念）

OpenAlice（https://github.com/TraderAlice/OpenAlice）是一個以 AI agent 驅動的交易助理框架，核心設計哲學為「交易即 Git」（Trading-as-Git）。其 EventLog component 是整個系統的事件骨幹，職責為：

1. **不可變追加（Append-only）**：所有系統狀態變更（下單、訊號觸發、風控攔截、策略執行）都以事件形式追加到 EventLog，不做 UPDATE / DELETE。
2. **單一事實來源（Single Source of Truth）**：系統不依賴 RDBMS 的 mutable state；目前狀態 = 所有事件的投影（projection）。
3. **可重播（Replayable）**：任意 timestamp 可作為截止點重播所有事件，重建任意過去時間點的系統狀態。
4. **訂閱推送（Observable streams）**：Consumer 可訂閱特定 stream，收到新事件時即時被通知（類 Kafka consumer group 語意）。

OpenAlice 的 EventLog 與 Brain、ToolCenter、UTA、Trading-as-Git 五個 component 緊密整合：EventLog 是 Brain 的記憶持久層，也是 UTA（Universal Trading Adapter）執行結果的落點，同時也是 ToolCenter 工具呼叫的審計軌跡。

---

## 2. Pattern：Event Sourcing + Append-only

Event Sourcing 是一個已有 20 年以上歷史的軟體架構模式，與 OpenAlice 框架本身無關，原始概念來自：

- Martin Fowler，"Event Sourcing"（martinfowler.com/eaaDev/EventSourcing.html）
- Greg Young，"CQRS Documents"（cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf）
- EventStoreDB 官方文件（eventstore.com/docs）

**核心理念**：

> 應用程式的狀態不儲存為「當前值」，而是儲存為「產生此狀態的所有事件序列」。

關鍵特性：

| 特性 | 傳統 CRUD | Event Sourcing |
|------|-----------|----------------|
| 狀態儲存 | 最新值（UPDATE） | 事件序列（INSERT only） |
| 時間旅行 | 不支援 | 重播到任意時間點 |
| 審計軌跡 | 需要額外 audit table | 天然就是審計軌跡 |
| 讀模型 | 直接查 table | 從事件投影（projection） |
| 刪除 | DELETE | Compensating Event（補償事件） |

**Append-only 的關鍵保證**：

- 事件一旦寫入即不可修改（immutable）
- 事件有嚴格的排序保證（sequence number 或 monotonic timestamp）
- 錯誤狀態透過「補償事件」撤銷，不是刪除原事件

**CQRS 延伸**：Event Sourcing 通常搭配 CQRS（Command Query Responsibility Segregation）。Command side 只寫事件；Query side 從事件建立 read model（projection），如物化視圖或快取。

---

## 3. IUF 現有對應：`audit_logs` table

IUF 目前已有 `audit_logs` table（建立於 migration 0001_initial），後續 migration 0028 再擴充欄位。現有 schema：

```sql
-- 0001_initial.sql（精簡版）
CREATE TABLE audit_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id),
  actor_id     UUID        REFERENCES users(id),
  action       TEXT        NOT NULL,       -- e.g. "quant_strategy.subscribe"
  entity_type  TEXT        NOT NULL,       -- e.g. "strategy", "paper_order"
  entity_id    TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 0028 追加欄位
ALTER TABLE audit_logs ADD COLUMN strategy_run_mode TEXT ...;
ALTER TABLE audit_logs ADD COLUMN paper_audit_id    UUID NULL;
ALTER TABLE audit_logs ADD COLUMN yang_explicit_ack BOOLEAN NOT NULL DEFAULT FALSE;
```

另外還有兩個「特化型事件 table」：

- `execution_events`（0007）：paper broker 的 submit/ack/fill/cancel 事件，已有 append-only 語意 + 歷史 bootstrap 設計
- `market_events`（0016）：KGI market data 推送事件，有嚴格的 idempotency key `(symbol, event_type, seq)` + UNIQUE index

**對齊評估**：IUF `audit_logs` 已是 append-only 的事件日誌（沒有 UPDATE/DELETE 路徑），且每條 action 字串（如 `quant_strategy.subscribe`, `paper_submit`, `kgi.sim.order_submitted`）就是事件類型。這與 Event Sourcing 的 append-only + typed event 原則高度對齊。

---

## 4. Gap Analysis

比較 IUF `audit_logs` 與完整 EventLog pattern 的差距：

### Gap A：缺乏 Stream 概念（Stream Identity）

EventLog 的核心單位是「stream」，例如：
- `strategy:cont_liq_v36` stream — 該策略所有事件
- `order:V000L` stream — 某筆訂單的完整生命週期事件

現有 `audit_logs` 以 `(entity_type, entity_id)` 模擬 stream，但沒有：
- Stream-level sequence number（只有全局 `created_at`，不是嚴格 monotonic）
- Stream-level subscription（沒辦法說「給我 strategy:cont_liq_v36 從 event #20 之後的所有事件」）

### Gap B：缺乏 Time-Travel（重播語意）

目前可以用 `WHERE created_at <= $ts` 做時間過濾，但：
- 沒有 `sequence_number` 保證全序（兩個事件同 `created_at` 順序不確定）
- 沒有「replay 到 version N」的 API
- 沒有 snapshot 機制，重播大量事件代價高

### Gap C：缺乏 Projection Registry（讀模型投影）

現有 audit_logs 是 write-side 記錄，但沒有定義：
- 哪些事件組合起來建構什麼 read model
- 讀模型是否物化（materialized view）或即時計算
- 投影重建（rebuild projection from event position 0）的機制

### Gap D：缺乏正式訂閱語意（Subscription / Pub-Sub）

`execution_events` 有 SSE 廣播，但 `audit_logs` 沒有：
- Consumer 訂閱特定 stream + event type 過濾
- Consumer offset 追蹤（「我讀到 event #N，下次從 #N+1」）
- At-least-once delivery 保證

### Gap E：缺乏 Schema Versioning（Payload 版本管理）

`payload JSONB` 是無 schema 的 blob。當 event payload 結構演進時：
- 沒有 `schema_version` 欄位
- 舊事件重播時不知道要用哪個版本的 deserialization 邏輯
- 沒有 upcaster（舊 schema → 新 schema 轉換器）機制

### Gap F：缺乏 Log Compaction（快照壓縮）

`audit_logs` 無限增長，沒有：
- Stream-level snapshot（特定版本點的狀態快照）
- 快照之前的事件可安全壓縮
- 資料量控制機制

---

## 5. IUF EventLog v1 Design（Proposed）

### 5.1 Schema Delta

在**不破壞現有 `audit_logs`** 的前提下，新增 EventLog 專用 table：

```sql
-- 新 table: el_event_streams（stream 定義 registry）
-- NOTE: final naming uses "el_" prefix (not "iuf_event_") to avoid collision with
--       iuf_events table (migration 0025, event-rule-engine). See migration 0033_eventlog_phase_a.sql.
CREATE TABLE el_event_streams (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_type TEXT    NOT NULL,            -- e.g. "strategy", "order", "workspace"
  stream_id   TEXT    NOT NULL,            -- e.g. "cont_liq_v36", "V000L"
  workspace_id UUID   NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, stream_type, stream_id)
);

-- 新 table: el_events（append-only 主事件 log）
CREATE TABLE el_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id       UUID        NOT NULL REFERENCES el_event_streams(id) ON DELETE RESTRICT,
  seq             BIGINT      NOT NULL,    -- per-stream 嚴格遞增（>0）
  event_type      TEXT        NOT NULL,    -- e.g. "strategy.subscribed", "order.filled"
  schema_version  INTEGER     NOT NULL DEFAULT 1,
  actor_id        UUID        REFERENCES users(id),
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL,    -- 事件發生時間（business clock）
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- 寫入時間（server clock）
  CONSTRAINT el_events_seq_positive CHECK (seq > 0),
  UNIQUE (stream_id, seq)    -- 保證 per-stream 全序（同時建立 B-tree index，不需另建）
);

-- 新 table: el_event_snapshots（Snapshot 壓縮用）
CREATE TABLE el_event_snapshots (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   UUID        NOT NULL REFERENCES el_event_streams(id) ON DELETE RESTRICT,
  up_to_seq   BIGINT      NOT NULL,        -- 此 snapshot 包含到哪個 seq
  state       JSONB       NOT NULL,        -- 壓縮後的 read model 狀態
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- index for efficient stream reads
-- NOTE: el_events 不建 (stream_id, seq) 獨立 index —— UNIQUE constraint 已建 B-tree，重複建立浪費寫入
CREATE INDEX el_events_event_type_idx ON el_events (event_type, recorded_at DESC);
```

**現有 audit_logs 保持不動**：`el_events` 是新的 write path，audit_logs 舊路徑繼續工作，雙軌並行直到 Phase B 可選擇性 deprecate。

### 5.2 Endpoint Design（4 個核心 endpoint）

**Append（命令端寫入）**

```
POST /api/v1/event-streams/:streamType/:streamId/events
Body: { eventType, payload, occurredAt?, schemaVersion? }
Response: 201 { id, seq, recordedAt }
```

- 自動 upsert iuf_event_streams（auto-create stream）
- seq 由 DB `SELECT MAX(seq)+1 ... FOR UPDATE` 生成（per-stream lock）
- actor 從 session 取得

**Read by Stream（讀取整條 stream）**

```
GET /api/v1/event-streams/:streamType/:streamId/events
Query: { fromSeq?, toSeq?, limit?, eventType? }
Response: 200 { events: [...], nextSeq, hasMore }
```

- 支援 `fromSeq` 分頁（cursor-based）
- 支援 `eventType` 過濾

**Read by Time Range（時間範圍查詢）**

```
GET /api/v1/event-streams/:streamType/:streamId/events/at
Query: { asOf }   -- ISO8601 timestamp
Response: 200 { events: [...], snapshotUsed: bool }
```

- `WHERE occurred_at <= asOf`
- 若有 snapshot（`up_to_seq`），先取 snapshot state + replay snapshot 之後到 asOf 的事件

**Subscribe（SSE 推送）**

```
GET /api/v1/event-streams/:streamType/:streamId/subscribe
Query: { fromSeq?, eventType? }
Response: text/event-stream
```

- SSE 長連接
- Server 維護 subscriber map（stream_id → SSE connections）
- 新事件 append 後廣播給訂閱者
- 斷線重連帶 `fromSeq`，server replay missed events 後接 live stream

### 5.3 Projection Registry

IUF 現有可從 EventLog 投影的 Read Model：

| Projection 名稱 | 來源 Event Types | Read Model | 目前是否存在 |
|----------------|-----------------|-----------|------------|
| StrategySubscriptionState | `strategy.subscribed`, `strategy.unsubscribed` | 每個 workspace 的訂閱策略清單 | 部分（audit_logs） |
| PaperOrderLifecycle | `order.submitted`, `order.filled`, `order.rejected`, `order.cancelled` | 訂單狀態機 | 部分（execution_events） |
| MarketDataFeed | `quote`, `tick`, `bidask`, `kbar` | 最新行情快取 | 部分（market_events） |
| AuditTrail | 全部 | 審計報告 | 是（audit_logs） |
| KillSwitchHistory | `risk.kill_switch.triggered`, `risk.kill_switch.released` | 風控歷史 | 部分（audit_logs） |

Projection Registry 設計：在 code 中維護 `PROJECTION_REGISTRY` map（event_type → projection handlers），支援：
1. 即時投影（事件 append 時同步更新 read model cache）
2. 重建投影（從 seq=0 重播所有事件重建 read model）

### 5.4 Migration Path：audit_logs Backfill

Phase A（不破壞）：新事件雙寫（write to both audit_logs + iuf_events）。  
Phase B（可選）：批次 backfill — 將現有 audit_logs 轉成 iuf_events，以 `action` 對應 `event_type`，`entity_type`/`entity_id` 組成 stream key，`payload` 直接移植，`created_at` 作為 `occurred_at`。  
Phase C（未來）：停寫 audit_logs，全走 iuf_events；audit_logs 保留為唯讀歷史。

Backfill script 邏輯（偽程式碼，不是實作）：

```
for each audit_log row:
  streamType = row.entity_type         -- "strategy", "paper_order", ...
  streamId   = row.entity_id
  eventType  = row.action              -- "quant_strategy.subscribe", ...
  upsert iuf_event_streams(streamType, streamId, workspaceId)
  insert iuf_events(stream_id, seq=next, eventType, payload, occurredAt=createdAt)
```

---

## 6. Phase A（3 天可實作 Increment）

**目標**：最小可用 EventLog，不 break 現有 audit_logs，不需要新 migration 到 prod。

**Day 1**：
- 新增 `iuf_event_streams` + `iuf_events` migration（additive-only，Mike audit 通過）
- 實作 `event-log-store.ts`：`appendEvent()`, `readStreamEvents()`, `readEventsAt()`
- 單元測試：stream 建立、seq 遞增、重複 seq 衝突（UNIQUE constraint）

**Day 2**：
- 實作 `POST /append` + `GET /events` + `GET /events/at` endpoints
- 在 `subscribeQuantStrategy()` 新增雙寫：audit_logs（現有）+ iuf_events（新）
- CI test：append → read round-trip

**Day 3**：
- 實作 `GET /subscribe` SSE endpoint（最小版：per-stream SSE，無 eventType filter）
- Smoke test：SSE 連接 → append 事件 → client 收到推送

**範圍邊界**：
- Snapshot + log compaction：Phase B 再做
- Projection rebuild：Phase B 再做
- Schema versioning（upcaster）：Phase B 再做
- audit_logs backfill：Phase B 再做（需要楊董 ACK 才執行）

---

## 7. Risks

### R1：雙寫一致性風險

雙寫路徑（audit_logs + iuf_events）沒有 2PC，可能部分成功。  
緩解：iuf_events 寫入失敗不影響 audit_logs 主路徑（降級為 warn log），接受短期不一致；Phase B backfill 修補。

### R2：per-stream seq 生成效能

`SELECT MAX(seq)+1 FOR UPDATE` 在高頻 append（如 market_events tick 流）會成為 lock 瓶頸。  
緩解：market_events 保留原有 table 不走 iuf_events；iuf_events 目標是 strategy / order / audit 等低頻業務事件（每秒 < 100 events）。

### R3：無限增長 Volume

audit_logs 已有 300k+ rows（估計）。iuf_events 全量 backfill 可能超過 PostgreSQL Railway 免費層配額。  
緩解：Phase A 只從 backfill 最近 90 天事件開始；Snapshot 在 Phase B 實作後可壓縮。

### R4：Stream Ordering 跨 Worker

Railway API 多 instance 時，兩個 instance 同時對同一 stream append，`SELECT MAX(seq)+1 FOR UPDATE` 的 row lock 有效，但需要確認 Drizzle 事務邊界正確（不能在 transaction 外部 SELECT 再 INSERT）。  
緩解：`appendEvent()` 必須在同一個 DB transaction 內完成 seq 計算 + INSERT。

### R5：SSE 連線管理

SSE 長連接佔用 Railway worker 資源。訂閱者多時可能打滿 file descriptor 上限。  
緩解：Phase A SSE 實作加 max connections per stream（預設 10），超過返回 503；Phase B 考慮 Redis pub/sub 替代 in-process subscriber map。

### R6：AGPL 合規

本 design 僅參考 OpenAlice 架構概念，未引用任何 source code。實作時工程師必須自行撰寫所有 TypeScript 程式碼，不得複製貼上任何 OpenAlice Python/TypeScript 檔案內容。任何類似命名若引發疑義，應改為 IUF 自有命名（如 `iuf_events` 而非 `openalice_events`）。

---

## 8. References

| 來源 | URL | 用途 |
|------|-----|------|
| OpenAlice GitHub | https://github.com/TraderAlice/OpenAlice | 架構概念參考（僅 README/docs） |
| Martin Fowler — Event Sourcing | https://martinfowler.com/eaaDev/EventSourcing.html | Pattern 定義 |
| Greg Young — CQRS Documents | https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf | Event Sourcing + CQRS 原始論述 |
| EventStoreDB Docs | https://developers.eventstore.com/server/v24.2/ | 商業 event store 實作參考 |
| Kurrent (EventStoreDB) Getting Started | https://developers.eventstore.com/getting-started/ | Stream / projection 語意參考 |

---

**AGPL 合規聲明（重申）**：  
本文件所有 schema 設計、endpoint 命名、payload 結構均為 IUF 獨立設計，未引用 OpenAlice 任何 source file。對 OpenAlice 的參考限於其公開 GitHub README 與 docs 層級的架構說明。本 memo 符合 AGPL 設計參考（design reference）的合規邊界。
