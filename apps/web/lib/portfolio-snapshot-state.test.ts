import { describe, expect, it } from "vitest";

import { portfolioSnapshotStateCopy } from "./portfolio-snapshot-state";

describe("portfolioSnapshotStateCopy", () => {
  it("describes an empty live API without pretending data exists", () => {
    const copy = portfolioSnapshotStateCopy({ phase: "empty", count: 0 });

    expect(copy.title).toBe("Portfolio Snapshot EMPTY");
    expect(copy.detail).toContain("read API 已可用");
    expect(copy.endpoint).toBe("/api/v1/portfolio/snapshots");
    expect(copy.owner).toContain("Elva/Jason");
    expect(copy.nextAction).toContain("snapshot writer");
    expect(`${copy.title} ${copy.detail} ${copy.nextAction}`).not.toContain("0037");
    expect(`${copy.title} ${copy.detail} ${copy.nextAction}`).not.toContain("migration");
  });

  it("describes blocked API reads with status and owner", () => {
    const copy = portfolioSnapshotStateCopy({ phase: "blocked", count: 0, error: "500" });

    expect(copy.title).toBe("Portfolio Snapshot BLOCKED");
    expect(copy.detail).toContain("HTTP 500");
    expect(copy.endpoint).toBe("/api/v1/portfolio/snapshots");
    expect(copy.nextAction).toContain("production route/session");
  });

  it("describes live snapshot counts without changing the source truth", () => {
    const copy = portfolioSnapshotStateCopy({ phase: "live", count: 3 });

    expect(copy.title).toContain("3 筆");
    expect(copy.detail).toContain("後端回傳");
    expect(copy.nextAction).toContain("diff");
  });
});
