# AGENTS.md — IUF Trading Room（給 Codex 與所有 AI 工程代理，2026-07-03 立）

（本檔與 CLAUDE.md 同源同內容 — 改其中一份必同步另一份。Codex 專屬補充：①你的 lane=apps/web 前端真資料接線為主 ②交付=DRAFT PR，不自行 merge ③你看不到 owner 的 memory 系統，所以本檔就是你的完整 context 入口，設計文件索引在檔尾。）

台股 AI 交易戰情室。北極星：把散落的操盤工作流變成可追蹤、可執行、可檢討的投資作業系統 — **不是財經資訊網站**。產品地圖見 `reports/PRODUCT_MAP_2026_07.md`。優先序：**你（Codex 等外部代理）看不到 owner 的 memory 系統 — 優先序一律由派工訊息給你；沒給就只做被指派的事＋守本檔鐵律，範圍疑慮在 PR 描述標明交 coordinator 裁。**（本檔與 CLAUDE.md 除開頭代理註記外同內容，改一份必同步另一份。）

## 指令（pnpm monorepo，Node + Turbo）
- `pnpm run build:packages` — 改 packages/* 後先跑
- `pnpm typecheck` — 全 workspace
- `pnpm test` — 全部；單一 app：`pnpm --filter @iuf-trading-room/web test`
- Playwright（web）：CI 的自建 runner 跑 P0 smoke；本機跑不動時明說，不准假稱跑過
- DB migration：`packages/db/migrations/*.sql` 新增後跑 `scripts/migrate.ts`；**任何 migration 必經審計**（forward+down 對、DESC index 與 DDL 一致 — 歷史上 0046/0048/0049 三次栽在 schema.ts 漏 `.desc()`）

## CI 與交付規則
- 每個 PR 必過四關：**validate / W6 No-Real-Order Audit / Secret Regression / Playwright P0 Smoke** — 全綠才可 merge，禁 `continue-on-error` 假綠（#1073 拆過一次）
- merge 到 main = **自動 deploy**（GHA push:main → Railway，#1067 起）；deploy 後必打 prod 驗到新行為才准說「已上線」，否則用 `PARTIAL` / `BLOCKED_<原因>` 措辭
- PR 一律 DRAFT 起手，驗收由 coordinator 把關 merge；branch 命名 `feat|fix/<主題>-<作者>-<YYYYMMDD>`
- worktree 交付前必跑完整 CI 含 Playwright；前端 iframe 改動必用 frameLocator 真瀏覽器驗＋截圖

## 🔴 不能碰的區域（動之前停下來）
- **真金下單路徑**：`apps/api/src/broker/trading-service.ts`、`kgi-sim-env.ts`、`domain/trading/execution-mode.ts`、`services/kgi-gateway/app.py`、`read_only_guard.py`、`scripts/audit/w6_no_real_order_audit.py`、`.github/workflows/ci-security.yml` — 這些檔有 harness 層 hook 硬擋（owner 才能暫解）。真單解鎖規劃見 `reports/phase4_safety_gate/PHASE4_SAFETY_GATE_SPEC_v1.md`，任何階段跳序=停下問 owner
- W6 audit 的檢查邏輯：改它=需 owner 明示同意
- prod 資料刪除／`DROP`／`TRUNCATE`：dry-run 先行，apply 要 owner ACK
- 策略邏輯（S1 參數、prereg、回測判讀）＝Lab lane（owner×Athena 直連），本 repo 的工程 session 不碰

## 常見陷阱（全部真實踩過）
- postgres-js 的 `db.execute()` 回**陣列**沒有 `.rows` — 新查詢用 `execRows()` normalizer（歷史上三處整個讀取端從沒活過）
- `quantity_unit`（SHARE|LOT）**必填無 default** — 張/股差 1000 倍；統一下單流定版見 `reports/epic_trading_desk_20260702/S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md` D4
- 時間：本機 `TZ='Asia/Taipei' date` 不生效回 UTC — 跑 `date -u` 手動 +8；判斷盤中前先查台股交易日曆
- KGI env var 必大寫；KGI=凱基，跟群益（Capital）不准並列混稱
- deploy 重啟會洗掉 in-memory quote store — 報價兜底靠 `quote_last_close` DB 表，別再加 in-memory fallback
- PowerShell 5.1：`&&`/`||` 不可用、原生 exe 別 `2>&1`、檔案輸出要 `-Encoding utf8`
- 中文路徑在部分 shell 呼叫會編碼壞 — 先 cd 進目錄再操作
- 本 repo 主 checkout 可能停在舊 branch — **查現況一律 `git fetch` 後 grep `origin/main`**，不信工作區

## 產品鐵律（違反=退件）
- 不 fake 數字（Sharpe/勝率/報酬）；缺資料顯 EMPTY/STALE 真原因，不假綠
- 帳/持倉顯示必勾稽得回本金；缺價部位明標不當 0；報酬分母用真實動用資金
- UI 禁工程語意（model 名/enum/debug 字串）；禁字：approved／alpha confirmed／live-ready／可以跟單／保證獲利
- 視覺識別：CRT phosphor/amber＋HUD 高密度＋ticker tape

## 設計文件索引（動大件前先讀對應篇）
| 要動 | 先讀 |
|---|---|
| 下單/交易台 | `reports/epic_trading_desk_20260702/`（epic＋S1_UNIFIED_ORDER_FLOW_DESIGN） |
| 真金/券商 adapter | `reports/phase4_safety_gate/`＋`reports/fubon_adapter/` |
| 權限/角色/邀請 | `reports/permission_matrix/PERMISSION_MATRIX_v1.md` |
| 帳本/NAV | `reports/epic_fauto_ledger_20260701/` |
