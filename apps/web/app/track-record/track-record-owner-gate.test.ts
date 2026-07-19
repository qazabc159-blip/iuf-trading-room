import { describe, expect, it } from "vitest";

import { isTrackRecordOwnerSession } from "./track-record-owner-gate";

describe("isTrackRecordOwnerSession", () => {
  it("allows an Owner session through", () => {
    expect(isTrackRecordOwnerSession({ ok: true, role: "Owner" })).toBe(true);
  });

  it("gates a logged-in non-owner role (Analyst/Trader/Viewer/Admin)", () => {
    expect(isTrackRecordOwnerSession({ ok: true, role: "Analyst" })).toBe(false);
    expect(isTrackRecordOwnerSession({ ok: true, role: "Trader" })).toBe(false);
    expect(isTrackRecordOwnerSession({ ok: true, role: "Viewer" })).toBe(false);
    expect(isTrackRecordOwnerSession({ ok: true, role: "Admin" })).toBe(false);
  });

  it("gates a session-resolution failure (never fails open)", () => {
    expect(isTrackRecordOwnerSession({ ok: false })).toBe(false);
  });
});
