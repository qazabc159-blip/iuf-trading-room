import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("portfolio snapshot capture route is Owner-only and writes a manual paper snapshot", () => {
  assert.match(source, /app\.post\("\/api\/v1\/portfolio\/snapshots\/capture-paper"/);
  assert.match(source, /session\.user\.role !== "Owner"/);
  // 2026-07-15 PR #1279 Pete review fix: buildPaperPortfolioSnapshotPositions
  // now takes the full session (not just userId) so it can merge in unified-
  // pipeline fills via fetchAllFilledPaperOrders(session), not just legacy
  // paper_orders — see broker/paper-broker.ts's listUnifiedFillsAsOrderStates().
  assert.match(source, /buildPaperPortfolioSnapshotPositions\(session\)/);
  assert.match(source, /trigger: "manual"/);
  assert.match(source, /source: "paper_portfolio_manual_capture"/);
});

test("portfolio snapshot capture route is paper-only with no broker or KGI write", () => {
  assert.match(source, /brokerWrite: false/);
  assert.match(source, /kgiWrite: false/);
  assert.match(source, /simulated: true/);
  assert.match(source, /source: "paper_portfolio"/);
});
