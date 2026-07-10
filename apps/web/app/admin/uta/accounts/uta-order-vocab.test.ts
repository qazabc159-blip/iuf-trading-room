import { describe, expect, it } from "vitest";

import { isKnownSimOnlyAdapter, safetyModeLabel, sideLabel } from "./uta-order-vocab";

// Regression lock for Pete #1206 review finding: OrdersTable used to read
// fields (side/quantity/simOnly) that never existed on the real backend
// UnifiedOrderRecord (action/qty, no per-row sim flag) — leaving 方向/數量/
// 安全模式 blank on /admin/uta/accounts. These pure helpers are what the
// table now derives those three columns from.

describe("sideLabel", () => {
  it("maps the real UnifiedOrderRecord action field to Traditional Chinese", () => {
    expect(sideLabel("Buy")).toBe("買進");
    expect(sideLabel("Sell")).toBe("賣出");
  });

  it("falls back to the raw value for an unknown action rather than hiding it", () => {
    expect(sideLabel("Unknown")).toBe("Unknown");
  });
});

describe("isKnownSimOnlyAdapter — 安全模式 derivation", () => {
  it("treats the two adapterKeys POST /api/v1/uta/orders currently accepts as SIM-only", () => {
    expect(isKnownSimOnlyAdapter("kgi")).toBe(true);
    expect(isKnownSimOnlyAdapter("paper")).toBe(true);
  });

  it("does not silently claim SIM for an adapter outside the known-locked set", () => {
    expect(isKnownSimOnlyAdapter("fubon")).toBe(false);
    expect(isKnownSimOnlyAdapter("some_future_adapter")).toBe(false);
  });
});

describe("safetyModeLabel", () => {
  it("renders an honest 待確認 rather than a false 正式封鎖 claim when not known-SIM", () => {
    expect(safetyModeLabel(true)).toBe("SIM");
    expect(safetyModeLabel(false)).toBe("待確認");
  });
});
