import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";

import type { Company } from "@iuf-trading-room/contracts";

import {
  resolveCompanyId,
  __setCompaniesFetcherForTests,
  __resetCacheForTests,
  __seedCacheForTests
} from "./symbol-resolver";

function makeCompany(id: string, ticker: string): Company {
  return {
    id,
    name: `Company ${ticker}`,
    ticker,
    market: "TWSE",
    country: "TW",
    themeIds: [],
    chainPosition: "core",
    beneficiaryTier: "Core",
    exposure: { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 },
    validation: { capitalFlow: "n/a", consensus: "n/a", relativeStrength: "n/a" },
    notes: "test",
    updatedAt: "2026-04-29T00:00:00Z"
  };
}

describe("resolveCompanyId", () => {
  beforeEach(() => {
    __resetCacheForTests();
  });

  afterEach(() => {
    __resetCacheForTests();
    __setCompaniesFetcherForTests(null);
  });

  it("Test Case 1: cache hit returns id without calling getCompanies", async () => {
    __seedCacheForTests([["2330", "uuid-tsmc-001"]], Date.now() - 60 * 1000);

    let calls = 0;
    __setCompaniesFetcherForTests(async () => {
      calls += 1;
      return { data: [] };
    });

    const id = await resolveCompanyId("2330");
    assert.equal(id, "uuid-tsmc-001");
    assert.equal(calls, 0);
  });

  it("Test Case 2: stale cache triggers refetch and returns new id", async () => {
    __seedCacheForTests([["OLD", "uuid-old-000"]], Date.now() - 6 * 60 * 1000);

    let calls = 0;
    __setCompaniesFetcherForTests(async () => {
      calls += 1;
      return { data: [makeCompany("uuid-new-002", "3037")] };
    });

    const id = await resolveCompanyId("3037");
    assert.equal(calls, 1);
    assert.equal(id, "uuid-new-002");
  });

  it("Test Case 3: missing symbol after fresh load returns null", async () => {
    let calls = 0;
    __setCompaniesFetcherForTests(async () => {
      calls += 1;
      return {
        data: [
          makeCompany("uuid-tsmc-001", "2330"),
          makeCompany("uuid-mtk-002", "2454")
        ]
      };
    });

    const id = await resolveCompanyId("FAKE");
    assert.equal(calls, 1);
    assert.equal(id, null);
  });

  it("normalizes case and trims whitespace", async () => {
    __seedCacheForTests([["2330", "uuid-tsmc-001"]]);
    __setCompaniesFetcherForTests(async () => ({ data: [] }));

    assert.equal(await resolveCompanyId("  2330  "), "uuid-tsmc-001");
    assert.equal(await resolveCompanyId("2330"), "uuid-tsmc-001");
  });

  it("returns null when fetcher throws and cache is empty", async () => {
    __setCompaniesFetcherForTests(async () => {
      throw new Error("network");
    });

    const id = await resolveCompanyId("2330");
    assert.equal(id, null);
  });

  it("skips companies with empty ticker during cache build", async () => {
    __setCompaniesFetcherForTests(async () => ({
      data: [
        { ...makeCompany("uuid-empty", ""), ticker: "" },
        makeCompany("uuid-real", "2330")
      ]
    }));

    assert.equal(await resolveCompanyId(""), null);
    assert.equal(await resolveCompanyId("2330"), "uuid-real");
  });
});
