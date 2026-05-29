import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeAiRecommendationV3ItemsWithMap,
  deriveOfficialAnnouncementSourceStateFromTrace,
  parseAiReportToRecommendationsV3,
} from "../ai-recommendation-v2/orchestrator-v3.js";

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

test("V3 item canonicalizer prefers database names, then core names", () => {
  const items = canonicalizeAiRecommendationV3ItemsWithMap(
    [
      { ticker: "9999", companyName: "LLM 亂寫名稱" },
      { ticker: "2317", companyName: "台積電" },
    ] as any,
    new Map([["9999", "資料庫正確公司"]]),
  );

  assert.equal(items[0]?.companyName, "資料庫正確公司");
  assert.equal(items[1]?.companyName, "鴻海");
});

test("V3 derives official announcement source state from news trace", () => {
  const emptyState = deriveOfficialAnnouncementSourceStateFromTrace([
    {
      toolName: "get_news_top10",
      observation: {
        asOf: "2026-05-29T01:00:00Z",
        items: [
          { title: "市場新聞", source: "finmind_stock_news" },
          { title: "券商新聞", source: "news_ai_selector" },
        ],
      },
    },
  ]);

  assert.equal(emptyState.state, "empty");
  assert.equal(emptyState.count, 0);
  assert.match(emptyState.reason, /沒有官方公告/);

  const liveState = deriveOfficialAnnouncementSourceStateFromTrace([
    {
      toolName: "get_news_top10",
      observation: {
        asOf: "2026-05-29T01:05:00Z",
        items: [
          { title: "重大訊息", source: "twse_announcements" },
          { title: "公開資訊觀測站公告", source: "mops_t187ap11_L" },
          { title: "市場新聞", source: "finmind_stock_news" },
        ],
      },
    },
  ]);

  assert.equal(liveState.state, "live");
  assert.equal(liveState.count, 2);
  assert.match(liveState.reason, /已納入 2 則官方公告/);
});
