---
name: W3 Lane Dispatch Table
description: W3 Read-Only Expansion Sprint 5-lane 派工細節（B1/B2/C/D/E）— scope / allowed files / prohibited / deliverable / DoD
type: dispatch_table
date: 2026-04-27
runner: Elva
gate: 楊董 W3 GO
---

# W3 Lane Dispatch Table

## Lane B1 — Jason Quote Hardening DRAFT PR

**Owner**：Jason (backend-strategy-jason)
**Branch**：`feat/w3-quote-hardening`（建議命名）
**Task ID**：#143

### Scope (allowed)
- H-6 structured logging
  - 只記：`route`, `symbol`, `status`, `latency_ms`, `freshness` (fresh/stale/no_data), `error_code`
  - **不准記**：`account`, `person_id`, `token`, KGI secret, raw payload (除非 redacted)
- H-9 ring buffer eviction warning
  - buffer 滿時 emit warning（log + counter）
  - **不影響** quote / order path 行為
- Quote status observability
  - 加 `/quote/status` endpoint 或 metric counter（read-only）
  - **不**新增 order method
  - **不** import order path

### Files (allowed touch)
- `apps/api/src/server.ts`（quote routes 段，加 logging middleware / observability）
- `apps/api/src/lib/kgi-quote-client.ts`（已存在，加 hardening 不改 contract）
- `apps/api/src/lib/logger.ts`（**新檔** — structured logger + redaction）
- `apps/api/src/lib/ring-buffer.ts`（**新檔 if needed** — eviction warning helper）
- `apps/api/src/__tests__/quote-hardening.test.ts`（**新檔** — H-6 + H-9 unit tests，含 redaction unit test）
- `services/kgi-gateway/app.py`（read-only logging hardening if needed）
- `services/kgi-gateway/tests/test_logging_redaction.py`（**新檔 if Python side touched**）

### Files (prohibited touch)
- ❌ `apps/api/src/lib/kgi-broker.ts` (不存在；不要建)
- ❌ `apps/api/src/routes/order/*`（任何 order route）
- ❌ contracts (`contracts/openapi.yaml` / `contracts/agent-bridge.yaml`)
- ❌ `services/kgi-gateway/kgi_order.py` (read-only sprint 不碰 order)
- ❌ env / secret / `.env` / Railway config

### Deliverable
1. DRAFT PR opened to GitHub repo（branch `feat/w3-quote-hardening`），標題含 "W3 quote hardening (H-6 + H-9)"
2. Implementation note：`evidence/path_b_w3_read_only_2026-04-27/jason_w3_quote_hardening_impl_note.md`
3. Test result：`pnpm test` + `python -m pytest services/kgi-gateway/tests/`，PASS counts
4. Redaction unit test 證明：log 不含 raw account/person_id/token
5. No-order guarantee proof：grep `apps/api/src/server.ts` for `/order/create` 仍 409

### DoD
- ✅ DRAFT PR opened
- ✅ TS suite 全綠（包含新增 hardening tests）
- ✅ Python suite 全綠
- ✅ typecheck EXIT 0
- ✅ build EXIT 0
- ✅ 0 production push / 0 deploy / 0 merge
- ✅ 0 raw secret in logs（redaction unit test PASS）

---

## Lane B2 — Jason K-bar Phase 2 Backend DRAFT PR

**Owner**：Jason (backend-strategy-jason)
**Branch**：`feat/w3-kbar-phase2`
**Task ID**：#144

### Scope (allowed)
- 新增 route：`GET /api/v1/kgi/quote/kbar/recover?symbol=&from=&to=&interval=`
- 對應 SDK call：`TWStockQuote.recover_kbar(symbol, from, to)`
- Subscribe skeleton（read-only only）
  - `POST /api/v1/kgi/quote/subscribe/kbar`（subscribe）
  - WS push `{ type:"kbar", data: KBar }`
  - 對應 SDK：`subscribe_kbar(symbol) + set_cb_kbar(callback)`
- Interval 第一版最小安全集合：`1m`, `5m`, `15m`, `1d`
  - SDK 不支援的 interval：**記入 unsupported matrix，不准硬轉**
- KBar shape：`{ time: number, open, high, low, close, volume }`（per Jim sandbox / mock-kbar 對齊）
- Mock fallback / empty-safe response（endpoint 失敗時返回 `{ data: [] }` 或 422，非 500）
- No-order guarantee tests

### Files (allowed touch)
- `apps/api/src/server.ts`（K-bar routes 段）
- `apps/api/src/lib/kgi-quote-client.ts`（加 K-bar method）
- `apps/api/src/__tests__/kbar.test.ts`（**新檔**）
- `services/kgi-gateway/app.py`（K-bar endpoint）
- `services/kgi-gateway/kgi_kbar.py`（**新檔** — recover_kbar + subscribe_kbar wrapper）
- `services/kgi-gateway/tests/test_kbar.py`（**新檔**）

### Files (prohibited touch)
- ❌ order routes / kgi-broker.ts
- ❌ contracts mutation（K-bar shape 在 PR description 列出，但不正式進 contracts；contracts 留到 production-promotion）
- ❌ deploy / Railway config

### Deliverable
1. DRAFT PR opened（branch `feat/w3-kbar-phase2`）
2. Implementation note：`evidence/path_b_w3_read_only_2026-04-27/jason_w3_kbar_phase2_impl_note.md`
3. Interval matrix：`evidence/path_b_w3_read_only_2026-04-27/jason_w3_kbar_interval_matrix.md`（SDK 支援哪些 interval / 哪些 unsupported / 無 hard-transcode）
4. Test result（unit + integration mock）
5. No-order guarantee proof（含 K-bar route 沒 import order, K-bar callback 不會觸 order）

### DoD
- ✅ DRAFT PR opened
- ✅ TS + Python suite 全綠
- ✅ typecheck EXIT 0 / build EXIT 0
- ✅ Interval matrix 完整（每個 interval：SDK supported / unsupported / unsupported reason）
- ✅ Mock fallback default-on
- ✅ No-order guarantee proof

---

## Lane C — Jim v0.7.0 Sandbox（real-data 接通 + **美化重構** + 個股頁主視覺 + 時區切換）

**Owner**：Jim (frontend-consume-jim)
**Sandbox dir**：`evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/`
**Task ID**：#145
**Spec source**：`memory/plans/jim_v0_7_0_spec.md`（楊董 verbatim 2026-04-27 早 lock）

### Scope (allowed) — 整合 v0.7.0 spec 全項，不只是接通

#### 子組 C-α：W2d 接通 polish + 護欄（既有元件 enhance）
1. K-line UI 接 K-bar adapter skeleton（`fetchKBars` + 後續 wireUpKBarStream 接 Lane B2 endpoint）
2. Quote panel fresh / stale / no_data state polish（visual + transitions）
3. BidAsk 5 檔 display polish
4. Tick tape display polish
5. Position containment badge wording 鎖死「持倉資料目前不可用（containment 模式）」「請至 KGI 平台查詢」
6. Order locked banner wording 鎖死「[LOCKED] 下單功能未啟用 · Read-only 模式」
7. Mock/live source indicator（hover tooltip 解釋差異）
8. Endpoint unavailable graceful fallback

#### 子組 C-β：v0.7.0 spec §1.4 — 互動動畫 / 不要 AI 感（**核心**）
對齊 `memory/feedback_visual_identity.md` CRT phosphor / amber / HUD brackets / ASCII headers / ticker tape 風格：
9. K-line 切週期 tab：mono underline 2px gold（沿用 v0.6.1 SegControl 風格）
10. Crosshair：amber 0.5px hairline；tooltip 用 ASCII bracket + serif italic 數字
11. Bar 進場：no fancy fade — 直接 paint，沿用 phosphor 「即時感」
12. Volume bar：red/green 但飽和度低（接近真 phosphor terminal）
13. Hover：100ms ease-out（沿用 v0.6.0 `--anim-fast` token）
14. **禁止**：大圓角 / soft shadow / 漸層 background / 卡通 icon / "AI 推薦" 字眼

#### 子組 C-γ：v0.7.0 spec §1.5 — 個股頁主視覺重構（**核心**）
`/companies/[symbol]` 點進去後的 layout：
15. Header：symbol + 名稱 + last price + change（既有保留）
16. **NEW：K-line widget 主視覺**（佔 60% screen width 桌面 / 100% 手機）
17. 旁邊（桌面 40%）：BidAsk 5 檔 ladder + recent ticks scrolling tape
18. 下方：既有 themes / coverage / events 區塊往下推

#### 子組 C-δ：v0.7.0 spec §1.1 — 時區切換 / 多週期
19. 切時區/週期：1m / 5m / 15m / 30m / 1h / 4h / D / W / M（**至少 1m + 5m + 1h + D 四檔**）
20. crosshair / hover tooltip（OHLC + volume）
21. 縮放 / pan / 回看歷史
22. 即時更新（real-time，不是 daily snapshot；wire 到 W2d 既有 tick stream + Lane B2 K-bar subscribe）

### Library 候選（spec §1.2 已預設）
**Elva 預設推 lightweight-charts (TradingView, Apache-2.0, ~50KB)** — performance + real-time + 視覺可控 + 不被外站綁架。Jim 若認為其他 candidate 更適合，必須在 closeout 列 trade-off。

### Files (allowed touch — sandbox only)
- `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/**/*`（任何 sandbox 檔）
- `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/CHANGELOG.md`
- `evidence/design_handoff_2026-04-26/v0.7.0_work/v0.7.0_package/jim_w3_sandbox_closeout_2026-04-27.md`（**新檔**）
- `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/package.json`（若加 lightweight-charts）

### Files (prohibited touch)
- ❌ `apps/web/src/**/*`（production frontend）— 除非另開 DRAFT PR
- ❌ `apps/api/src/**/*`、`contracts/**/*`、auth / session / cookie
- ❌ 新增 order button / `/order/*` link
- ❌ paper-ready / live-ready / production-ready label

### Pickup note
**前一個 Jim agent 已被 stop（partial work 在 disk 上，sandbox v0.7.0_work 內）**。新一輪 Jim agent 須：
- 先讀 `evidence/design_handoff_2026-04-26/v0.7.0_work/v0.7.0_package/jim_phase2_closeout_2026-04-27.md`（W2d post-merge 已交付）
- 先讀現有 `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/chart/*.tsx`（W2d 既存）+ partial W3 work
- pick up + extend，不要重做

### Files (allowed touch — sandbox only)
- `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/**/*`（任何 sandbox 檔）
- `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/CHANGELOG.md`
- `evidence/design_handoff_2026-04-26/v0.7.0_work/v0.7.0_package/jim_w3_sandbox_closeout_2026-04-27.md`（**新檔**）

### Files (prohibited touch)
- ❌ `apps/web/src/**/*`（production frontend）— 除非另開 DRAFT PR 並標 sandbox-to-production proposal
- ❌ `apps/api/src/**/*`（backend）
- ❌ `contracts/**/*`
- ❌ auth / session / cookie 相關
- ❌ 新增 order button / `/order/*` link

### Deliverable
1. Sandbox closeout doc：`evidence/design_handoff_2026-04-26/v0.7.0_work/v0.7.0_package/jim_w3_sandbox_closeout_2026-04-27.md`
2. Screenshots（fresh / stale / no_data 三態 + position containment + order locked）
3. Touched scope list
4. Typecheck + build EXIT 0
5. Sandbox-only proof（grep verified — 0 production touch / 0 broker / 0 paper-ready label / 0 /order/* link）
6. Production promotion risk list（哪些 sandbox 行為要在 promotion 時注意）

### DoD
- ✅ Sandbox closeout doc 完整
- ✅ typecheck + build EXIT 0
- ✅ 0 production `apps/web/` touch
- ✅ Screenshots 上交
- ✅ promotion risk list 上交
- ✅ 0 stop-line（特別是 Jim sandbox 不准無 DRAFT PR 觸 production）

---

## Lane D — Bruce W3 Verify Harness

**Owner**：Bruce (verifier-release-bruce)
**Task ID**：#146

### Scope (allowed — 7 必準備)
1. **No-order guarantee test matrix**：W3 整 sprint 適用；對 B1 + B2 + C 都要套
2. **K-bar API verify checklist**：B2 接通後可跑（unit + integration mock；live 部分仍 deferred）
3. **Quote hardening verify checklist**：B1 接通後可跑（含 redaction unit test）
4. **Frontend sandbox verify checklist**：對 Jim sandbox v0.7.0 W3 increment
5. **Redaction v1 audit**：grep raw account / person_id / token / KGI secret 在 logs / evidence / docs / new code
6. **Wording audit**：not paper-ready / not live-ready / not broker execution / not production trading ready；用 grep + manual sweep
7. **Deferred live HTTP checklist remains deferred**：T6/T7/T8/T12 仍標 `POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK`，**不准跑** unless 楊董 operator window ACK

### Allowed actions
- 跑 static check（grep / lint / typecheck / build / unit test / integration mock test）
- 寫 verify spec / checklist / harness
- 寫 redaction audit report
- 寫 wording audit report

### Prohibited actions
- ❌ 要求 gateway restart
- ❌ 要求 KGI relogin
- ❌ 跑 live HTTP（T6/T7/T8/T12）
- ❌ deploy
- ❌ merge

### Deliverable
- `evidence/path_b_w3_read_only_2026-04-27/bruce_w3_verify_harness/`（dir）
  - `no_order_guarantee_matrix.md`
  - `kbar_verify_checklist.md`
  - `quote_hardening_verify_checklist.md`
  - `frontend_sandbox_verify_checklist.md`
  - `redaction_v1_audit.md`
  - `wording_audit.md`
  - `deferred_live_http_frozen.md`（標明仍 deferred）

### DoD
- ✅ 7 verify docs 全部完成
- ✅ Redaction audit 全綠（0 raw secret in new code/evidence/logs）
- ✅ Wording audit 全綠（0 paper-ready / live-ready / production-ready 違規）
- ✅ Deferred live HTTP 仍標 deferred
- ✅ 0 stop-line 觸發

---

## Lane E — Athena HOLD Governance (Optional)

**Owner**：Athena (lab-lead-athena)
**Task ID**：#147

### Scope (allowed)
1. R-2 final memo status consolidation
2. Q1-Q4 future-only governance notes
3. exp003 remediation roadmap
4. paper-ready prerequisites mapping

### Prohibited
- ❌ paper activation
- ❌ live activation
- ❌ TR activation request
- ❌ contracts mutation
- ❌ exp003 寫成 approved strategy

### Deliverable (optional)
- 任一上面 4 項的 governance memo（in Lab repo / shared contracts repo bridge）
- 可選擇 HOLD（無需主動產出）

### DoD
- 不阻塞 W3 Sprint 收板
- 任何產出走 bridge docs，不直接動 TR repo

---

## Cross-Lane Coordination

| 依賴 | Detail |
|---|---|
| Lane C ← Lane B2 K-bar shape | Jim sandbox 用的 KBar `{ time, open, high, low, close, volume }` 須與 Jason B2 implement 對齊。本檔已 lock；Jason 改 shape 須先通知 Lane A. |
| Lane D 並行 B/C | Bruce verify spec 可先寫；implementation-dependent 的 actual run 等 B/C DRAFT PR 出 |
| Lane A 收板 ← B/C/D 全完成 | Athena (E) 不阻塞 |

---

## Background Agent Dispatch

Lane A 派工後，Lane B/C/D 走 background agent（per `general-purpose` agent + sub-agent role tag），autonomous block 模式。

— Elva, 2026-04-27 W3 kickoff
