# JIM M3 Scorecard — 決策頁補成績單摘要 + skip 原因顯示

**Branch**: `feat/brain-decisions-scorecard-20260625`
**Date**: 2026-06-25
**Base**: `df155a57` (M4 main，已含 decisionPerformance backend)
**File changed**: `apps/web/app/admin/brain/decisions/page.tsx` (1 file)

---

## 交付項目

### Task 1 — 主腦深析成績單卡

新增 `ScorecardPanel` component + `Panel code="ADM-BRAIN-DEC-SC"` 區塊：
- 讀取 `state.decisionPerformance`（`GET /api/v1/openalice/orchestrator/state` 回傳的新欄位）
- 顯示：深析總筆數（eligible）/ +1d 驗證數 / +5d 驗證數
- 顯示：+1日命中率 / +5日命中率 / +1日平均超額 / +5日平均超額 — 全部 vs 0050
- 誠實樣本標：驗證數 < 5 筆時顯「資料累積中（需 N 筆，現有 M）」取代數值
- hit_rate/avg_excess = null 且樣本已足時也顯「資料累積中」
- 超額正負自動著色（綠/紅），命中率條件著色
- 底部免責聲明：「成績單僅呈現歷史觀察數據，不代表未來表現，不構成投資建議。」
- **禁字全守**：無「保證獲利」「可跟單」「穩賺」等字眼

### Task 2 — skip 原因繁中化

新增 `SKIP_REASON_LABEL` 對照表 + `labelSkipReason()` helper：
| Enum 值 | 繁中顯示 |
|---|---|
| `deep_analyze_daily_cap_reached` | 今日深析額度已滿 |
| `budget_insufficient` | AI 預算不足 |
| `already_analyzed_today` | 今日已深析過 |
| `no_tickers_in_payload` | 無明確標的 |
| `no_tickers_in_payload_or_trigger_ref` | 無明確標的 |
| `no_real_report_produced` | 報告未生成 |
| `confidence_below_threshold` | 信心不足 |
| `db_unavailable` | 資料庫暫不可用 |
| `event_insert_failed` | 告警寫入失敗 |
| 未知值 | 原始 enum 值（fallback，不 crash） |

`OutcomeBlock` 收到 `status="skipped"` 時優先進入 skip 原因分支，顯示「略過原因」標題 + 繁中原因，不進入其他 outcome 分支。

### Task 3 — done deep_analyze verification 顯示

新增 `VerificationBlock` component：
- 觸發條件：`actionType === "deep_analyze"` + `outcome.analyses` 存在 + `outcome.verification` 存在
- 顯示 6 格：+1日漲跌 / +1日超額 vs 0050 / +1日結果 / +5日漲跌 / +5日超額 / +5日結果
- null 值（未滿期）一律顯「驗證中」（不顯 "null"、不顯 raw 值）
- 有任何 null 時底部顯：「驗證中 — 等待收盤價資料回填（每日 15:05 TST 更新）」

---

## Validation

| 項目 | 結果 |
|---|---|
| typecheck `pnpm typecheck` | 15/15 green, 0 errors |
| vitest `pnpm --filter web test` | 369/369 PASS |
| 真瀏覽器 owner login `/admin/brain/decisions` | 待部署後驗（prod deploy on branch push） |

---

## 真瀏覽器驗預期行為（深夜）

- 成績單卡顯示：eligible=N（已有深析紀錄）/ verified_1d=M / verified_5d=K
- 若 verified 數 < 5：所有命中率/超額格均顯「資料累積中」— 非空白
- skip 決策：OutcomeBlock 顯「略過原因」+ 繁中文字（e.g. 今日深析額度已滿）
- done deep_analyze + 未到 1 交易日：verification 格顯「驗證中」 + pending banner

---

## 下一步建議

1. **Bruce 驗收**：`/admin/brain/decisions` 成績單卡 render 正確（eligible/verified 數字 + 累積中標示）+ skip 卡顯繁中原因
2. **未來 enhancement（選做）**：成績單加 trend 折線（eligible 累積趨勢），需另開 PR
