/**
 * KGI gateway uptime guard tests (perf: scheduled-off short-circuit, 6/11).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/kgi-gateway-schedule.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  isKgiGatewayScheduledOff,
  noteKgiGatewayAlive,
  _resetKgiGatewayScheduleState,
} from "../broker/kgi-gateway-schedule.js";

// The shared test env sets KGI_GATEWAY_ALWAYS_ON=true for mock-fetch suites —
// clear it here since this file tests the guard itself.
delete process.env["KGI_GATEWAY_ALWAYS_ON"];

// 2026-06-11 is a Wednesday. TST = UTC+8.
const WED_1000_TST = Date.parse("2026-06-11T02:00:00Z"); // mid-session
const WED_0816_TST = Date.parse("2026-06-11T00:16:00Z"); // inside pre-boot margin (uptime from 08:15)
const WED_0810_TST = Date.parse("2026-06-11T00:10:00Z"); // before margin → off
const WED_1419_TST = Date.parse("2026-06-11T06:19:00Z"); // inside post-stop margin (until 14:20)
const WED_1421_TST = Date.parse("2026-06-11T06:21:00Z"); // after margin → off
const WED_2000_TST = Date.parse("2026-06-11T12:00:00Z"); // evening → off
const SAT_1000_TST = Date.parse("2026-06-13T02:00:00Z"); // weekend → off

test("guard is open during the weekday uptime window (with margins)", () => {
  _resetKgiGatewayScheduleState();
  assert.equal(isKgiGatewayScheduledOff(WED_1000_TST), false);
  assert.equal(isKgiGatewayScheduledOff(WED_0816_TST), false);
  assert.equal(isKgiGatewayScheduledOff(WED_1419_TST), false);
});

test("guard short-circuits off-hours and weekends", () => {
  _resetKgiGatewayScheduleState();
  assert.equal(isKgiGatewayScheduledOff(WED_0810_TST), true);
  assert.equal(isKgiGatewayScheduledOff(WED_1421_TST), true);
  assert.equal(isKgiGatewayScheduledOff(WED_2000_TST), true);
  assert.equal(isKgiGatewayScheduledOff(SAT_1000_TST), true);
});

test("a recent successful gateway response keeps the guard open (ad-hoc off-hours start)", () => {
  _resetKgiGatewayScheduleState();
  noteKgiGatewayAlive(WED_2000_TST);
  assert.equal(isKgiGatewayScheduledOff(WED_2000_TST + 60_000), false, "1 min after life sign");
  assert.equal(isKgiGatewayScheduledOff(WED_2000_TST + 6 * 60_000), true, "grace expired after 5 min");
  _resetKgiGatewayScheduleState();
});

test("KGI_GATEWAY_ALWAYS_ON env disables the guard", () => {
  _resetKgiGatewayScheduleState();
  const prev = process.env["KGI_GATEWAY_ALWAYS_ON"];
  try {
    process.env["KGI_GATEWAY_ALWAYS_ON"] = "true";
    assert.equal(isKgiGatewayScheduledOff(WED_2000_TST), false);
  } finally {
    if (prev === undefined) delete process.env["KGI_GATEWAY_ALWAYS_ON"];
    else process.env["KGI_GATEWAY_ALWAYS_ON"] = prev;
  }
});
