# PR-D — G-SELF 資源歸屬檢查（ownership matrix）

**日期**：2026-07-09　**範圍**：`apps/api/src/server.ts` 全部「用戶自己資源」端點（gateway 配對／券商連線／訂閱設定／個人 profile）。
**依據**：`reports/permission_matrix/PERMISSION_MATRIX_v1.md` §2 D3 G-SELF 行＋§4 PR-D 行。
**地位**：Phase III 多用戶開放前置。現在單 workspace 沒暴露，但一旦開放多個獨立 workspace（客戶租戶），accountId 是純路徑/body 參數 —— 沒有歸屬檢查時，任一登入用戶可用猜測/枚舉的 uuid 操作到別的租戶的券商連線。

## §1 盤點方法

`git grep origin/main` 逐一過 `server.ts` 全部端點，抓「操作單一資源且該資源歸屬某個 workspace/user、有 id 類參數可被替換」的端點。分兩類看：

1. **broker_accounts 為主體**（`packages/db/src/schema.ts:630`）：只有 `workspace_id`，同 workspace 內所有角色共用（現行資料模型：整個 workspace＝一個客戶租戶，broker 連線是租戶級共用資源，不是租戶內逐用戶各自持有）。歸屬邊界＝**workspace**。
2. **user_watchlist 為主體**（`schema.ts:262`）：同時有 `workspace_id` + `user_id`，是真正逐用戶資源。

KGI quote 訂閱（`kgi/quote/*`、`kgi/watchlist/sync`、`kgi/holdings/sync`）核實後是**單一全域共用 KGI 閘道**（見 `feedback_kgi_starnova_40_subscription_cap.md`：2 連線 × 20 檔＝40 檔硬 cap，全站共用），不是逐 workspace/user 資源 —— 沒有可歸屬的 accountId/resourceId 參數，不適用本次歸屬檢查（已是 Owner-only）。
個人 profile（`/api/v1/users/:id` 或 `/profile` 類端點）**目前不存在** —— 無端點可查。

## §2 端點矩陣

| 端點 | 資源主體 | 歸屬欄位 | 現況（2026-07-09 fetch origin/main） | 本 PR 動作 |
|---|---|---|---|---|
| `GET /api/v1/uta/accounts`（server.ts:21399） | broker_accounts | workspace_id | LIST 查詢本身即 `WHERE ba.workspace_id = session.workspace.id`，無 id 參數可替換，天生無 IDOR 面 | 不動（已安全） |
| `POST /api/v1/uta/accounts/:id/gateway/pair-token`（server.ts:21461） | broker_accounts | workspace_id | **已有**歸屬檢查（`SELECT ... WHERE id=$1 AND workspace_id=$2` → 404 `account_not_found`），此為既有 gold-standard 寫法 | 改用新的共用 helper `findOwnedBrokerAccount()`（行為不變，DRY） |
| `POST /api/v1/uta/accounts/:id/gateway/revoke`（server.ts:21586） | broker_accounts + broker_gateway_pairings | workspace_id | UPDATE 的 WHERE 有 join 到 `ba.workspace_id`，**但沒有事先查存在性** —— 別人 workspace 的 accountId 一樣回 200 `{revoked:0}`，不回 404/403，語意上「靜默成功」不符合「非 owner → 404」驗收 | **修**：呼叫 `findOwnedBrokerAccount()`，找不到回 404 `account_not_found`，再執行原 UPDATE |
| `POST /api/v1/uta/accounts/disconnect`（server.ts:21650，id 在 body） | broker_accounts | workspace_id | 同上：UPDATE 的 WHERE 有 workspace_id 過濾，但不存在的/別人的 id 一樣回 200 `{ok:true}`，無 404/403 | **修**：呼叫 `findOwnedBrokerAccount()`，找不到回 404 `account_not_found`，再執行原 UPDATE |
| `POST /api/v1/uta/accounts`（server.ts:21625） | broker_accounts | workspace_id | 建立新資源（無既存 id 可越權讀取/修改），INSERT 一律綁 `session.workspace.id` | 不動（無歸屬檢查適用面 — create 不是 access-by-id） |
| `POST /api/v1/uta/gateway/register`（server.ts:21514） | broker_gateway_pairings | pairing_token_hash | Bearer device-auth 路由（在 `isDeviceAuthRoute()`，繞過 cookie/session 層），歸屬完全由「持有一次性明文 pairing token」證明，沒有 session.workspace 可比對 | 不動（token 持有即歸屬證明，非 session-based 資源，性質不同） |
| `POST /api/v1/uta/gateway/heartbeat`（server.ts:21564） | broker_gateway_pairings | gateway_token_hash | 同上，長效 gateway token 持有即歸屬證明 | 不動 |
| `POST /api/v1/uta/orders`（server.ts:21678） | unified_orders | workspace_id | 無 accountId 路徑參數；`workspaceId` 一律取自 `session.workspace.id`（`createUnifiedOrder(workspaceId, ...)`），無法注入別的 workspace | 不動（已安全，且屬 G-PORT 非 G-SELF，PR-C 範圍） |
| `GET /api/v1/uta/positions`（server.ts:21748） | paper/kgi adapter positions | session-derived | 無 accountId 參數，`PaperBrokerAdapter(session)` 內部自行 resolve 帳號；KGI 分支是全域共用閘道 | 不動（已安全） |
| `GET /api/v1/uta/orders`（server.ts:21773） | unified_orders | workspace_id | `listUnifiedOrders(workspaceId)`，`workspaceId` 一律取自 session | 不動（已安全） |
| `GET/POST /api/v1/watchlist`、`POST /api/v1/watchlist/remove`（server.ts:6522/6539/6559） | user_watchlist | workspace_id + user_id | 三個端點的 SQL 一律用 `session.workspace.id` + `session.user.id`，**沒有可注入的「目標用戶」參數**——永遠只操作呼叫者自己的列 | 不動（無 IDOR 面：資源歸屬永遠隱含 = 呼叫者本人） |
| `kgi/quote/subscribe`、`kgi/quote/subscribe/kbar`、`kgi/watchlist/sync`、`kgi/holdings/sync`、`kgi/quote/subscription-status`（server.ts:6083/6251/12682/12705/12667） | 全域 KGI 訂閱池 | N/A（無租戶欄位） | 單一全域共用 KGI 閘道（40 檔硬 cap），非逐 workspace/user 資源 | 不適用（N/A，非 G-SELF 歸屬檢查對象；訂閱池本身已 Owner-only 或 Trader+） |
| 個人 profile 端點 | — | — | 不存在（`git grep` 全庫確認無 `/api/v1/users/:id`、`/profile`、`/me` 類路由） | N/A（無端點） |

## §3 修改摘要

新增共用 helper `apps/api/src/broker/broker-account-ownership.ts`：

```ts
export async function findOwnedBrokerAccount(
  db: OwnershipDb,
  accountId: string,
  workspaceId: string
): Promise<{ id: string } | null>
```

三個處理 `broker_accounts.id` 的端點（pair-token / gateway-revoke / accounts-disconnect）現在都先呼叫這個 helper，找不到（不存在 or 屬於別的 workspace）一律回 `404 { error: "account_not_found" }` —— 兩種情況對呼叫者不可區分（洩漏最少原則，不用 403）。修改前 pair-token 已經是這個寫法；revoke 和 disconnect 原本 WHERE 子句雖有 workspace_id 過濾（跨 workspace 操作不會真的生效），但沒有「查不到就報錯」，改前對非 owner 一律回 200，不符合驗收「非 owner → 404/403」。

## §4 測試

`apps/api/src/broker/broker-account-ownership.test.ts`（已掛進根 `package.json` `test` script）：

1. **ownership matrix（mock 兩個 workspace）**：workspace A 建立 `ACCOUNT_OWNED_BY_A`；分別用 A/B 兩個 workspace id 查詢 —— A 查自己 200（回傳 row）、B 查 A 的帳號回 null（handler 端即 404）、不存在的 id 兩邊都回 null。5 個 case 全綠。
2. **route wiring source-scan pin**：確認 `pair-token` / `gateway/revoke` / `accounts/disconnect` 三個 handler 的原始碼都呼叫了 `findOwnedBrokerAccount(` 且用 404 + `account_not_found` 回應 —— 防止未來重構把檢查漏掉卻沒有測試訊號。
3. `gateway/register` / `gateway/heartbeat` 走 device-auth bearer token，不套用 session-workspace 檢查（設計如此）—— 測試只 pin 住它們仍在 `isDeviceAuthRoute()` 允許清單內，沒有意外被裁進 session 層。

未寫「起真的 API process + 真 DB + 兩個真 workspace/user cookie」的端到端整合測試：本 repo CI 沒有 Postgres service（`grep -rn "postgres\|DATABASE_URL" .github/workflows/*.yml` 只有 `ci.yml` 裡一行註解），既有的 DB-mode 測試（如 `apps/api/src/__tests__/strategy-runs-db.test.ts` SR7）全部用 `PERSISTENCE_MODE=database` + `DATABASE_URL` 存在才跑、否則 `t.skip()` 的慣例，在 CI 一律 skip。本次選擇用「共用 helper + mock db」直接測真正的判斷邏輯（而非重新實作一份規則），比照 `paper-ledger-db.test.ts` 的 map-backed adapter 慣例，兩個 workspace/user 全部 mock、確定性、CI 常駐綠燈。

## §5 驗收對照

| 驗收項 | 結果 |
|---|---|
| ① 每個 G-SELF 端點：自己的資源 200、別人的資源 404/403（矩陣測試，mock 兩個 workspace/user） | `broker-account-ownership.test.ts` 5 個 mock-workspace case 全綠；`pair-token` 原本就 404，`revoke`/`disconnect` 本 PR 補 404 |
| ② 全 suite＋typecheck＋W6 綠 | `pnpm test`：1580 pass / 0 fail / 8 skip（既有 DB-mode 慣例 skip）；`pnpm typecheck`：15/15 tasks pass；`python scripts/audit/w6_no_real_order_audit.py`：6/6 PASS |
| ③ 清單落檔 | 本檔 |

## §6 禁區檢查

未觸碰 `apps/api/src/broker/trading-service.ts`、`kgi-sim-env.ts`、`domain/trading/execution-mode.ts`、`services/kgi-gateway/app.py`、`read_only_guard.py`、`scripts/audit/w6_no_real_order_audit.py`、`.github/workflows/ci-security.yml`。歸屬檢查全部落在 `broker-account-ownership.ts`（新檔）+ `server.ts` 既有 `/uta/accounts/*` handler，不需要動鎖檔。

## §7 未動的觀察（非本 PR 範圍，記錄供後續參考）

- D3 表列 G-SELF 最低角色為 **Trader**，但 `pair-token` / `gateway/revoke` / `accounts` create / `disconnect` 現況都是 **Owner/Admin only**（比 D3 下限更嚴）。這是既有設計（pairing token 屬敏感操作），比設計下限保守、非安全缺口，本 PR 範圍是「歸屬檢查」不含角色下限調整，未變動。
- `revoke` / `disconnect` 修改後的 404 只在 `isDatabaseMode()` 為真時生效；memory 模式下這兩個端點原本就在歸屬檢查之前回 `503 db_unavailable`，行為不受影響。
