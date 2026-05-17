# OpenAlice UTA（Unified Trading Account）— IUF 自刻 Design Memo v1

**作者**: Jason (backend-strategy lane)  
**日期**: 2026-05-17  
**狀態**: DESIGN_ONLY — 不含實作程式碼，不含 migration  
**AGPL 合規聲明**: 本 memo 僅參考 OpenAlice 公開 GitHub README/docs 的概念架構，未引用任何 OpenAlice source code。所有 schema、命名、endpoint 設計均為 IUF 自行撰寫。

---

## 1. What is UTA（OpenAlice 概念）

OpenAlice（https://github.com/TraderAlice/OpenAlice）的 UTA（Unified Trading Account）是一個多券商統一帳戶抽象層。其核心思想是：

1. **單一 API 介面**：上層策略引擎、Brain、ToolCenter 永遠面對同一套 `Account` interface，不關心底下是哪家券商的 SDK。
2. **多券商同時連線**：同一個 workspace 可以同時持有凱基、富邦、元大等不同券商帳號，資金、持倉、委託單在 UTA 層做聚合。
3. **帳戶能力宣告（Capability Declaration）**：每個 broker adapter 宣告自己支援哪些能力（下市價單、零股、融資融券、盤後定價等），上層呼叫前可以先查能力而不是試錯。
4. **統一委託單生命週期**：不管底層 broker 事件格式有多不同，UTA 把它們統一成相同的狀態機（pending → submitted → filled / cancelled / rejected）。

UTA 讓整個系統具備「換券商不換策略」的彈性，是 OpenAlice 支援多市場佈建的基礎。

---

## 2. Pattern：Adapter + Capability Matrix

UTA 的工程模式來自兩個已知的設計模式，與 OpenAlice 本身無關：

### 2.1 Adapter Pattern（GoF）

> 一個介面轉換器，讓不相容的 API 透過共同的 interface 協作。

- 定義 `BrokerAdapter` 介面（純 TypeScript interface）
- 每家券商實作一個 concrete adapter class（e.g. `KgiBrokerAdapter`, `FubuBrokerAdapter`）
- 上層只依賴 `BrokerAdapter` 介面，永不依賴 concrete class

| 項目 | 直接耦合 KGI SDK | Adapter Pattern |
|------|-----------------|-----------------|
| 換券商代價 | 改遍所有策略呼叫點 | 只換 adapter 實作 |
| 測試 | 需要真實 KGI 連線 | 可用 mock adapter |
| 多券商並行 | 程式碼需 if/else 分支 | Registry 統一管理 |

### 2.2 Capability Negotiation（類 HTTP Content Negotiation）

Broker 能力差異（例如只有某些券商支援零股盤後定價）用明確的 capability 宣告處理，而不是 runtime try/catch：

```
adapter.capabilities() → {
  oddLot: true,
  afterHoursFixing: false,
  marginTrading: true,
  shortSelling: true,
  maxSubscriptions: 40
}
```

上層路由邏輯：

```
router.findCapableAdapter(orderId, {
  oddLot: input.isOddLot,
  afterHoursFixing: input.session === "AFTER_MARKET"
}) → adapter | null (rejected if no adapter can handle)
```

---

## 3. IUF 現有對應

### 3.1 BrokerPort（已有）

`apps/api/src/broker/broker-port.ts` — IUF 已有一個明確的 `BrokerPort` interface（TypeScript interface，非 abstract class）：

```typescript
export interface BrokerPort {
  login(credentials: KgiBrokerCredentials): Promise<BrokerSession>;
  subscribeTick(symbol: string, opts?): Promise<void>;
  createOrder(input: KgiCreateOrderInput): Promise<KgiTradeRaw>;
  getPosition(): Promise<KgiPosition[]>;
  // ... 14 個方法
}
```

現有兩個 implementations：
- `KgiBroker`（`kgi-broker.ts`）— 實際 KGI adapter，委派給 `KgiGatewayClient`
- `PaperBroker`（`paper-broker.ts`）— in-process simulation，不走真實 gateway

### 3.2 broker-port.ts 的限制（目前只有 KGI 介面）

`BrokerPort` 目前等同於「KGI adapter interface」：

- 型別名稱全是 `Kgi*`（`KgiBrokerCredentials`, `KgiAccount`, `KgiPosition`...）
- Credentials 固定是 `{ personId, personPwd, simulation? }` — 完全針對 KGI 帳密格式
- 無 capability 宣告機制
- 無 broker registry（沒辦法從設定檔動態載入不同 adapter）
- `paper-four-layer-risk-gate.ts` 直接 import KGI 型別做風控判斷

### 3.3 PaperBroker（simulation layer）

`paper-broker-store.ts` + `paper-broker.ts` 提供 paper trading simulation，但：
- 完全模仿 KGI 單一 broker 行為
- 無 multi-account aggregation
- 沒有 unified 委託單 lifecycle state machine（依賴 `execution_events` append log）

---

## 4. Gap Analysis

### Gap A：型別與介面 KGI 強耦合

`BrokerPort` interface 的型別定義全部來自 KGI（`KgiCreateOrderInput`, `KgiPosition`...）。若未來要加富邦 adapter，所有 KGI 特化欄位需要 generalize 或創造 wrapper，改動範圍很大。

### Gap B：缺乏 Broker Registry

目前沒有一個「可配置的 broker registry」。哪個 adapter 是 active adapter 靠的是 `executionMode` flag 切換（`paper` vs `live`），不是從設定檔動態選擇 `{ broker: "kgi" | "fubu" | "yuanta" }`。

### Gap C：無 Capability 宣告機制

無法在下單前 programmatically 查詢 adapter 是否支援某種委託類型（零股、盤後定價、融資等）。目前若打了不支援的委託，只能 runtime 返回錯誤。

### Gap D：無多帳號聚合

IUF 目前是單 workspace → 單 KGI 帳號 binding。若使用者想跨券商分散部位（e.g. 凱基 50% + 富邦 50%），沒有機制。

### Gap E：Credential 管理分散

KGI credentials（personId + pwd）透過環境變數直接注入 gateway，沒有 multi-broker credential vault 設計，沒辦法在 workspace 層面設定「用哪個帳號做哪個策略」。

---

## 5. IUF UTA v1 Design（Proposed）

### 5.1 Schema Delta

```sql
-- broker adapter registry（支援 adapter 類型宣告）
CREATE TABLE broker_adapters (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_key     TEXT    NOT NULL UNIQUE,   -- e.g. "kgi", "fubu", "paper"
  display_name    TEXT    NOT NULL,          -- e.g. "凱基證券"
  capabilities    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  -- capabilities 範例:
  -- { "oddLot": true, "marginTrading": true, "afterHoursFixing": false,
  --   "maxSubscriptions": 40, "simModeAvailable": true }
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- workspace 層面的 broker 帳號綁定
CREATE TABLE broker_accounts (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID    NOT NULL REFERENCES workspaces(id),
  adapter_id      UUID    NOT NULL REFERENCES broker_adapters(id),
  account_label   TEXT    NOT NULL,          -- user-visible label, e.g. "凱基主帳"
  account_ref     TEXT    NOT NULL,          -- broker-side account id（可加密存）
  allocation_pct  NUMERIC(5,2) NOT NULL DEFAULT 100.00,  -- 資金分配 %（多帳號時）
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, adapter_id, account_ref)
);

-- 統一委託單記錄（broker-agnostic order lifecycle）
CREATE TABLE unified_orders (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID    NOT NULL REFERENCES workspaces(id),
  broker_account_id UUID  NOT NULL REFERENCES broker_accounts(id),
  external_order_id TEXT  NULL,              -- broker-side order id（成功提交後填入）
  symbol          TEXT    NOT NULL,
  action          TEXT    NOT NULL CHECK (action IN ('Buy','Sell')),
  qty             INTEGER NOT NULL,
  price_type      TEXT    NOT NULL,          -- 'Limit' | 'Market' | 'LimitUp' | 'LimitDown'
  limit_price     NUMERIC(10,2) NULL,
  order_cond      TEXT    NOT NULL DEFAULT 'Cash',
  odd_lot         BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT    NOT NULL DEFAULT 'pending',
  -- status lifecycle: pending → submitted → filled | partially_filled | cancelled | rejected
  filled_qty      INTEGER NOT NULL DEFAULT 0,
  filled_price    NUMERIC(10,2) NULL,
  error_code      TEXT    NULL,
  error_message   TEXT    NULL,
  submitted_at    TIMESTAMPTZ NULL,
  filled_at       TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX unified_orders_workspace_symbol_idx ON unified_orders (workspace_id, symbol, created_at DESC);
CREATE INDEX unified_orders_status_idx ON unified_orders (status, created_at DESC);
```

**注意**：`broker_accounts.account_ref` 存放 broker-side account ID（非 credentials）。實際帳密不入 DB，維持走環境變數 / secrets vault。

### 5.2 BrokerAdapter Interface（TypeScript，broker-agnostic）

```typescript
// 通用 credentials — 每個 adapter 各自定義 concrete type
export interface BrokerCredentials {
  adapterKey: string;   // "kgi" | "fubu" | "paper"
  [key: string]: unknown;
}

// 通用委託單輸入（與 KGI 型別解耦）
export interface UnifiedOrderInput {
  symbol: string;
  action: "Buy" | "Sell";
  qty: number;
  priceType: "Market" | "Limit" | "LimitUp" | "LimitDown";
  limitPrice?: number;
  orderCond?: "Cash" | "Margin" | "ShortSelling" | "LendSelling";
  oddLot?: boolean;
}

// Capability 宣告（adapter 實作時填入）
export interface BrokerCapabilities {
  oddLot: boolean;
  marginTrading: boolean;
  shortSelling: boolean;
  afterHoursFixing: boolean;
  simModeAvailable: boolean;
  maxSubscriptions: number;
}

// 通用 BrokerAdapter interface（取代現有 BrokerPort）
export interface BrokerAdapter {
  readonly adapterKey: string;
  capabilities(): BrokerCapabilities;
  connect(credentials: BrokerCredentials): Promise<void>;
  disconnect(): Promise<void>;
  submitOrder(input: UnifiedOrderInput): Promise<{ externalOrderId: string }>;
  cancelOrder(externalOrderId: string): Promise<void>;
  getPositions(): Promise<UnifiedPosition[]>;
  subscribeQuote(symbol: string): Promise<void>;
  onTick(cb: (symbol: string, data: UnifiedTick) => void): void;
}
```

### 5.3 Endpoint Design

**查詢可用 Adapter**

```
GET /api/v1/uta/adapters
Response: { adapters: [{ adapterKey, displayName, capabilities, isActive }] }
```

**查詢 Workspace 綁定帳號**

```
GET /api/v1/uta/accounts
Response: { accounts: [{ id, adapterKey, accountLabel, allocationPct, isPrimary }] }
```

**提交統一委託單**

```
POST /api/v1/uta/orders
Body: { symbol, action, qty, priceType, limitPrice?, orderCond?, oddLot? }
Response: 201 { id, status, brokerAccountId, externalOrderId? }
```

**查詢委託單狀態**

```
GET /api/v1/uta/orders/:id
Response: { id, status, filledQty, filledPrice?, submittedAt?, filledAt? }
```

**統一持倉快照**

```
GET /api/v1/uta/positions
Response: { positions: [{ symbol, qty, broker, unrealized, realized }], aggregated: [...] }
```

---

## 6. Phase A（3 天可實作 Increment）

**目標**：最小可用 UTA 層，讓系統具備 broker-agnostic interface，不破壞現有 KGI + PaperBroker 路徑。

**Day 1**：
- 新增 `broker_adapters` + `broker_accounts` migration（additive-only）
- 定義 `BrokerAdapter` interface（`broker-adapter.ts`）— 與 KGI 型別解耦
- KGI adapter wrapper：將 `KgiBroker` 包裝成符合新 `BrokerAdapter` interface 的 `KgiBrokerAdapter`
- Paper adapter：同上包裝 `PaperBroker` → `PaperBrokerAdapter`

**Day 2**：
- 新增 `unified_orders` migration
- `unified-order-store.ts`：`createUnifiedOrder()`, `updateUnifiedOrderStatus()`, `getUnifiedOrders()`
- `POST /api/v1/uta/orders` 路由：capability check → route to active adapter → write `unified_orders`

**Day 3**：
- `GET /api/v1/uta/adapters` — 從 `broker_adapters` table 讀
- `GET /api/v1/uta/positions` — 呼叫 active adapter `getPositions()` + 格式化
- Smoke test：paper adapter submit → `unified_orders` status 更新

**範圍邊界**：
- 多帳號聚合（allocation_pct 加權）：Phase B 再做
- 帳號 credential vault：Phase B 再做（Phase A 維持現有 env var 路徑）
- 跨 broker 委託路由邏輯：Phase B 再做

---

## 7. Risks

### R1：BrokerPort → BrokerAdapter 過渡期衝突

現有 `server.ts` 直接使用 `BrokerPort`（KGI 強耦合型別）。Phase A 引入 `BrokerAdapter` 時，兩套 interface 並存可能造成型別混亂。  
緩解：Phase A 只在新路由（`/api/v1/uta/*`）使用 `BrokerAdapter`；舊路由維持 `BrokerPort`；Phase B 再統一。

### R2：KGI 帳密不入 DB 的設計邊界

`broker_accounts` 只存 `account_ref`（broker-side account ID），不存 `personId/pwd`。若未來需要系統自動 re-login（gateway crash 重啟），需要有 credential source — 目前仍靠 env vars，不是 DB-driven。  
緩解：Phase A 接受此限制，明確在 schema comment 中標注。

### R3：unified_orders 與 execution_events 雙軌

現有 paper 路徑用 `execution_events` 記錄委託生命週期，新的 `unified_orders` 是另一套記錄。Phase A 雙軌並行，會有資料重複。  
緩解：Phase A 的 `unified_orders` 只走 UTA 路由（`/api/v1/uta/orders`），舊 paper 路由不動；Phase B 整合。

### R4：多帳號分配比例的 race condition

若 `allocation_pct` 欄位未來要支援動態調整（同時多個策略下單），需要協調各 adapter 的資金剩餘量，否則可能超額使用某個 broker 帳號。  
緩解：Phase A 固定單帳號（單 adapter），allocation 邏輯留空；Phase B 再設計 broker-level position limit。

---

## 8. References

| 來源 | URL | 用途 |
|------|-----|------|
| OpenAlice GitHub | https://github.com/TraderAlice/OpenAlice | 架構概念參考（僅 README/docs） |
| GoF — Adapter Pattern | Gang of Four "Design Patterns" Ch.4 | Adapter interface 設計原則 |
| Martin Fowler — Enterprise Patterns | https://martinfowler.com/eaaCatalog/ | BrokerPort / BrokerAdapter seam 設計 |
| IUF broker-port.ts | apps/api/src/broker/broker-port.ts | IUF 現有 BrokerPort interface 定義 |
| IUF kgi-broker.ts | apps/api/src/broker/kgi-broker.ts | KGI concrete adapter 實作參考 |

---

**AGPL 合規聲明（重申）**：  
本文件所有 schema 設計、TypeScript interface、endpoint 命名均為 IUF 獨立設計，未引用 OpenAlice 任何 source file。對 OpenAlice 的參考限於其公開 GitHub README 與 docs 層級的架構說明。
