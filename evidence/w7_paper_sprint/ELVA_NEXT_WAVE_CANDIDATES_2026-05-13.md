# 下一輪 Wave 候選 (給楊董明早 review)

**Author**: Elva
**Date**: 2026-05-13
**Status**: Wave 4 後端 90% 完成；Wave 5 候選方向給楊董選

---

## 戰略 layer (你決定方向)

### Option A — 「**完成 Wave 4 最後 10% + 加深現有**」（最穩，低風險）

> 不開新戰場，把現有 4 軸推到 100%

**內容**:
1. **明早 09:00 盤中 live verify** 把 Wave 4 落地（Bruce 自動跑 checklist）
2. **OpenAlice strategy brief 真實生成**（資料齊後 14:00 cron 自動跑 + AI commentary 第一次 publish）
3. **三策略升 PAPER_LIVE**（你 ack + Bruce 雙簽 → forward observation 結束 promote）
4. **Codex 完成主頁 KGI tick wire + 熱力圖二分**

**ETA**: 2-3 天
**風險**: 低
**價值**: 完整 closing Wave 4，可以開始 demo

---

### Option B — 「**多券商冗余（脫單點 KGI 依賴）**」（中度，1-2 週）

> 加第二家券商，KGI 掛了還有備援

**內容**:
1. 開戶 **富邦** 或 **群益** quote API（你開戶免費）
2. 寫對應 broker adapter（apps/api/src/broker/*-broker.ts）
3. 多源 fallback chain: 主 KGI → 備 富邦/群益 → EOD TWSE
4. 訂閱 budget 增加（KGI 40 + 富邦 N）

**ETA**: 2-4 週
**風險**: 中（要熟悉新 SDK）
**價值**: 真正的「不被任何一家綁死」

---

### Option C — 「**OpenAlice 升級多策略**」（中度，1-2 週）

> 北極星 #6「短/中/長線可選擇配置」— 三條策略不夠變化

**內容**:
1. 新策略 #4 中線（如 5-day mean reversion）
2. 新策略 #5 長線（如 quarterly fundamental rotation）
3. 策略 portfolio rotation engine（用戶可選短/中/長）
4. Athena 主導 backtest + Bruce 雙簽

**ETA**: 1-2 週 (Athena + Jason)
**風險**: 中
**價值**: 投資組合多元，符合北極星

---

### Option D — 「**真實下單能力解凍**」（高，需風控）

> 北極星 #7「下單台直連券商」最後一塊

**內容**:
1. KGI LIVE Gate 2 從「永久 LIVE_ORDER_BLOCKED」改成「明示 ack + Bruce 雙簽 + 額度限制 + kill-switch」
2. paper → live 切換 UX（強烈警告 + dual confirm + 額度 cap）
3. 4 層風控（已 ready）真實 wire
4. 第一筆 LIVE order 1 share 0050 dry-run（per memory standard）
5. Bruce 全程 monitor + audit

**ETA**: 1-2 週工程 + 你心理準備
**風險**: 高（真實資金）
**價值**: 真正完整 trading room

---

### Option E — 「**商業即時 feed**」（投資成本）

> 脫離券商配額限制，全市場真即時

**內容**:
1. 評估 TXTrade / DataYes 月費 vendor
2. 試用一個月看可不可用
3. 接通後全市場熱力圖 / 即時行情 / 不靠券商

**ETA**: 1 週評估 + 1 週接通
**月費**: NT$5-15k
**風險**: 低（資料商成熟）
**價值**: 主頁全市場即時，KGI 配額限制不再卡

---

### Option F — 「**ISV 牌照**」（長期獨立）

> 終極獨立性，公司登記 + 直接訂 TWSE feed

**內容**:
1. 公司登記為金融資訊提供商 / 系統商
2. 申請 TWSE ISV 牌照
3. 訂 TWSE 商業即時 feed 直連
4. 不依賴任何券商

**ETA**: 3-6 月（行政流程）
**月費**: NT$ 1-5 萬
**風險**: 中（法規流程）
**價值**: 完全獨立，可商業化發展

---

## 我的推薦排序

### Wave 5 (本週)
**Option A** — 完成 Wave 4 最後 10% + 加深現有
- 不開新戰場，先把已開的全部收尾
- 三策略升 PAPER_LIVE 是最 obvious 的進展
- OpenAlice 真生 brief 是北極星 #4 final piece

### Wave 6 (下週)
**Option C** — OpenAlice 多策略
- 北極星 #6 「短/中/長線可選」差 2 條策略
- Athena 主導，不卡 KGI 配額

### Wave 7 (兩週後)
**Option B** — 多券商冗余
- 解 KGI 單點風險
- 開戶免費，工程量中

### Wave 8+ (1-2 月)
**Option D** — 真實下單能力解凍 (你心理準備好 + 風控真實 wire)

### Wave 9+ (規模到位後)
**Option E or F** — 商業 vendor or ISV 牌照

---

## 4 軸對照（哪一個 Option 推哪一軸）

| 軸 | Wave 4 完成度 | 推哪個能升 100% |
|---|---|---|
| 1 量化策略 ≥ 3 條 | 90% | Option A (PAPER_LIVE) → 100% |
| 2 KGI 即時報價 wire | 70% | Option A (Codex 前端 wire) → 100% |
| 3 Portfolio paper-broker | 90% | Option A (Codex iframe wire) → 100% |
| 4 OpenAlice 真主腦 | 90% | Option A (真實 14:00 cron generate) → 100% |

**結論**: Option A 是 Wave 4 真實完成 path，**Wave 5 該選這個**。

Wave 6 才開新戰場。

---

## 給楊董明早 5 分鐘 review

1. 看 Bruce 明早 09:00-14:30 跑完的 verify checklist
2. 看本份 candidates
3. 拍板 Wave 5 方向（推薦 Option A）

我等你 ack 就動。
