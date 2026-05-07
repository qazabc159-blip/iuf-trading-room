import assert from "node:assert/strict";
import test from "node:test";

import { filterProductionThemeCandidates } from "./theme-quality.js";

test("filters cleanup themes before worker producers build operator content", () => {
  const themes = [
    { name: "[BROKEN-1] To Fix", slug: "broken-1", priority: 5 },
    { name: "[DEPRECATED] Photoresist Test", slug: "photoresist-test", priority: 5 },
    { name: "placeholder cleanup", slug: "placeholder-cleanup", priority: 5 },
    { name: "AI 光通訊", slug: "ai-optics", priority: 3 },
    { name: "CoWoS", slug: "cowos", priority: 0 },
    { name: "電力韌性", slug: "power-grid", priority: 2 }
  ];

  assert.deepEqual(
    filterProductionThemeCandidates(themes).map((theme) => theme.name),
    ["AI 光通訊", "電力韌性"]
  );
});
