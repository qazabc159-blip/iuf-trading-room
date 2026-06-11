/**
 * Quant candidate pool tests (B1, Elva 2026-06-11).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/candidate-pool.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  screenMomentumCandidates,
  mergeCandidateScreens,
  buildQuantCandidatePool,
  renderCandidatePoolBlock,
  type QuantCandidate,
} from "../ai-recommendation-v2/candidate-pool.js";
import type { StockDayAllRow } from "../data-sources/twse-openapi-client.js";

function row(code: string, name: string, close: string, change: string, tradeValue: string): StockDayAllRow {
  return {
    Code: code, Name: name, ClosingPrice: close, Change: change, TradeValue: tradeValue,
    Date: "1150611", TradeVolume: "1000", OpeningPrice: close, HighestPrice: close, LowestPrice: close, Transaction: "10",
  } as StockDayAllRow;
}

test("momentum screen: liquidity floor, gainers only, 4-digit common stocks only", () => {
  const rows = [
    row("2330", "台積電", "1000", "30", "50000000000"),     // +3.09%, huge value → in
    row("1234", "小量股", "50", "4.5", "10000000"),           // 量太小（1 千萬）→ out
    row("5678", "下跌股", "100", "-5", "900000000"),          // 跌 → out
    row("00878", "ETF", "25", "1", "5000000000"),             // 非 4 碼 → out
    row("3008", "大立光", "2400", "120", "3000000000"),       // +5.26% → in, ranks first
  ];
  const { candidates, dataDate } = screenMomentumCandidates(rows);
  assert.deepEqual(candidates.map((c) => c.ticker), ["3008", "2330"]);
  assert.equal(dataDate, "2026-06-11");
  assert.match(candidates[0]!.reasons[0]!, /\+5\.26%/);
});

test("merge: institutional leads, dedupe unions reasons, cap respected", () => {
  const inst: QuantCandidate[] = [
    { ticker: "2330", name: "台積電", reasons: ["5 日法人合計淨買超約 12,000 張"] },
    { ticker: "2603", name: "長榮", reasons: ["5 日法人合計淨買超約 9,000 張"] },
  ];
  const mom: QuantCandidate[] = [
    { ticker: "2330", name: "台積電", reasons: ["前一交易日 +3.09%、成交額 500.0 億"] },
    { ticker: "3008", name: "大立光", reasons: ["前一交易日 +5.26%、成交額 30.0 億"] },
  ];
  const merged = mergeCandidateScreens(inst, mom, 18);
  assert.deepEqual(merged.map((c) => c.ticker), ["2330", "2603", "3008"]);
  assert.equal(merged[0]!.reasons.length, 2, "dedupe must union reasons");

  const capped = mergeCandidateScreens(inst, mom, 2);
  assert.equal(capped.length, 2);
});

test("pool builder flags fallbackNeeded on thin results; renderer falls back", async () => {
  // Memory mode (CI): institutional screen returns [] — only momentum from injected rows.
  const thin = await buildQuantCandidatePool([row("2330", "台積電", "1000", "30", "50000000000")]);
  assert.ok(thin);
  assert.equal(thin!.fallbackNeeded, true, "1 candidate < MIN_POOL_SIZE must flag fallback");

  const block = renderCandidatePoolBlock(thin, "2330（台積電）、2454（聯發科）");
  assert.match(block, /固定後備清單/);
  assert.match(block, /fallback/);
});

test("renderer lists dynamic candidates with reasons and keeps legacy as last resort", async () => {
  const rows = ["3008", "2454", "2603", "2615", "2609", "1605"].map((t, i) =>
    row(t, `股票${t}`, "100", String(5 - i * 0.5), "1000000000"));
  const pool = await buildQuantCandidatePool(rows);
  assert.ok(pool);
  assert.equal(pool!.fallbackNeeded, false);

  const block = renderCandidatePoolBlock(pool, "2330（台積電）");
  assert.match(block, /量化掃盤產生/);
  assert.match(block, /3008（股票3008）｜前一交易日/);
  assert.match(block, /後備清單（僅當上列全部查無技術資料時才使用）：2330（台積電）/);
});
