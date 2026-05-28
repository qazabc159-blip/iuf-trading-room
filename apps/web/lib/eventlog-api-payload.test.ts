import { describe, expect, it } from "vitest";

import { unwrapEventLogApiPayload } from "./eventlog-api-payload";

describe("unwrapEventLogApiPayload", () => {
  it("keeps root-level event stream responses readable", () => {
    const payload = {
      streams: [{ streamType: "system", streamId: "server" }],
      meta: { count: 1 },
    };

    expect(unwrapEventLogApiPayload(payload)).toBe(payload);
  });

  it("keeps data-wrapped admin responses readable", () => {
    const data = { pendingCount: -1, fatalCount: -1, isPollerRunning: true };

    expect(unwrapEventLogApiPayload({ data })).toBe(data);
  });
});
