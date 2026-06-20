import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detailSource = readFileSync(new URL("./[id]/page.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../lib/api.ts", import.meta.url), "utf8");

describe("brief adversarial audit copy", () => {
  it("shows high adversarial scores as warnings because the pipeline no longer intercepts them", () => {
    expect(apiSource).toContain('verdict: "OK" | "WARNING";');
    expect(detailSource).toContain('if (value === "WARNING") return "風險警示";');
    expect(detailSource).toContain('if (value === "WARNING") return "warn";');
    expect(detailSource).not.toContain('if (value === "INTERCEPTED") return "攔截";');
  });
});
