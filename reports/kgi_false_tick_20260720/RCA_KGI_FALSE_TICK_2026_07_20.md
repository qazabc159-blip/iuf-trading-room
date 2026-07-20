# RCA — KGI tick channel 推「昨收值＋新鮮時間戳」假 tick（P0，盤中）

**日期**: 2026-07-20（一）盤中，Elva 11:20 實測觸發
**作者**: Jason（backend strategy lane）
**狀態**: 根因鎖定＋修復完成（單一 root cause，單檔修復），待 Elva 裁定 deploy 時機

---

## 下單風控污染面（最優先結論）— **YES，有污染**

`riskCheck`/`quoteGate` 路徑（`apps/api/src/broker/execution-gate.ts` →
`getMarketDataDecisionSummary()` → `market-data.ts` `resolveMarketQuotes()`/
`withFreshness()`）與 `effective-quotes` 走**同一顆**被污染的 `kgi` 來源
freshness 判斷。`buildConsumerDecision()`（`market-data.ts:933-969`）：

- **execution（真金）模式**：`liveUsable = freshnessStatus==="fresh" && selectedSource==="kgi"` → 若成立且 `readiness==="ready"` → `decision="allow"`（**無 review 摩擦，直接放行**）。
- **paper（模擬，現正日常使用）模式**：`paperUsable = freshnessStatus==="fresh"` → 若 `readiness==="ready"` → `decision="allow"`。

由於本次根因（見下）讓 `kgi` 來源的 `isStale` **永遠**為 `false`（不管真實 tick
年齡多舊），只要 ring buffer 裡曾經有過任一筆 kgi tick，`freshnessStatus` 就會
被判 `"fresh"` — 這代表 paper 下單預覽/送單（今天正在用）與真金下單（鎖檔中，
但架構同源）都可能在完全不知情的狀況下，用一個「顯示為剛剛發生、實際上可能是
很久以前甚至隔日收盤」的錯誤價格通過凍結閘門，且畫面/audit 不會顯示任何
stale 警示。**未查到今天已有實際下單被此污染的證據**（Elva 通報的是顯示層/
effective-quotes 觀測，非送單事故），但閘門本身確定失效，非僅顯示問題。

---

## 根因（單一，已用 Node 20 實測驗證，非推測）

KGI SDK 原始 tick 的 `datetime` 欄位格式是 14 位數字字串 `YYYYMMDDHHmmss`
（**無分隔符、無時區**，例：`"20260423090038"`，見
`services/kgi-gateway/SCHEMA_MAPPING.md:160`），不是 ISO 8601。

`apps/api/src/kgi-subscription-manager.ts` 的 `fetchKgiLatestTick()`
（修復前 line 790）：
```ts
const ts = tick.datetime ?? tick._received_at ?? null;
const staleSec = ts ? Math.round((Date.now() - Date.parse(ts)) / 1000) : null;
```
優先採用這個原始、無法被 JS Date 解析的欄位。實測：

```
$ node -e 'console.log(Date.parse("20260423090038"))'
NaN
```

`Date.parse()` 對此格式回傳 `NaN`（非拋錯，靜默失敗）。這個 `NaN` 一路往下傳：

1. `KgiTickSnapshot.ts` = 原始未解析字串 → `staleSec = NaN`。
2. `server.ts` `_mapKgiTicksToUpsertQuotes()`（line 18383-）保留 `tick.ts`
   逐字寫入 `quoteProviders.kgi` 的 `timestamp` 欄位（這是 2026-07-10 #1285
   時代刻意的設計 — 保留 tick 自身發生時間，不用 cron 執行時間蓋掉，用意是
   避免「gateway 活著但吐舊快取」被誤判為剛發生 — 立意正確，但沒防到「這個
   欄位本身就無法被解析」的情境）。
3. `market-data.ts` `withFreshness()`（line 659-667）：
   ```ts
   const ageMs = Math.max(0, Date.now() - new Date(entry.timestamp).getTime());
   const isStale = ageMs > getQuoteStaleMs(entry.source);
   ```
   `new Date("20260423090038").getTime()` = `NaN` → `Date.now() - NaN = NaN`
   → `Math.max(0, NaN) = NaN` → `ageMs = NaN`。
   **`NaN > 5000` 在 JavaScript 中恆為 `false`**（NaN 比較永遠 false）→
   `isStale = false` → **這筆 quote 被永久判定為「新鮮」，不論其真實年齡多舊**。

這條鏈是**確定性 bug**，不是今天特定行情狀態才觸發——只要 ring buffer 裡曾經
寫入過任何一筆真實 tick（哪怕是很久以前、甚至是 gateway 重啟前殘留的舊資料），
只要 KGI-QUOTE-INGEST-CRON（60s 週期，`server.ts:19972`）再次把它讀出來
bridge 進 `quoteProviders.kgi`，就會被永久標記 fresh。今天之所以浮上檯面，
是因為盤中出現真實成交暫停/稀疏的窗口（2330/2454 在 11:2x 的 TWSE MIS
`z='-'`），讓 ring buffer 最後一筆 tick 停在很久以前，此時「假新鮮」與
「真實新鮮」的差異才被 Elva 的人工交叉比對抓到。

### 為何 `/companies/:id/quote/realtime`（公司頁 quote widget）沒中招

同一個 gateway、同一個 ring buffer，但走的是不同程式（`broker/kgi-quote-client.ts`
`getRecentTicks()`），採用的是 gateway 自己寫入 buffer 時蓋的、**真正 ISO 8601**
的 `_received_at`（Python 端 `datetime.now(timezone.utc).isoformat()`，
`kgi_quote.py:139-148`）做新鮮度判斷，而非 SDK 的原始 `datetime` 欄位——這條路徑
本來就沒有這個 bug，也解釋了 Elva 觀測到「同一檔股票，一邊誠實標 STALE，一邊
effective-quotes 標 fresh」的矛盾。

### 為何 #1298 完整性閘門沒攔到

`market-data-integrity-gate.ts` 的職責範圍是**跨源交易日一致性**（EOD/熱力圖
enricher 用的 `resolveAuthoritativeTradeDate`），完全不在 kgi tick ingest →
effective-quotes → execution-gate 這條管線上，兩者是不同子系統，結構上不可能
攔到這個 bug。

### 排除項

- **owner quote-smoke cron**（`server.ts:4715` `POST /kgi/sim/quote-smoke`）：
  寫入的是獨立的 `state.lastQuoteTime`（SIM 專用診斷 state），不寫
  `quoteProviders.kgi`，與本 bug 無關，已排除。
- **#1285 reconciler `recordTickReceived()`**：只寫 `slot.lastTickAt`/
  `slot.subscribed`（訂閱池自身簿記），不寫價格/新鮮度，是不同資料結構，
  不是本 bug 的寫入點，已排除。

### 附帶發現：測試 fixture 與真實 gateway 格式脫節

`apps/api/src/__tests__/kgi-subscription-manager.test.ts` 原本的 mock gateway
（修復前 line 78-95）對 `/quote/ticks` 回傳 `datetime: new Date().toISOString()`
——這是**合法 ISO 8601**，不是真實 KGI SDK 會吐的 `YYYYMMDDHHmmss` 格式，因此
整條測試套件從未真正演練過這個 bug 的觸發條件。本次修復已補上用真實格式的
regression test（見下）。

---

## 修復內容

**單檔案 root-cause 修復**（`apps/api/src/kgi-subscription-manager.ts`），不動
`market-data.ts`（受限檔案，本次派工未明示要動，且此檔的 fail-open on NaN 更適合
另案列為 defense-in-depth 補強，見下方建議）：

新增純函式 `_parseKgiRawDatetime(raw)`：把 KGI 原始 `YYYYMMDDHHmmss` 字串正確
解析成帶 `+08:00`（台北時區）offset 的 ISO 8601 字串；格式不符/解析失敗一律回
`null`（不拋錯），呼叫端 fallback 到 gateway 自己蓋的可靠 `_received_at`：

```ts
const ts = _parseKgiRawDatetime(tick.datetime) ?? tick._received_at ?? null;
```

這保留了 2026-07-10 的原始設計意圖（優先用 tick 自身發生時間、不是 cron
執行時間），只是讓這個欄位第一次被**正確解析**而不是被直接丟給
`Date.parse()`。

---

## 驗證

- `pnpm run build:api`（含 tsc 全 workspace 型別檢查）：綠。
- `node --test` 針對 `kgi-subscription-manager.test.ts`：**21/21 綠**
  （17 條既有 QM1-16 + 3 條新 `_parseKgiRawDatetime` 單元測試 + 1 條
  `fetchKgiLatestTick` regression test，用真實 `YYYYMMDDHHmmss` 格式驗證
  `staleSec` 不再是 `NaN`，且能正確算出「約 1 小時前」）。
- `pnpm test`（全 workspace node --test，memory-mode，1956 tests）：
  **1946/1956 綠**，2 個失敗（`finmind-client.test.ts` T3/T11「token missing」）
  經 `git stash` 隔離驗證為**修改前既有失敗**（shell 環境有 `FINMIND_TOKEN`
  污染了「token 缺席」情境的測試假設，與本票無關，未修復——不在本次任務範圍）。

---

## Deploy 時機判定（P0 熱修 vs 排 13:30 收盤後）

**判定：排 13:30 收盤後 merge，不熱修**。理由：

1. 目前確認的是**顯示層** effective-quotes 誤標 fresh，以及**風控閘門的新鮮度
   判準失效**（放行風險），但**未查到任何已實際送出的錯誤下單**——真金路徑本來
   就鎖著，paper 路徑今天目前沒有 Elva/Bruce 回報的異常成交。
2. 這不是「使用者看到會直接誤判虧損/獲利」等級的顯示錯誤（如帳本金額算錯），
   而是「凍結價格被誤標新鮮」，且 #1316（今早剛 merge/deploy）已經在前端擋掉了
   「顯示凍結 tick 當即時」的使用者可見症狀（`isKgiTickFreshEnoughToTrust()`
   用真實 `staleSince` age 判斷，不再單純信任後端 fresh 旗標）——也就是說，
   **使用者面的顯示傷害在 #1316 已經有一層防線**，本票是後端根因的第二層修復。
3. 若 Elva 判斷用戶面損害已超過 10 分鐘 deploy 空窗的代價，可直接推翻本判定改
   熱修——本 PR 已 CI-ready，可隨時 merge。

---

## 建議後續（不在本票範圍，僅記錄供排隊）

- **`market-data.ts` `withFreshness()` 的 NaN fail-open 是系統性風險**：任何來源
  只要 timestamp 解析失敗，就會靜默變成「永遠新鮮」而非「永遠過期」，方向完全
  反了（fail-open 用錯方向）。本次只在 kgi 這一個消費點堵住，但這個函式本身
  對所有 `QuoteSource` 共用。建議另案（需 Elva 明示派工，`market-data.ts` 屬
  受限檔案）補一行 `if (!Number.isFinite(ageMs)) return {...isStale:true}`
  做 fail-closed 兜底，防止未來任何來源出現類似格式問題時重演同一個 bug class。
- 若上述補強採納，同步替 `getQuoteStaleMs`/`withFreshness` 加一條
  「malformed timestamp → 强制 stale」regression test。
