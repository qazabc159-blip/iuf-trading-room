import { describe, expect, it } from "vitest";

import { normalizeLlmCalls, normalizeLlmModels, normalizeLlmUsage } from "./normalize";

describe("admin brain llm normalizers", () => {
  it("accepts the production calls/models envelope", () => {
    expect(normalizeLlmCalls({ calls: [{ id: "c1" }] })).toEqual([{ id: "c1" }]);
    expect(normalizeLlmModels({ models: [{ modelKey: "m1" }] })).toEqual([{ modelKey: "m1" }]);
  });

  it("keeps backward compatibility with array payloads", () => {
    expect(normalizeLlmCalls([{ id: "c1" }])).toEqual([{ id: "c1" }]);
    expect(normalizeLlmModels([{ modelKey: "m1" }])).toEqual([{ modelKey: "m1" }]);
  });

  it("returns a render-safe usage object when optional arrays are absent", () => {
    const usage = normalizeLlmUsage({
      from: "2026-05-11",
      to: "2026-05-18",
      totalCalls: 82,
      totalTokens: 78685,
      totalCostUsd: 0.0229,
    });

    expect(usage).toMatchObject({
      from: "2026-05-11",
      to: "2026-05-18",
      totalCalls: 82,
      totalTokens: 78685,
      totalCostUsd: 0.0229,
      byModel: [],
      byModule: [],
      daily: [],
    });
  });
});
