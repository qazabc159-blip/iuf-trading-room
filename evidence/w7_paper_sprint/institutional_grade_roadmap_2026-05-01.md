# IUF Trading Room — 機構級交易室差距分析 + 68h 衝刺路線圖

**Date**: 2026-05-01 12:33 Taipei (W7 paper sprint Day 2, 勞動節休市)
**Drafter**: Elva
**Trigger**: 楊董質問 "距離機構級網站還差多少 / 一步步要完成哪些 / 能不能全力拚一下"
**Window**: 5/1 12:33 → 5/4 09:00 = ~68.5 小時 buffer (5/2-5/3 週末)
**Status**: ACTIVE — 立即衝刺，不放鬆 cadence

---

## 1. 機構級交易室定義（IUF 版）

不抄 Bloomberg/Capital IQ 模板。針對單操盤者 + AI 研究 pipeline 量身定義：

| 維度 | 機構級門檻 |
|---|---|
| **資料誠實度** | 0 placeholder 顯示成 score；所有 exposure/grade/decision 都有 source + freshness |
| **風控閘門** | 4 層 override + sourceLayer 標示 + 持久化 + audit log 全鏈 |
| **執行 paper E2E** | preview→submit→status→cancel→fill→event 端到端 live；idempotency 防雙開 |
| **Real-time 報價** | tick / orderbook / K 線 stream；staleness 顯示 |
| **Strategy → Order 自動化** | idea/run snapshot → plan-to-order builder → paper-execute (live=409) |
| **回放 / 歸因** | 每張 order 帶 quoteContext；session replay；P&L 三維歸因（strategy/theme/symbol） |
| **可用性** | DB backup / Railway 5 服務健康監控 / 重啟還原 |
| **AI 研究 pipeline** | OpenAlice 跑全 universe；自動產 brief/signal/exposure；human approval queue |
| **Quant Lab 銜接** | Lab strategy promote → TR execute；shared contract repo |

---

## 2. 已完成（Wave 0 → W7 Day 1）

✅ Wave 0–4：monorepo / contracts / research core / agent bridge / ops 全綠
✅ Phase 0–2：trading contracts + execution skeleton + 4-layer risk
✅ Strategy ideas v1.1 / runs v1.2-1.3 / market-data 三視圖 / decision-summary
✅ KGI gateway W1-W6：read-side live; W7 paper sprint Day 1 frontend cutover (Codex)
✅ Authentication / DNS / Railway / GHA pipeline 全綠
✅ 視覺：CRT phosphor + amber + HUD + ASCII 戰情室調性
✅ Pete + Mike subagent 加入 W6+ desk review / migration audit lane
✅ W6 paper sprint：OrderIntent + PaperExecutor + ledger reads + cancel + 0015 migration
✅ Codex frontend real-data ownership 2026-05-01：5 src commits 取代所有 mock，4-state hard rule

---

## 3. 距離機構級的 25 條 gap（按優先順序）

### **P0 — 5/4 開盤前必達**（~68h, 4 條）

| # | Gap | Owner | ETA |
|---|---|---|---|
| P0-1 | **Codex Contract 1 frontend wiring**（preview/submit/status/list/cancel + 4-state） | Codex | working tree 已動，預期 5/2 完成 |
| P0-2 | **Jason 0020 v2 dedup migration**（修正 ON DELETE CASCADE 假宣告 + 處理 5 個 child table） | Jason 上線後 | Jason ETA 未明 |
| P0-3 | **Mike + Pete + 楊董 ACK** PR #39 0020 v2 → merge → 解鎖 Contract 2 portfolio | Mike/Pete/楊董 | gated by P0-2 |
| P0-4 | **Operator browser spot-check 7 條**（5/3 22:00 前） | 楊董 | gated by P0-1+P0-2+P0-3 |

### **P1 — 5/9 paper E2E deadline 前必達**（11 條）

| # | Gap | Owner | 影響 |
|---|---|---|---|
| P1-1 | Contract 2 Portfolio API 接通（持倉 + 未實現損益 + 4 層 risk badge） | Jason backend / Codex frontend | 機構級首頁基本盤 |
| P1-2 | Contract 3 Watchlist 接通（自選股 + paper 快下單） | Jason / Codex | 操作體驗 |
| P1-3 | Contract 4 Strategy idea → order promote（paper auto-execute pipeline） | Jason / Codex | research→execution 閉環 |
| P1-4 | Contract 5 KGI bidask/tick WS subscribe（即時報價） | Operator + Jason | 機構級 real-time |
| ~~P1-5~~ | ~~Risk layer 持久化~~ **CORRECTION 2026-05-01 13:55**: 已完成。`apps/api/src/risk-store.ts:1-64` 已 file-backed via Railway Volume + atomic tmp→rename + `hydrateRiskEngine` boot 重灌 4 store（limits/killSwitch/strategyLimits/symbolLimits）。Memory 條目已更新。 | — | INVALID gap |
| **P1-5 (new)** | **Session layer 風控**（4 層的最後一層；當日緊急停損 + open-to-close 限額；schema design DONE → `evidence/w7_paper_sprint/session_layer_risk_schema_design_2026-05-01.md`，~1100 LOC / ~20h impl + Mike + Pete + Bruce） | Jason backend | 4 層風控真完整 |
| P1-7 | K 線圖 UI（用 KGI K-bar Phase 2 已接好的 backend） | Codex frontend | 操盤桌不可缺 |
| P1-8 | Paper E2E live demo：idea → 2330 1 張 → fill → cancel → timeline 完整 | All | 5/9 deadline 驗收項 |
| P1-9 | Idempotency / duplicate prevention live verify | Bruce | 防雙開 |
| P1-10 | Order detail 點 orderId 過濾該 order 全 timeline | Codex | UX 升級 |
| P1-11 | OpenAlice 跑首批 100 公司 exposure 重評（產出真評分） | Worker | 機構級資料 P0 |

### **P2 — 機構級 deepen（5/9 後 W8 起）**（10 條）

| # | Gap |
|---|---|
| P2-1 | OpenAlice 批次跑剩 1634 公司 exposure（5 維評分全填真） |
| P2-2 | CompanyGraph 補完（目前只有 2330 / 3081 有 graph） |
| P2-3 | Strategy auto-execute pipeline（plan-to-order builder → paper-only auto submit） |
| P2-4 | Daily snapshot / EOD report / P&L attribution（strategy/theme/symbol 三維） |
| P2-5 | Reporting 月報 / 季報（PDF export 或 dashboard） |
| P2-6 | Mobile read-only（首頁 + portfolio + ideas） |
| P2-7 | Real-time push channel（LINE / Discord webhook 推 signal/idea） |
| P2-8 | Session replay（當日 trading session 全 event 回放） |
| P2-9 | DR / DB backup（postgres dump + Railway snapshot daily） |
| P2-10 | Quant Lab ↔ TR full bridge（Athena promote bundle → TR execute） |

---

## 4. 68h 衝刺計畫（5/1 12:33 → 5/4 09:00）

### **Block 1 — 5/1 12:33 → 5/1 24:00（~12h，今天剩餘）**

並行 lane（互不撞）：

| Lane | Owner | Scope |
|---|---|---|
| A | Codex | Contract 1 wiring 主推進（apps/web，working tree 進行中） |
| B | Elva self | (1) 寫 P1-5 Risk layer 持久化 design doc; (2) 寫 P1-6 Session layer 風控 schema; (3) 寫 P1-11 OpenAlice exposure 批次任務設計 — 全 design only，不動 code |
| C | Bruce | apps/api lane regression sweep（不撞 Codex apps/web）— 視 Bash 是否恢復；否則 static-only |
| D | Mike + Pete | Jason 0020 v2 上線前的 standby checklist（template）— 等 Jason 提交 |

### **Block 2 — 5/2 全天（~16h，週六）**

預期 Codex Contract 1 wiring 完成 → DRAFT PR → Pete review → merge。
Jason 若上線：寫 0020 v2 → Mike audit → Pete review → 楊董 ACK gate → merge。
Elva 開 P1-5 Risk persist impl（如 Codex 無撞）+ P1-7 K 線 UI design hand-off。

### **Block 3 — 5/3 全天（~16h，週日）**

Codex Contract 2/3 frontend wiring（前提：Jason 0020 v2 已 merge）。
Bruce 4-state regression full sweep。
楊董 22:00 前完成 7 條 browser spot-check。
Elva 寫 5/4 開盤前 closeout doc + 開盤計畫。

### **Block 4 — 5/4 06:00 → 09:00（~3h，開盤前）**

Bruce final smoke / Elva merge-window / 開盤前 30min 收 cadence。
09:00 開盤後第一個動作：paper 試打 1 張 2330 buy → 驗端到端 → Day 4 報告。

---

## 5. Stop-lines（衝刺中不破）

1. 不撞 Codex apps/web lane（Codex 正在動 working tree）
2. 不直接 commit Codex 未 commit 的 working tree（除非 Codex idle 且 Elva 接手）
3. PR #39 0020 v2 未過 5 條解鎖前不 promote（Mike audit / Pete PASS / Jason v2 / 楊董 ACK / backup）
4. 不破 4-state hard rule（LIVE/EMPTY/BLOCKED/HIDDEN，no silent mock）
5. 不開 KGI live submit 路徑（paper gate 永久 409）
6. 不 toggle kill-switch / 不旋轉 secret / 不破壞性 git 操作
7. 非交易日不誤 frame 緊迫性（5/4 09:00 才是真 deadline）
8. 衝刺 ≠ 跳過 desk review；Mike + Pete + Bruce 三層仍跑

---

## 6. Cadence

- 60min push (休市日；交易日恢復 30min)
- 每 push 必含：(a) 新 evidence 或 commit (b) 或明確 BLOCKED 標 reason
- 沒結果就標 BLOCKED + 換 lane，不沉默
- 每 4h 寫一次 board snapshot（Block 1 結尾、Block 2 中段、Block 2 結尾、Block 3 中段、Block 3 結尾）

---

## 7. 開工項（立即派）

1. **Elva self** → 寫 P1-5 Risk persist design doc（apps/api lane）
2. **Mike** → standby template for 0020 v2 audit（無 Jason 提交，先寫 expected diff checklist）
3. **Pete** → standby template for 0020 v2 review（同上）
4. **Bruce** → 4-state regression on apps/api routes（避開 apps/web）
5. **Codex** → 自主推進 Contract 1（已在動）

Elva 將每 60min 寫 board snapshot，下次 cadence: 13:33 Taipei。
