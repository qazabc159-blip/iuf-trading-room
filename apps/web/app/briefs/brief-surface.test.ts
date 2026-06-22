import { describe, expect, it } from "vitest";

import type { ContentDraftEntry } from "@/lib/api";
import { latestTodayDraftOutcome } from "./brief-surface";

function draft(status: ContentDraftEntry["status"], updatedAt: string): ContentDraftEntry {
  return {
    id: `${status}-${updatedAt}`,
    workspaceId: "workspace",
    sourceJobId: null,
    targetTable: "daily_briefs",
    targetEntityId: "2026-06-22",
    payload: { date: "2026-06-22" },
    status,
    dedupeKey: `${status}-${updatedAt}`,
    producerVersion: "test",
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: status === "rejected" ? "directive false positive" : null,
    approvedRefId: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("latestTodayDraftOutcome", () => {
  it("shows a rejected draft instead of claiming no draft exists", () => {
    expect(latestTodayDraftOutcome([
      draft("rejected", "2026-06-22T01:01:19.000Z"),
    ])).toBe("rejected");
  });

  it("uses the newest draft when retries create multiple records", () => {
    expect(latestTodayDraftOutcome([
      draft("rejected", "2026-06-22T00:48:00.000Z"),
      draft("awaiting_review", "2026-06-22T01:05:00.000Z"),
    ])).toBe("awaiting_review");
  });
});
