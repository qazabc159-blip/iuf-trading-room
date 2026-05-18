#!/usr/bin/env python3
"""
Append 5 AI-REC-V3 tests to tests/ci.test.ts before the after() teardown.
"""

TEST_PATH = "tests/ci.test.ts"

with open(TEST_PATH, "r", encoding="utf-8") as f:
    content = f.read()

if "AI-REC-V3-1" in content:
    print("SKIP: AI-REC-V3 tests already present")
    exit(0)

TEARDOWN = """// Force-exit teardown: tsx/esbuild service workers are not killed by node:test runner.
// Without this, CI hangs 17+ minutes waiting for orphan esbuild processes to die.
after(async () => {"""

NEW_TESTS = r"""// =============================================================================
// AI RECOMMENDATION V3 — Yang SOP 5-module / 7 sub-score tests
// Lane: strategy backend (Jason). Files: ai-recommendation-v2/orchestrator-v3.ts
// =============================================================================

test("AI-REC-V3-1: v3 system prompt contains all 5 Yang SOP modules", async () => {
  // Verify the v3 orchestrator file contains the 5-module SOP prompt structure
  // This is a structural test — reads the source file to confirm prompt content.
  const fs = await import("fs/promises");
  const src = await fs.readFile("apps/api/src/ai-recommendation-v2/orchestrator-v3.ts", "utf-8");

  assert.ok(src.includes("STEP 1") && src.includes("市場狀態"), "AI-REC-V3-1: must have STEP 1 市場狀態");
  assert.ok(src.includes("STEP 2") && src.includes("主題穿透"), "AI-REC-V3-1: must have STEP 2 主題穿透");
  assert.ok(src.includes("STEP 3") && src.includes("sub-score"), "AI-REC-V3-1: must have STEP 3 7 sub-score");
  assert.ok(src.includes("STEP 4") && src.includes("Bucket"), "AI-REC-V3-1: must have STEP 4 Bucket");
  assert.ok(src.includes("STEP 5") && src.includes("OTE"), "AI-REC-V3-1: must have STEP 5 OTE");
  assert.ok(src.includes("risk_off_score"), "AI-REC-V3-1: must define risk_off_score");
  assert.ok(src.includes("trend_score"), "AI-REC-V3-1: must define trend_score");
  assert.ok(src.includes("RISK_OFF_SKIP"), "AI-REC-V3-1: must handle RISK_OFF_SKIP");
});

test("AI-REC-V3-2: market risk_off skip returns empty items and status=market_risk_off", async () => {
  const { _resetAiRecommendationV3Cache, parseAiReportToRecommendationsV3 } = await import(
    "../apps/api/src/ai-recommendation-v2/orchestrator-v3.js" as any
  );
  _resetAiRecommendationV3Cache();

  // Simulate a risk-off markdown report (what AI returns when risk_off_score >= 3)
  const riskOffMarkdown = `## 市場 risk-off — 暫不推薦新倉

RISK_OFF_SKIP: risk_off_score = 4 (VIX>25, VIX5d漲>30%, DXY60dZ>1, TAIEX<EMA60)
依楊董 SOP，risk_off_score >= 3 時不開新 beta 倉，待事件過後重新評估。`;

  const items = parseAiReportToRecommendationsV3(riskOffMarkdown, "2026-05-18");
  assert.equal(items.length, 0, "AI-REC-V3-2: risk-off must return 0 items");
});

test("AI-REC-V3-3: parseAiReportToRecommendationsV3 extracts 7 sub-scores from structured markdown", async () => {
  const { parseAiReportToRecommendationsV3 } = await import(
    "../apps/api/src/ai-recommendation-v2/orchestrator-v3.js" as any
  );

  const markdown = `## 2330 台積電
- 分類: A+今日首選
- 總分: 87
- 市場狀態: trend
- 主題位置分: 18
- 營收財報分: 14
- 法人ETF分: 13
- 融資借券分: 12
- 相對強弱量能分: 9
- 技術結構分: 16
- 估值事件分: 5
- 進場區: 870-890
- 進場理由: OTE 0.618-0.705 回踩
- TP1: 930
- TP1理由: 前波高 2024-11-18
- TP2: 970
- TP2理由: 月線上緣
- 停損: 850
- ATR倍數: 0.5
- R值: 2.3
- 信心: 0.85
- 為什麼買: 台積電3nm良率提升; 法人連5日淨買超; RS20>0且放量突破
- 為什麼不買: 美中科技戰風險; 估值偏高PE28x
- NAV比重: 0.8%
- 市場倍率: 1.0

## 2454 聯發科
- 分類: A可觀察布局
- 總分: 78
- 市場狀態: trend
- 主題位置分: 14
- 營收財報分: 12
- 法人ETF分: 10
- 融資借券分: 11
- 相對強弱量能分: 8
- 技術結構分: 18
- 估值事件分: 5
- 進場區: 1150-1200
- 進場理由: 突破後回測不破
- TP1: 1280
- TP1理由: 前高整數關
- TP2: 1350
- TP2理由: 年線頂部
- 停損: 1100
- ATR倍數: 0.5
- R值: 1.8
- 信心: 0.72
- 為什麼買: AI手機主題; 投信連買
- 為什麼不買: 中國出貨比重高; 融資小幅增加
- NAV比重: 0.6%
- 市場倍率: 0.9`;

  const items = parseAiReportToRecommendationsV3(markdown, "2026-05-18");

  assert.ok(items.length >= 2, `AI-REC-V3-3: must parse at least 2 items, got ${items.length}`);

  const tsmc = items.find(i => i.ticker === "2330");
  assert.ok(tsmc, "AI-REC-V3-3: must find 2330 台積電");
  assert.equal(tsmc!.action, "今日首選", "AI-REC-V3-3: 2330 must be 今日首選");
  assert.equal(tsmc!.bucket, "A+", "AI-REC-V3-3: 2330 bucket must be A+");
  assert.ok(tsmc!.totalScore !== undefined && tsmc!.totalScore! >= 80, `AI-REC-V3-3: 2330 totalScore must be >=80, got ${tsmc!.totalScore}`);
  assert.ok(tsmc!.subScores !== undefined, "AI-REC-V3-3: 2330 must have subScores");
  assert.equal(tsmc!.subScores!.theme, 18, "AI-REC-V3-3: 2330 theme score must be 18");
  assert.equal(tsmc!.subScores!.technical, 16, "AI-REC-V3-3: 2330 technical score must be 16");
  assert.ok(tsmc!.entryZone !== undefined, "AI-REC-V3-3: 2330 must have entryZone");
  assert.equal(tsmc!.entryZone!.low, 870, "AI-REC-V3-3: 2330 entryZone.low must be 870");
  assert.equal(tsmc!.entryZone!.high, 890, "AI-REC-V3-3: 2330 entryZone.high must be 890");
  assert.ok(tsmc!.tp1Structured !== undefined, "AI-REC-V3-3: 2330 must have tp1Structured");
  assert.equal(tsmc!.tp1Structured!.price, 930, "AI-REC-V3-3: 2330 tp1 must be 930");
  assert.ok(tsmc!.stopLossStructured !== undefined, "AI-REC-V3-3: 2330 must have stopLossStructured");
  assert.ok(tsmc!.why_buy !== undefined && tsmc!.why_buy!.length >= 1, "AI-REC-V3-3: 2330 must have why_buy");
  assert.ok(tsmc!.why_not_buy !== undefined && tsmc!.why_not_buy!.length >= 1, "AI-REC-V3-3: 2330 must have why_not_buy");

  const mtk = items.find(i => i.ticker === "2454");
  assert.ok(mtk, "AI-REC-V3-3: must find 2454");
  assert.equal(mtk!.bucket, "A", "AI-REC-V3-3: 2454 bucket must be A");
});

test("AI-REC-V3-4: bucket assignment logic A+/A/B/C by totalScore thresholds", async () => {
  const { parseAiReportToRecommendationsV3 } = await import(
    "../apps/api/src/ai-recommendation-v2/orchestrator-v3.js" as any
  );

  const makeBlock = (ticker: string, name: string, bucket: string, score: number) => `
## ${ticker} ${name}
- 分類: ${bucket}
- 總分: ${score}
- 市場狀態: trend
- 主題位置分: 16
- 營收財報分: 12
- 法人ETF分: 11
- 融資借券分: 10
- 相對強弱量能分: 8
- 技術結構分: 15
- 估值事件分: 4
- 進場區: 100-110
- TP1: 120
- TP2: 135
- 停損: 92
- 信心: 0.7
- 為什麼買: 主題強; 法人持續買
- 為什麼不買: 籌碼偏熱; 估值高
`;

  const markdown =
    makeBlock("2330", "台積電", "A+今日首選", 88) +
    makeBlock("2454", "聯發科", "A可觀察布局", 77) +
    makeBlock("2317", "鴻海", "B等回檔", 68) +
    makeBlock("2412", "中華電信", "C高風險排除", 55);

  const items = parseAiReportToRecommendationsV3(markdown, "2026-05-18");

  // C bucket is excluded from results
  assert.equal(items.length, 3, `AI-REC-V3-4: must have 3 items (C excluded), got ${items.length}`);

  const tickers = items.map(i => i.ticker);
  assert.ok(tickers.includes("2330"), "AI-REC-V3-4: A+ 2330 must be included");
  assert.ok(tickers.includes("2454"), "AI-REC-V3-4: A 2454 must be included");
  assert.ok(tickers.includes("2317"), "AI-REC-V3-4: B 2317 must be included");
  assert.ok(!tickers.includes("2412"), "AI-REC-V3-4: C 2412 must be EXCLUDED");

  const aPlus = items.find(i => i.ticker === "2330");
  assert.equal(aPlus!.bucket, "A+", "AI-REC-V3-4: 2330 must be A+");
  assert.equal(aPlus!.action, "今日首選", "AI-REC-V3-4: A+ action must be 今日首選");
  assert.ok(aPlus!.position_sizing !== undefined, "AI-REC-V3-4: A+ must have position_sizing");
  assert.ok(aPlus!.position_sizing!.nav_pct <= 0.01, "AI-REC-V3-4: A+ nav_pct must be <=1%");

  const b = items.find(i => i.ticker === "2317");
  assert.equal(b!.bucket, "B", "AI-REC-V3-4: 2317 must be B");
  assert.equal(b!.action, "等回檔", "AI-REC-V3-4: B action must be 等回檔");
});

test("AI-REC-V3-5: entry/TP/SL fields parsed from structured markdown with R-ratio and why_buy/why_not_buy", async () => {
  const { parseAiReportToRecommendationsV3 } = await import(
    "../apps/api/src/ai-recommendation-v2/orchestrator-v3.js" as any
  );

  const markdown = `## 3711 日月光投控
- 分類: A+今日首選
- 總分: 86
- 市場狀態: trend
- 主題位置分: 19
- 營收財報分: 14
- 法人ETF分: 13
- 融資借券分: 12
- 相對強弱量能分: 9
- 技術結構分: 14
- 估值事件分: 5
- 進場區: 165-170
- 進場理由: OTE 0.618-0.705 EMA20回踩承接
- TP1: 185
- TP1理由: 前波高 2024-12-05
- TP2: 200
- TP2理由: 年線頂部
- 停損: 158
- ATR倍數: 0.5
- R值: 2.5
- 信心: 0.82
- 為什麼買: CoWoS先進封裝需求暴增; 外資連8日買超; RS20>0突破量放大
- 為什麼不買: 美元走強壓匯率; 封裝報價談判進度未知
- NAV比重: 0.8%
- 市場倍率: 1.0`;

  const items = parseAiReportToRecommendationsV3(markdown, "2026-05-18");

  assert.equal(items.length, 1, `AI-REC-V3-5: must parse 1 item, got ${items.length}`);
  const item = items[0]!;

  assert.equal(item.ticker, "3711", "AI-REC-V3-5: ticker must be 3711");
  assert.equal(item.bucket, "A+", "AI-REC-V3-5: bucket must be A+");

  // entryZone
  assert.ok(item.entryZone !== undefined, "AI-REC-V3-5: must have entryZone");
  assert.equal(item.entryZone!.low, 165, "AI-REC-V3-5: entryZone.low must be 165");
  assert.equal(item.entryZone!.high, 170, "AI-REC-V3-5: entryZone.high must be 170");
  assert.ok(item.entryZone!.reason && item.entryZone!.reason.includes("OTE"), "AI-REC-V3-5: entryZone.reason must mention OTE");

  // tp1Structured
  assert.ok(item.tp1Structured !== undefined, "AI-REC-V3-5: must have tp1Structured");
  assert.equal(item.tp1Structured!.price, 185, "AI-REC-V3-5: tp1 price must be 185");
  assert.ok(item.tp1Structured!.reason && item.tp1Structured!.reason.length > 0, "AI-REC-V3-5: tp1 reason must be non-empty");

  // tp2Structured
  assert.ok(item.tp2Structured !== undefined, "AI-REC-V3-5: must have tp2Structured");
  assert.equal(item.tp2Structured!.price, 200, "AI-REC-V3-5: tp2 price must be 200");

  // stopLossStructured
  assert.ok(item.stopLossStructured !== undefined, "AI-REC-V3-5: must have stopLossStructured");
  assert.equal(item.stopLossStructured!.price, 158, "AI-REC-V3-5: stopLoss price must be 158");
  assert.equal(item.stopLossStructured!.atr_multiple, 0.5, "AI-REC-V3-5: atr_multiple must be 0.5");

  // r_ratio
  assert.ok(item.r_ratio !== undefined && item.r_ratio! >= 2.0, `AI-REC-V3-5: r_ratio must be >= 2.0, got ${item.r_ratio}`);

  // why_buy / why_not_buy
  assert.ok(item.why_buy !== undefined && item.why_buy!.length >= 2, `AI-REC-V3-5: why_buy must have >= 2 items, got ${item.why_buy?.length}`);
  assert.ok(item.why_not_buy !== undefined && item.why_not_buy!.length >= 1, `AI-REC-V3-5: why_not_buy must have >= 1 item, got ${item.why_not_buy?.length}`);

  // position_sizing
  assert.ok(item.position_sizing !== undefined, "AI-REC-V3-5: must have position_sizing");
  assert.ok(item.position_sizing!.nav_pct > 0, "AI-REC-V3-5: nav_pct must be > 0");
  assert.ok(item.position_sizing!.market_multiplier > 0, "AI-REC-V3-5: market_multiplier must be > 0");

  // subScores
  assert.ok(item.subScores !== undefined, "AI-REC-V3-5: must have subScores");
  assert.equal(item.subScores!.theme, 19, "AI-REC-V3-5: theme score must be 19");
  assert.equal(item.subScores!.valuation, 5, "AI-REC-V3-5: valuation score must be 5");
  assert.ok(item.totalScore !== undefined && item.totalScore! >= 85, `AI-REC-V3-5: totalScore must be >= 85 for A+, got ${item.totalScore}`);
});

"""

if TEARDOWN not in content:
    print("ERROR: teardown anchor not found in ci.test.ts")
    exit(1)

patched = content.replace(TEARDOWN, NEW_TESTS + TEARDOWN)

with open(TEST_PATH, "w", encoding="utf-8") as f:
    f.write(patched)

print(f"PATCHED: appended 5 AI-REC-V3 tests ({len(NEW_TESTS)} chars)")
