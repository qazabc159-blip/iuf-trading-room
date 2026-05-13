# Wave 5 Option A — Wave 4 最後 10% 收尾 detail spec

**Author**: Elva
**Date**: 2026-05-13
**Status**: Draft — 等楊董明早 ack 後執行

---

## Goal

把 Wave 4 後端 95% 帶到 **真實 100% 用戶可 demo** — 不開新戰場。

Codex 評估給的 4 軸真實成熟度（修正後）：
- 軸 1 量化策略：45 → 目標 70
- 軸 2 KGI 即時報價 wire：80 → 目標 95
- 軸 3 Portfolio paper-broker：65 → 目標 85
- 軸 4 OpenAlice 真主腦：60 → 目標 80

---

## Day 1 (2026-05-14, 明天 09:00 → 18:00 TST)

### Slot 1 (09:00-13:30) — 盤中 KGI tick 真實流動驗收

**Bruce 自動跑 7-phase live verify**（`ELVA_TOMORROW_LIVE_VERIFY_CHECKLIST_2026-05-14.md`）:
- EC2 自動 08:20 開機 → 09:00 開盤 kgi_logged_in=true
- TAIEX KGI tick 真實流入 `/market/overview/kgi`
- 熱力圖 kgi-core ~24 tiles 真實
- /ideas missing_bars 50 → 0 自然解
- 429 QUOTA_EXCEEDED live trigger
- watchlist/sync + holdings/sync 真實效果
- 前端 Codex `final-v031-live.ts` 三頁顯示真實資料（若 PR 已 merge）

**Owner**: Bruce (auto), Jim (補 caveat if any)

### Slot 2 (13:30-14:30) — Day-6 cont_liq forward observation

**Athena 跑 Day-6 yaml** (`scripts/write_cont_liq_period1_daily_yaml.py --today 2026-05-14`):
- Andy 修好 `trading_day_number()` Day 1-20 calendar
- FinMind token refreshed → 不會 token_illegal
- Day-6 結果 surface（仍 forward observation Day 6/20，no premature PASS/FAIL）

**Owner**: Athena, Diana (retro-verify if needed)

### Slot 3 (14:00-15:00) — OpenAlice 策略級 brief 14:00 cron 第一次真實 fire

- source pack 應該齊（cont_liq Day-6 yaml + FinMind token live + OHLCV 60d backfill）
- 14:00 cron auto generate
- AI commentary 第一次真實 publish
- Bruce verify `/api/v1/openalice/strategy-brief/latest` 不再 BLOCKED_DATA_QUALITY

**Owner**: Jason (確認 cron fire), Bruce (verify)

### Slot 4 (15:00-18:00) — 整合 + 收尾

- Codex `final-v031-live.ts` PR 若還沒 merge → 推進
- Watchlist 10-cap UI 實測
- Portfolio iframe 顯示 NT$10M 模擬資金
- Day-6 yaml + 策略 brief + 主頁 KGI tick 三件對齊 surface 給楊董

---

## Day 2 (2026-05-15)

### 策略升 PAPER_LIVE 第一次 dry-run

**前提**:
- Day-6 forward observation 結果不破 -10% alert
- WY 已正式退用 → signal shuffle MC 確立 cont_liq v36 evidence
- m_eff ≈ 2 confirmed safe
- 楊董 explicit ack PAPER_LIVE

**動作**:
- Athena 升 cont_liq_v36 registry status: `RESEARCH_FORWARD_OBSERVATION` → `PAPER_LIVE_CANDIDATE`
- Bruce 雙簽 evidence chain
- 我這邊 TR 派 Jason wire `/api/v1/paper/strategy/cont_liq_v36/signal` endpoint
- Codex 前端加 strategy card 顯示「Paper 自動跟單 ON」toggle（default OFF）

**Hard rule**:
- 仍 paper-broker only（不動 LIVE）
- 用戶手動 ack ON 才會跑
- 4 層風控全 wire

---

## Day 3-5 (2026-05-16 → 2026-05-18)

### Family C Phase 1 launch

- 5/16 (週六) 09:00 TDCC auto snapshot 第一次自動 fire
- Diana Path 2 historical adapter 若楊董 Option A → 量化 Codex 開工 ZIP scraper (2-3 dev-days)
- Scott v39 backtest 跑 real
- Athena promote Family C Phase 1 ready status

---

## Day 6+ (2026-05-19+)

### 軸 4 OpenAlice 升級

- daily brief + strategy-level brief 並行
- 加 risk alert section（cont_liq -10% alert / Family C 8-factor signal）
- 用戶可訂閱 push notification（Optional）

### 第三策略線 short-cycle / event factory

- Scott 設計 spec (Codex P2 建議)
- Universe: short-cycle / event-driven
- 例如: 法人連續同向跟單 v2 / 月營收 surprise / 季報 beat-rotation

---

## Hard rules（整個 Wave 5 守線）

- ❌ no real broker write
- ❌ no LIVE order /order/create open
- ❌ no registry rollback
- ❌ no promote/demote wording on forward observation
- ❌ no fake metric / hallucination passing
- ❌ no manual force-approve on brief publish
- ❌ no engineering jargon to UI
- ❌ no premature PASS/FAIL until forward observation 結束
- ✅ paper-broker simulator only
- ✅ 40 cap permanent constraint
- ✅ FinMind sponsor 用爆
- ✅ KGI test host only (iquotetest/itradetest)
- ✅ 每個 PR Bruce verify
- ✅ Mira wording firewall every batch

---

## 預期 4 軸最終評分（Wave 5 結束）

| 軸 | 起 (Codex eval) | Wave 5 目標 | 真實達成可能性 |
|---|---|---|---|
| 1 量化策略 | 45 | 70 | 中（要看 Day-6 forward 不破 alert + Athena ack v36 升 PAPER_LIVE）|
| 2 KGI 即時報價 | 80 | 95 | 高（明早盤中驗 + Codex 前端 wire 完）|
| 3 Portfolio paper-broker | 65 | 85 | 高（資金 NT$10M 統一 + 前端 iframe wire 完 + watchlist cap UI）|
| 4 OpenAlice | 60 | 80 | 中（14:00 cron 第一次真實生 brief + AI commentary）|

平均 50 → 82.5（**Wave 5 結束時公司產品成熟度從 50/100 升到 82.5/100**）。

---

## 風險 & 假設

- 假設明早 09:00 KGI gateway 自動開機正常（auto on/off cron 已驗證 14:10 自動關機 work，09:00 開機未驗）
- 假設前端 Codex `final-v031-live.ts` 明早前 merge
- 假設 Day-6 forward observation 不破 -10%（距 0.70pp 邊緣）
- 假設楊董明早 ack Wave 5 Option A + cont_liq PAPER_LIVE candidate 升級

## Wave 5 不做的事（避免 over-scope）

- 不加 Family C 以外的新策略
- 不開 LIVE order 通道
- 不換券商
- 不買商業 vendor feed
- 不做 UX polish 周邊

---

## 拍板

楊董明早醒來 review 後一句 `Wave 5 Option A GO` 我立刻派 Day 1 Slot 1-4 自動推進。
