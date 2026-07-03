# 權限矩陣設計 v1 — Owner/Admin/Analyst/Trader/Viewer（Fable 5 定版 2026-07-03）

**地位**：開放 Trader/Viewer 邀請（roadmap P1-1）與 Phase III 多用戶的前置。實作者照 §4 分組遷移，每組一 PR。
**證據**：Explore 實掃 origin/main（2026-07-03）。

## §1 現況診斷
- Role enum：`Owner/Admin/Analyst/Trader/Viewer`（`packages/db/src/schema.ts:89-96`，default Viewer）；session middleware `server.ts:369-440` 掛 role。
- **無中央權限層**：`role !== "Owner"` inline 檢查 109 處；`READ_DRAFT_ROLES`（Owner/Admin/Analyst，`server.ts:3978`）被複製 51 處 — **含純行情端點**（breadth/leaders 等），這是 Viewer/Trader 403 大半站的根因：工程慣性把它當「方便的預設」貼，非按需判斷。
- 全站 ~367 端點：~44% 有 role 檢查、~56% 登入即用。前端只分 Owner vs 非 Owner。
- 邀請系統 role CHECK 排除 Owner ✅；舊 `registerWithInvite`（寫死 Viewer）是死代碼，PR-C 一併刪。
- `packages/auth` 的 `canEditResearch/canEditExecution` 零呼叫端=死代碼。

## §2 設計裁決

**D1 嚴格階梯模型**：`Viewer < Trader < Analyst < Admin < Owner`，高階完全涵蓋低階能力。不做交叉矩陣（Trader 有單權無研究權那種）— 階梯是弱模型與用戶都不會搞錯的心智模型；未來真需要交叉再開例外表。
**D2 中央 helper**：新增 `requireMinRole(session, minRole)`（rank 比較）＋每端點群一個常數。**禁止再寫 inline `role !==`**（lint/測試擋新增；存量逐組遷移不一次大改）。
**D3 端點分組與最低角色**（矩陣本體）：

| 群 | 內容 | 最低角色 | 現況→改動 |
|---|---|---|---|
| G-PUB 產品讀取 | 行情/報價/熱力圖/breadth/leaders/公司/主題/簡報/新聞/訊號/週復盤 | **Viewer** | 51 處 READ_DRAFT_ROLES 中屬行情/產品讀取者全部降為登入即可 |
| G-PORT 模擬交易 | paper 下單/持倉/委託/交易計畫（讀=Viewer 可，寫=Trader 起） | 讀 **Viewer**／寫 **Trader** | 現多為登入即用，補 Trader 寫閘 |
| G-RESEARCH 研究內容 | content-drafts 讀/lab snapshot/strategy 內部數據 | **Analyst** | READ_DRAFT_ROLES 原始本意，保留在這群 |
| G-REVIEW 內容審核 | drafts approve/reject | **Admin** | REVIEW_ROLES 現狀維持 |
| G-ADMIN 工作區管理 | 邀請/用戶/改角色/停用（**PM-O3 裁決後：themes 治理與 brain 監控移出本群、歸 G-OWNER**） | **Admin** | 改角色/停用不可動 Owner 帳號 |
| G-OWNER 營運核心 | KGI SIM ops/F-AUTO/UTA 帳號管理/kill/cron 手動觸發/admin 危險端點/**全部真金** | **Owner** | 現狀維持；真金永遠 Owner（Phase III 不變） |
| G-SELF 個人資源 | 自己的 gateway 配對/券商連線/訂閱設定 | **Trader**＋**資源歸屬檢查**（只能動自己的） | Phase III 前補 ownership check，防跨用戶 |

**D4 前端對齊**：#1158 canonical registry 加 `minRole` 欄位，Sidebar/CommandPalette 按 role 過濾（現只分 Owner）；`admin-owner-gate.tsx` 泛化為 `RoleGate minRole=...`。
**D5 開放條件（v1.1 收緊）**：G-PUB＋G-PORT 矩陣測試綠 **且 PR-B2 login-only 掃雷完成** → 才准發 Trader/Viewer 邀請。理由：現況 Trader/Viewer 的實際能力=「登入即可」那 56%，裡面混著研究端點與零檢查的送單端點，先開邀請=直接洩。

### PR-B 分類程序（不准用端點名關鍵字分類 — read-back 實證會誤放）
每處 READ_DRAFT_ROLES 降級前三步：①讀 handler 實際回什麼資料 ②問「這資料含內部治理/審計/策略內部/執行旗標嗎」— 含=不降 ③不確定=不降（fail-closed）。
**預分類豁免清單（read-back 實查抓出，維持 Analyst+ 或加欄位遮罩）**：`GET /briefs/:id`（`server.ts:11437`，重建 content_drafts auditChain 含 hallucination-check — 楊董 2026-04-25 曾裁「需欄位級遮罩才能給 Viewer」）；`GET /dashboard/snapshot`（`server.ts:13019`，聚合 audit_stats＋lab_strategies，整端點降=連坐外洩）；`GET /paper/e2e`（`server.ts:12817`，曝 kill-switch/執行旗標）。

## §3 矩陣測試（本設計的驗收核心）
新增 `role-matrix.test.ts`：5 role × 每群 2-3 個代表端點，斷言期望 status（200/403）。**每組遷移 PR 必附該群的矩陣測試**；矩陣測試一旦綠、後續任何 PR 弄破=CI 紅。dev `AUTH_ALLOW_ROLE_OVERRIDE` 機制（`server.ts:416-426`）正好用來測。

## §4 實作切片
| PR | 內容 | 驗收 |
|---|---|---|
| PR-A | `requireMinRole` helper＋rank 表＋矩陣測試骨架＋lint 擋新 inline 檢查 | helper 單測；既有行為零變（純新增） |
| PR-B | G-PUB 解封：51 處逐一分類降級（**程序見下**） | ①Viewer 實測主站資料全出（under-grant 方向）②**矩陣測試同時斷言 Viewer 對 G-RESEARCH/G-OWNER 代表端點 403**（over-grant 方向，缺這半驗收=單邊）③豁免清單三端點維持 Analyst+ |
| PR-B2 | **login-only 大池掃雷**（read-back 抓到的洞）：~205 個「登入即可」端點按 D3 歸群補閘 — 已知必修：`POST /strategy/ideas/:id/promote-to-paper-submit`（`server.ts:2328`，真送紙上單卻零檢查→Trader）、`GET /lab/bundles` intake+list（`server.ts:14476/14517`，研究內容→Analyst） | 掃雷清單落檔＋補閘測試；**此 PR 完成前不准發任何 Viewer/Trader 邀請** |
| PR-C | G-PORT 寫閘（Trader 起）＋死代碼清理（舊 registerWithInvite、packages/auth 死 export） | Viewer 下 paper 單 403、Trader 200；矩陣 G-PORT 綠 |
| PR-D | G-ADMIN/G-SELF 整理＋ownership check | 矩陣全列綠；Admin 不能動 Owner 帳號（測試） |
| PR-E | D4 前端 minRole＋RoleGate 泛化 | 各 role 登入截圖；Playwright 加 Viewer 視角 smoke |
順序：A→B→B2→C 連發；D、E 隨後。**發邀請條件（與 D5 一致）：Viewer=B＋B2 完成；Trader=再加 C 完成。**

## §5 Open Questions（=== 需楊董 ACK，附預設 ===）
- **PM-O1** ✅ 已裁決（楊董 2026-07-03）：**可** — Viewer 唯讀看交易室與持倉。
- **PM-O2** ✅ 已裁決（楊董 2026-07-03）：**可** — 照階梯模型。
- **PM-O3** ✅ **已裁決（楊董 2026-07-03）：維持 Owner** — brain/themes 治理不降 Admin。G-ADMIN 群範圍相應修正：僅「邀請/用戶管理」為 Admin 級，brain 監控與 themes 治理歸 G-OWNER。PR-D 範圍縮小。

---
## 版本紀錄
- v1 2026-07-03 Fable 5 定版（Explore 實掃：367 端點/109 inline/51 處 READ_DRAFT_ROLES 為據）。
- v1.1 同日：fresh read-back（實查 origin/main 逐端點對抗）修 4 — ①PR-B 禁關鍵字分類、立三步程序＋3 端點豁免清單（briefs/:id auditChain／dashboard/snapshot 連坐／paper/e2e 旗標）②新增 PR-B2 login-only 掃雷（promote-to-paper-submit 零檢查送單、lab/bundles 研究外洩）③驗收補 over-grant 方向 ④D5 開放條件收緊（含 PR-B2）。
