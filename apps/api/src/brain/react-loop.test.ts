import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompanyAiAnalystContractFallbackReport,
  COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION,
  validateCompanyAiAnalystSections,
  validateCompanyAiAnalystQualityIssues,
  validateSynthesisSections,
} from "./react-loop.js";

const companyPrompt = `TEMPLATE_VERSION: ${COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION}\n分析標的: 2330`;

const completeCompanyReport = `
## 1. 公司概況與定位
台積電為半導體晶圓代工公司。來源：company_profile。

## 2. 今日/最近資料狀態
最新行情以 quote 與 kline 為準。來源：quote / kline。

## 3. 近期事件與新聞
資料不足：目前沒有足夠公司級新聞。來源：news。

## 4. 技術結構
資料不足：缺少完整技術指標。來源：kline。

## 5. 籌碼與法人
資料不足：缺少法人與融資融券資料。來源：institutional / margin。

## 6. 主題與產業鏈位置
公司位於半導體供應鏈核心。來源：company_profile。

## 7. 主要風險
資料風險、價格風險與事件風險都需要追蹤。來源：quote / news。

## 8. AI 結論與觀察等級
觀察等級：中性觀察。這不是下單建議。

## 9. 資料來源與生成時間
資料來源：quote / kline / company_profile / news。生成時間：2026-05-31T00:00:00.000Z。
`;

test("company AI analyst validator accepts the fixed 9-section contract", () => {
  assert.deepEqual(validateCompanyAiAnalystSections(completeCompanyReport), []);
  assert.deepEqual(validateSynthesisSections(completeCompanyReport, companyPrompt), []);
});

test("company AI analyst validator rejects missing contract sections", () => {
  const brokenReport = completeCompanyReport.replace("## 8. AI 結論與觀察等級", "## 8. 結論");
  assert.deepEqual(validateSynthesisSections(brokenReport, companyPrompt), [8]);
});

test("company AI analyst quality gate rejects short generic placeholder reports", () => {
  const placeholderReport = `
## 1. 公司概況與定位
資料不足：原因。

## 2. 今日/最近資料狀態
資料不足：原因。
`;

  const issues = validateCompanyAiAnalystQualityIssues(placeholderReport);
  assert.ok(issues.includes("too_short"));
  assert.ok(issues.includes("generic_data_gap_reason"));
  assert.ok(issues.includes("generic_placeholder_line"));
});

test("company AI analyst fallback is honest and still satisfies the 9-section contract", () => {
  const fallback = buildCompanyAiAnalystContractFallbackReport(
    [
      {
        round: 1,
        thought: "Fetch technical data",
        toolName: "get_company_technical",
        toolInput: { ticker: "2330" },
        observation: { lastPrice: 1000 },
        tokensUsed: 10,
      },
      {
        round: 2,
        thought: "Fetch news",
        toolName: "get_news_top10",
        toolInput: null,
        observation: { rows: [] },
        tokensUsed: 8,
      },
    ],
    companyPrompt,
    [3, 8],
    "2026-06-01T00:00:00.000Z",
    ["too_short"]
  );

  assert.deepEqual(validateSynthesisSections(fallback, companyPrompt), []);
  assert.deepEqual(validateCompanyAiAnalystQualityIssues(fallback), []);
  assert.match(fallback, /資料不足/);
  assert.match(fallback, /缺少段落 3, 8/);
  assert.match(fallback, /too_short/);
  assert.match(fallback, /get_company_technical \/ get_news_top10/);
  assert.doesNotMatch(fallback, /必漲|重倉|All in/i);
});
