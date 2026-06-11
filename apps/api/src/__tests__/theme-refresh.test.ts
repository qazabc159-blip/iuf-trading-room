/**
 * theme-refresh pure-function tests (Elva 2026-06-11).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/theme-refresh.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseThemeRefreshOutput,
  isThemeRefreshCronWindowAt,
  themeRefreshTaipeiDate,
  runThemeRefresh,
} from "../theme-refresh.js";

const VALID = {
  thesis: "低軌衛星進入規模部署期，台灣供應鏈在天線、功率放大器與地面站設備具備代工優勢，受惠訂單能見度逐季改善。",
  whyNow: "最近交易日成員多數收漲，主要客戶釋出新一輪地面終端拉貨訊號，產業位於需求擴張早期。",
  bottleneck: "關鍵零組件交期仍長，且主要終端客戶集中度高，若部署進度遞延將直接影響成員營收節奏。",
};

test("parseThemeRefreshOutput accepts valid JSON (with and without code fence)", () => {
  const raw = JSON.stringify(VALID);
  assert.deepEqual(parseThemeRefreshOutput(raw), VALID);
  assert.deepEqual(parseThemeRefreshOutput("```json\n" + raw + "\n```"), VALID);
});

test("parseThemeRefreshOutput rejects forbidden trading-advice wording", () => {
  for (const bad of ["建議買進核心成員", "目標價上看 1200", "勝率高達八成", "現在進場布局"]) {
    const payload = { ...VALID, whyNow: VALID.whyNow + bad };
    assert.equal(parseThemeRefreshOutput(JSON.stringify(payload)), null, `must reject: ${bad}`);
  }
});

test("parseThemeRefreshOutput rejects mojibake, short fields and bad JSON", () => {
  assert.equal(parseThemeRefreshOutput(JSON.stringify({ ...VALID, thesis: "壞字�內容出現在這一段文字裡面需要超過二十個字元" })), null);
  assert.equal(parseThemeRefreshOutput(JSON.stringify({ ...VALID, bottleneck: "太短" })), null);
  assert.equal(parseThemeRefreshOutput("not json at all"), null);
  assert.equal(parseThemeRefreshOutput(JSON.stringify({ thesis: VALID.thesis })), null);
  assert.equal(parseThemeRefreshOutput(null), null);
});

test("theme refresh cron window is 17:30-18:30 TST weekdays", () => {
  // 2026-06-11 is a Thursday. 17:45 TST = 09:45 UTC.
  assert.equal(isThemeRefreshCronWindowAt(Date.parse("2026-06-11T09:45:00Z")), true);
  assert.equal(isThemeRefreshCronWindowAt(Date.parse("2026-06-11T09:29:00Z")), false); // 17:29
  assert.equal(isThemeRefreshCronWindowAt(Date.parse("2026-06-11T10:31:00Z")), false); // 18:31
  assert.equal(isThemeRefreshCronWindowAt(Date.parse("2026-06-13T09:45:00Z")), false); // Saturday
  assert.equal(themeRefreshTaipeiDate(Date.parse("2026-06-11T09:45:00Z")), "2026-06-11");
});

test("runThemeRefresh fails open in memory mode (CI has no DATABASE_URL)", async () => {
  const result = await runThemeRefresh({ trigger: "manual" });
  assert.equal(result.error, "memory_mode");
  assert.equal(result.updated, 0);
});
