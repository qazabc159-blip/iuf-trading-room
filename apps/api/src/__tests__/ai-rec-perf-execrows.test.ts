/**
 * execRows driver-shape normalizer (Elva 2026-06-11, audit B2 root cause).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/ai-rec-perf-execrows.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import { execRows } from "../ai-rec-perf-store.js";

test("execRows handles the postgres-js shape (bare array) — the actual prod driver", () => {
  assert.deepEqual(execRows([{ n: 1 }, { n: 2 }]), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(execRows([]), []);
});

test("execRows handles the node-postgres shape ({rows}) and garbage", () => {
  assert.deepEqual(execRows({ rows: [{ n: 3 }] }), [{ n: 3 }]);
  assert.deepEqual(execRows({ rows: [] }), []);
  assert.deepEqual(execRows({}), []);
  assert.deepEqual(execRows(null), []);
  assert.deepEqual(execRows(undefined), []);
});
