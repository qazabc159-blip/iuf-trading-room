import assert from "node:assert/strict";
import test from "node:test";

import { v3DbTrigger } from "../ai-recommendation-v2/orchestrator-v3.js";

test("V3 daily cron persists with an existing DB-allowed trigger", () => {
  assert.equal(v3DbTrigger("cron_daily"), "cron_0930:v3");
  assert.notEqual(v3DbTrigger("cron_daily"), "cron_daily:v3");
});

test("V3 legacy triggers keep their explicit DB values", () => {
  assert.equal(v3DbTrigger("manual_refresh"), "manual_refresh:v3");
  assert.equal(v3DbTrigger("cron_1300"), "cron_1300:v3");
  assert.equal(v3DbTrigger("test"), "test:v3");
});
