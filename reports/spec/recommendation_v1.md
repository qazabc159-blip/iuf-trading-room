# Recommendation v1 Product Spec

**Owner**: Elva (Trading Room team lead)
**Frozen**: 2026-05-14 17:55 TST
**Yang ack**: explicit (today's chat thread)
**Status**: 7-day MVP build

---

## 1. 產品定位

「AI 推薦股票」三層架構：

| Layer | Owner | 範圍 |
|---|---|---|
| 1. Quant Alpha | Athena (Lab) | 量化訊號、策略分數、回測可信度、snapshot、gate、regime、候選池 |
| 2. Recommendation Orchestrator | Elva (spec) + 前端 Codex (實作) | 把 quant + 市場情報 + 籌碼 + K 線 + 消息 + 主題 + 風控整合成最終推薦 |
| 3. Explanation / Frontend | 前端 Codex (實作), Elva 驗收 | 推薦卡 / 理由 / 買點 / 停損 / 目標 / 風險 / 帶入交易室 |

---

## 2. 5 Buckets (action enum)

| Bucket | 條件 | 主頁顯示 |
|---|---|---|
| 今日首選 | totalScore ≥ 80 + 資料完整 | ✅ 優先顯示 |
| 可布局 | 70 ≤ score < 80 | ✅ 優先顯示 |
| 等回檔 | 60 ≤ score < 70 OR 價格過熱 | ✅ 優先顯示 |
| 高風險排除 | score < 60 OR riskFlags 過多 | 折疊區 |
| 資料不足暫不推薦 | dataQuality 缺失多 | 排除區，不在主頁滿版 |

---

## 3. Schema (TypeScript / zod)

### StockRecommendation

```ts
const StockRecommendationSchema = z.object({
  recommendationId: z.string(),
  date: z.string(),  // ISO date

  ticker: z.string(),
  companyName: z.string(),
  rank: z.number(),

  action: z.enum(["今日首選", "可布局", "等回檔", "高風險排除", "資料不足暫不推薦"]),
  direction: z.enum(["偏多", "偏空", "中性"]),
  timeHorizon: z.enum(["當沖/隔日", "1-2週", "波段"]),

  confidence: z.number().min(0).max(1),
  totalScore: z.number().min(0).max(100),

  quant: z.object({
    score: z.number().min(0).max(100),
    strategySource: z.string(),  // "cont_liq_v36" / "MAIN" / etc.
    gateStatus: z.enum(["PASS", "WATCH", "FAIL"]),
    reason: z.array(z.string()),
  }),

  entryZone: z.object({
    primary: z.string(),  // e.g., "865-870 區間"
    secondary: z.string().optional(),
    reason: z.string(),
  }),

  invalidation: z.object({
    price: z.number().nullable(),
    rule: z.string(),  // "跌破 845 結構失效"
  }),

  targets: z.array(z.object({
    label: z.enum(["TP1", "TP2", "延伸"]),
    price: z.number().nullable(),
    reason: z.string(),
  })),

  positionSizing: z.object({
    suggestion: z.enum(["小倉", "中倉", "禁止追高"]),
    maxRiskPct: z.number(),
  }),

  reasons: z.object({
    technical: z.array(z.string()),
    chip: z.array(z.string()),
    news: z.array(z.string()),
    theme: z.array(z.string()),
    quant: z.array(z.string()),
    macro: z.array(z.string()),
  }),

  risks: z.array(z.string()),

  dataQuality: z.object({
    quote: z.enum(["OK", "STALE", "MISSING"]),
    kbar: z.enum(["OK", "STALE", "MISSING"]),
    chip: z.enum(["OK", "STALE", "MISSING"]),
    news: z.enum(["OK", "STALE", "MISSING"]),
    quant: z.enum(["OK", "WEAK", "MISSING"]),
    confidencePenalty: z.number(),  // 0-1 mapped to score reduction
  }),

  sourceTrail: z.array(z.object({
    type: z.string(),
    source: z.string(),
    timestamp: z.string(),
  })),

  generatedBy: z.literal("iuf_recommendation_orchestrator_v1"),
  generatedAt: z.string(),
});
```

### QuantCandidateSignal (Athena 提供)

```ts
type QuantCandidateSignal = {
  ticker: string;
  companyName: string;
  quantRank: number;
  quantScore: number;  // 0-100
  strategySource: "cont_liq_v36" | "MAIN" | "strategy_002" | "manual_research" | string;
  regime: "trend" | "range" | "risk_off" | "event_driven";
  gateStatus: "PASS" | "WATCH" | "FAIL";
  expectedHoldingPeriod: "1-2週" | "波段" | "短線";
  quantReason: string[];
  riskFlags: string[];
  dataQuality: {
    backtestEvidence: "OK" | "WEAK" | "MISSING";
    forwardObservation: "OK" | "PENDING" | "MISSING";
    liquidity: "OK" | "LOW";
  };
  snapshotAt: string;
};
```

---

## 4. v1 input sources

### v1 (Day 7 MVP scope)
1. **Quant**: Athena `QuantCandidateSignal[]` (主要 cont_liq_v36)
2. **Market Intel**: 主頁 leaders + heatmap
3. **News**: market-intel announcements 30 件

### v2+ (Day 8+)
4. 籌碼 (institutional buy/sell)
5. 主題鏈
6. Macro/regime (從 OpenAlice brief sector view 引用)
7. AI news selector (真 model 不只 query)

---

## 5. Endpoints (Jason backend)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/recommendations/today` | 今日全部 (filtered by user role) |
| GET | `/api/v1/recommendations/:id` | Single detail |
| POST | `/api/v1/recommendations/:id/feedback` | User 反饋 (👍👎) |

### Owner-only auth
v1 全部 Owner-only (paid tier 開放在 v2+)

---

## 6. UI (前端 Codex)

### Page: `/ai-recommendations`

5 個 section by bucket (前 3 預設展開，後 2 折疊):
1. 今日首選 (cards)
2. 可布局 (cards)
3. 等回檔 (cards)
4. 高風險排除 (折疊)
5. 資料不足 (折疊)

### Recommendation Card

```
┌─ [rank] [ticker] [companyName] ──────────────┐
│ [action badge] [direction] [timeHorizon]      │
│                                                │
│ Quant Score: 88 / 100  (cont_liq_v36, PASS)   │
│ Confidence: ████████░░ 82%                     │
│                                                │
│ 進場區: 865-870 (技術 + 量價支撐)              │
│ 停損: 845 (跌破結構失效)                       │
│ TP1: 920 (前高)  TP2: 950 (延伸)              │
│ 倉位建議: 中倉, 風險 ≤ 2%                      │
│                                                │
│ ▼ 理由 (展開)                                  │
│   [技術] [籌碼] [新聞] [主題] [量化] [Macro]    │
│                                                │
│ ▼ 風險                                         │
│                                                │
│ 資料品質: 報價✓ K線✓ 籌碼✓ 新聞✓ 量化✓         │
│                                                │
│ [一鍵帶入交易室 →]                              │
└────────────────────────────────────────────────┘
```

### 一鍵帶入交易室
- click → `/portfolio?ticker=2330&prefill=true&from_rec=<id>&entry=865-870&stop=845&tp=920`
- 交易室 form 自動填好 → user 微調 → submit → KGI SIM

---

## 7. Acceptance Gates (Elva 驗收)

- [ ] 每張卡 dataQuality 透明顯示，不藏 STALE / MISSING
- [ ] 沒有「敬請期待」/「TODO」/ 模板殘留 wording
- [ ] 「資料不足」bucket 不在主頁滿版
- [ ] 「禁止追高」suggestion 用紅字標示
- [ ] 「跌破 X 結構失效」rule 明確
- [ ] 一鍵帶入交易室真實 prefill
- [ ] v1 全 SIM-only (Paper trade or KGI SIM)
- [ ] Confidence + score visible
- [ ] sourceTrail 可展開看資料來源
- [ ] LLM 寫的 reason / risk 沒亂碼沒模板殘留 (OpenAlice sanitizer 已套用)

---

## 8. Stop-lines

- ❌ promote PAPER_LIVE 任何路徑
- ❌ KGI live broker write
- ❌ user-visible 「保證獲利」/「必賺」/「可以跟單」
- ❌ 亂編資料來源
- ❌ 沒停損 / 沒風險的推薦

---

## 9. Sequencing (per cron 7-day roadmap)

| Day | Owner | Deliverable |
|---|---|---|
| 0 (今晚) | Bruce + Jason | KGI SIM e2e 收尾 + OpenAlice P0 fix |
| 1 | Codex (FE) + Jason | Sidebar IA + Orchestrator backend skeleton |
| 1 | Athena | QuantCandidateSignal fixture |
| 2-3 | Codex (FE) | /ai-recommendations 接 Orchestrator |
| 4-5 | Codex (FE) + Jason | /quant-strategies 頁 + subscribe endpoint |
| 6 | Codex (FE) + Jason | Notification center + bell drawer |
| 7 | Bruce + Yang | 全站 e2e + 楊董驗收 |

---

## 10. Change log

- 2026-05-14 17:55 TST — Elva initial freeze (per Yang chat thread)
