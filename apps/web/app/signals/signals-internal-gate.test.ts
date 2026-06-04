import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("signals customer totals", () => {
  it("keeps validation signals out of customer-facing totals", () => {
    expect(source).toContain("const displaySignals = signals.filter((signal) => !isInternalTestSignal(signal));");
    expect(source).toContain("const hiddenInternalCount = signals.length - displaySignals.length;");
    expect(source).toContain('<span className="parity-kpi-label">訊號總數</span>');
    expect(source).toContain('<span className="parity-kpi-sub">正式訊號</span>');
    expect(source).toContain("{countsAvailable ? displaySignals.length : \"--\"}");
    expect(source).not.toContain("{result.state !== \"BLOCKED\" ? result.data.signals.length : \"--\"}");
  });
});
