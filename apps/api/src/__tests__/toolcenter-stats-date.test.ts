import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toolCallCreatedAtEpochMsForStats } from "../tools/tool-registry-store.js";

describe("ToolCenter stats createdAt parsing", () => {
  it("accepts Date objects from local postgres drivers", () => {
    const value = toolCallCreatedAtEpochMsForStats(new Date("2026-05-30T08:00:00.000Z"));
    assert.equal(value, Date.parse("2026-05-30T08:00:00.000Z"));
  });

  it("accepts ISO timestamp strings from production drivers", () => {
    const value = toolCallCreatedAtEpochMsForStats("2026-05-30T08:00:00.000Z");
    assert.equal(value, Date.parse("2026-05-30T08:00:00.000Z"));
  });

  it("rejects malformed dates instead of crashing the stats endpoint", () => {
    assert.equal(toolCallCreatedAtEpochMsForStats("not-a-date"), null);
    assert.equal(toolCallCreatedAtEpochMsForStats(null), null);
  });
});
