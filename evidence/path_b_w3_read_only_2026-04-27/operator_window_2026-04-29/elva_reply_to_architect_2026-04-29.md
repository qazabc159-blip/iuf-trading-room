# Elva → 外包架構師 回信草稿（2026-04-29 下午）

**用途**：依 2026-04-29 楊董指示，由 Elva 處理回信給設計師
**狀態**：DRAFT — 楊董過目後決定是否轉發。若設計師當前有未貼出的新提問，請補貼，本稿會再修。
**版本對齊**：`main @ 6749d49`（PR #13 已 merge，PR #12 Option C DRAFT 待 ACK）

---

## 信件主體（建議直接轉發）

> 您好，
>
> 接 Q1–Q6 + Day 1–4 那一輪後，今天我這邊把後端兩件事推到一個可靠的位置，方便您 Day 1–4 安心動手：
>
> **一、後端今天的可信任狀態**
>
> 1. `main @ 6749d49`，CI 綠、Railway 生產部署綠（兩段時間：04:06 UTC 與 04:14 UTC）。
> 2. PR #13 已 merge：`/order/create` 對任何 payload 都回 **HTTP 409 + `{ "error": { "code": "NOT_ENABLED_IN_W1", ... } }`**，且後端 0 個 SDK 呼叫。前端在 Day 1–4 全段都可以放心：這條 route 不會因為您不小心串到，導致下單。
> 3. PR #12（`KGI_QUOTE_SYMBOL_WHITELIST` Option C — config-required，無 default）目前 DRAFT，等楊董 ACK 才 merge。**merge 後**的行為差異您要先記下：
>    - env 未設或空 → `/quote/*` 全部回 **HTTP 503 + `{ "error": { "code": "WHITELIST_NOT_CONFIGURED", "message": "...", "envVar": "KGI_QUOTE_SYMBOL_WHITELIST" } }`**
>    - env 已設、symbol 不在白名單 → 一樣維持 **HTTP 422 + `SYMBOL_NOT_ALLOWED`**
>    - env 已設、symbol 在白名單 → 200，正常路徑
>
>    所以前端在 Day 1–4 過程中，`/quote/*` 要把 503 / 422 / 200 三條都顯示成 graceful empty / inline error，**不要** retry storm。SWR 預設仍照前一輪的設定（KBAR 60s/30s、QUOTE 15s/7.5s、TODAY 30s/15s），不要對這三個錯誤碼做指數退避重試。
>
> **二、再次確認的硬線（請您 Day 1–4 全程不要踩）**
>
> 1. **凱基（KGI）= 我們唯一目前接的券商**。groovy 群益（Capital Securities）跟本專案完全無關，任何文件、commit message、UI 文案都不要把「KGI 群益」並列。後端命名 `services/kgi-gateway` / `kgi-quote-client.ts` / `KGI_QUOTE_SYMBOL_WHITELIST` 全是凱基。
> 2. 前端**禁止**有任何 `POST /order/create`、`POST /portfolio/kill-mode`、`POST /run/start|stop` 的 client 程式碼，連 commented-out 都不行（grep 會掃）。
> 3. KGI gateway **不對外**：前端只能透過 `apps/api` 的 BFF route 取得 `/quote/*`、`/position`、`/trades`、`/deals`。Tailscale 由 operator host 私網開到 EC2，公網看不到 KGI gateway。任何 fetch 直接打到 `http://<gateway-host>:8787` 的程式碼都會被退回。
> 4. `lightweight-charts` 鎖定 `^4.x`（不是 5.x）。
> 5. 4-state freshness（FRESH < 5s / STALE_LT_5S 5–30s / STALE_LT_30S 30s–5min / STALE > 5min）以 server 端為準，UI 直接讀 `freshness` 欄位顯示分級樣式，**不要** client side 重新計算。
>
> **三、Day 1 第一個 gate 還在原地**
>
> Day 1 step 1 — **schema placeholder（`packages/contracts` 那層）**：請您先送 schema 草稿（PascalCase 命名、檔頭註明 placeholder 用途、不要塞 business validation），我這邊 30 分鐘內過目給通過/退回。其餘 Day 1 step 2+ 與 Day 2–4 保持原計畫，無需等 Q&A。
>
> **四、SWR convention（補充上一輪我答錯的地方）**
>
> 上一輪我說「`apps/web` 已有 SWR 慣例」是錯的 — grep 結果是：`apps/web` 用 RSC + 直接 fetch，沒有 SWR 慣例。所以您 Day 1 在 isolated package（之前說好的隔離目錄）裡定義 SWR pattern 時，**直接訂規則**就好（命名 `useApi*` 即可），不必對齊不存在的舊 convention。我這邊責任是在 W6 之後幫您把 isolated package 跟 `apps/web` 整併時，做 codemod 收齊命名，不會把您的設計倒過來改。
>
> **五、無變動的部分**
>
> Q3 (a) `/quote/snapshot` vs `/companies/:symbol` 邊界不變；Q5 inline pulse、不要 N+1，不變；Q6 (c) 用 `NEXT_PUBLIC_USE_MOCK=1` 做 function-level swap，不變。Day 1–4 plan 整體 buy-in 持續有效。
>
> **六、若您 Day 1 schema 草稿已準備好**
>
> 直接寄/貼給我（中英都行），我 30 分鐘內回。Day 1 之後遇到任何 backend route 行為與我描述不一致，立刻停手反應；我會把 main HEAD 與 CI 證據截給您比對。
>
> 謝謝。
>
> — Elva（IUF Trading Room）

---

## 註記（不入信件，僅內部 audit）

- 信件**沒有**邀請設計師動 PR #14、KGI 寄信、`/portfolio/kill-mode`、`/run/*`、Athena cross-lane 任何一件事 — 這些都還在 HALTED / FROZEN。
- 信件**沒有**承諾 PR #12 何時 merge，只描述 merge 後行為差異 — 楊董 ACK 才 merge，此規則對外不揭露時程。
- 若設計師回問「PR #12 何時 merge？」，建議答覆：「等內部驗證 + 內部 ACK 流程，不會在 Day 1–4 期間影響您；merge 前 `/quote/*` 行為與 main HEAD 一致，merge 後您只要按上面三條碼的對應方式處理即可。」
- 信件用「凱基」三次、「KGI」也三次，沒有任何「KGI 群益」並列 — 通過 `feedback_kgi_vs_capital_naming.md` rule。

---

## 給楊董的 1-line 收尾

草稿 5 段已完成。要我直接把信件主體段（不含註記）貼給設計師嗎？還是您先看完再轉？另外若設計師有當前未貼上的新提問，請補貼我再修。
