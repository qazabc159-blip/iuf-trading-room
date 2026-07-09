import { describe, expect, it } from "vitest";
import { gatewayStatusBadge } from "./final-v031-live";

// 統一下單流 D6（帳號帶，2026-07-09）: gatewayStatusBadge() drives both the
// trading-room account strip badges and (by wording contract, not by shared
// import — see /settings/broker/broker-connections.tsx's gatewayBadge()) the
// settings trust card. Four states per PERMISSION_MATRIX-adjacent design doc
// (S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md §2 D6): unpaired / pending /
// paired_unreachable / reachable.

describe("gatewayStatusBadge (統一下單流 D6 fixture)", () => {
  it("reachable -> 已連線 (green)", () => {
    const badge = gatewayStatusBadge("reachable");
    expect(badge.label).toBe("已連線");
    expect(badge.color).toBe("#34d399");
  });

  it("pending -> 等待配對 (amber)", () => {
    const badge = gatewayStatusBadge("pending");
    expect(badge.label).toBe("等待配對");
    expect(badge.color).toBe("#fbbf24");
  });

  it("paired_unreachable -> 等待連線 (amber)", () => {
    const badge = gatewayStatusBadge("paired_unreachable");
    expect(badge.label).toBe("等待連線");
    expect(badge.color).toBe("#fbbf24");
  });

  it("unpaired -> 未配對 (gray)", () => {
    const badge = gatewayStatusBadge("unpaired");
    expect(badge.label).toBe("未配對");
    expect(badge.color).toBe("#9ca3af");
  });

  it("unknown/null/undefined falls back to the unpaired badge, never crashes or renders a raw code", () => {
    expect(gatewayStatusBadge(null).label).toBe("未配對");
    expect(gatewayStatusBadge(undefined).label).toBe("未配對");
    expect(gatewayStatusBadge("some_future_backend_enum").label).toBe("未配對");
  });

  it("every badge returns border/background alongside label/color (full render contract)", () => {
    for (const status of ["reachable", "pending", "paired_unreachable", "unpaired"]) {
      const badge = gatewayStatusBadge(status);
      expect(badge.border).toMatch(/^rgba\(/);
      expect(badge.background).toMatch(/^rgba\(/);
    }
  });
});
