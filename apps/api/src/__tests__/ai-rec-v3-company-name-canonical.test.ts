import assert from "node:assert/strict";
import test from "node:test";

import { parseAiReportToRecommendationsV3 } from "../ai-recommendation-v2/orchestrator-v3.js";

test("V3 parser uses canonical core company names over hallucinated headings", () => {
  const markdown = `
## 2317 台積電
- 分類: B 等回檔
- 總分: 70
- 進場區: 250-270
- TP1: 290
- TP2: 310
- 停損: 240
- 為什麼買: 技術面相對強勢
- 為什麼不買: 市場波動

## 2308 聯電
- 分類: A 可觀察布局
- 總分: 75
- 進場區: 2300-2400
- TP1: 2500
- TP2: 2600
- 停損: 2200
- 為什麼買: 趨勢延續
- 為什麼不買: 估值偏高

## 2412 華邦電子
- 分類: B 等回檔
- 總分: 68
- 進場區: 130-140
- TP1: 150
- TP2: 160
- 停損: 125
- 為什麼買: 防禦配置
- 為什麼不買: 動能不足
`;

  const items = parseAiReportToRecommendationsV3(markdown, "2026-05-29");
  const names = new Map(items.map((item) => [item.ticker, item.companyName]));

  assert.equal(names.get("2317"), "鴻海");
  assert.equal(names.get("2308"), "台達電");
  assert.equal(names.get("2412"), "中華電");
});
