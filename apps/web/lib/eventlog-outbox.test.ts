import { describe, expect, it } from "vitest";

import { normalizeOutboxDiag, outboxPendingLabel } from "./eventlog-outbox";

describe("normalizeOutboxDiag", () => {
  it("keeps healthy zero counts as an ok state", () => {
    const outbox = normalizeOutboxDiag({ pendingCount: 0, fatalCount: 0, oldestPendingAt: null, isPollerRunning: true });

    expect(outbox).toMatchObject({
      pendingCount: 0,
      fatalCount: 0,
      hasInvalidCounts: false,
      state: "ok",
    });
    expect(outboxPendingLabel(outbox)).toBe("0");
  });

  it("marks pending outbox work without changing the count", () => {
    const outbox = normalizeOutboxDiag({ pendingCount: 3, fatalCount: 0 });

    expect(outbox).toMatchObject({
      pendingCount: 3,
      fatalCount: 0,
      hasInvalidCounts: false,
      state: "pending",
    });
    expect(outboxPendingLabel(outbox)).toBe("3");
  });

  it("marks fatal outbox work as higher severity than pending", () => {
    const outbox = normalizeOutboxDiag({ pendingCount: 3, fatalCount: 1 });

    expect(outbox).toMatchObject({
      pendingCount: 3,
      fatalCount: 1,
      hasInvalidCounts: false,
      state: "fatal",
    });
  });

  it("shows a readable loading label before diagnostics arrive", () => {
    expect(outboxPendingLabel(null)).toBe("讀取中");
  });

  it("does not display negative backend diagnostics as product counts", () => {
    const outbox = normalizeOutboxDiag({ pendingCount: -1, fatalCount: -1, isPollerRunning: true });

    expect(outbox).toMatchObject({
      pendingCount: null,
      fatalCount: null,
      hasInvalidCounts: true,
      state: "degraded",
      isPollerRunning: true,
    });
    expect(outboxPendingLabel(outbox)).toBe("診斷異常");
  });
});
