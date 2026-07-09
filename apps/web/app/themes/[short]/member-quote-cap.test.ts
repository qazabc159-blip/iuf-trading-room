import { describe, expect, it } from "vitest";
import { MEMBER_QUOTE_FETCH_CAP, shouldFetchMemberQuote } from "./member-quote-cap";

describe("shouldFetchMemberQuote", () => {
  it("allows fetching for indices before the cap", () => {
    expect(shouldFetchMemberQuote(0, 15)).toBe(true);
    expect(shouldFetchMemberQuote(14, 15)).toBe(true);
  });

  it("blocks fetching for indices at or past the cap", () => {
    expect(shouldFetchMemberQuote(15, 15)).toBe(false);
    expect(shouldFetchMemberQuote(140, 15)).toBe(false);
  });

  it("defaults to MEMBER_QUOTE_FETCH_CAP when no cap is passed", () => {
    expect(shouldFetchMemberQuote(MEMBER_QUOTE_FETCH_CAP - 1)).toBe(true);
    expect(shouldFetchMemberQuote(MEMBER_QUOTE_FETCH_CAP)).toBe(false);
  });

  it("with a 141-member theme (the real /themes/5g count), only the first cap members fetch — regression guard for unbounded fan-out", () => {
    const members = Array.from({ length: 141 }, (_, i) => `member-${i}`);
    const fetchDecisions = members.map((_, index) => shouldFetchMemberQuote(index));
    const fetchCount = fetchDecisions.filter(Boolean).length;

    expect(fetchCount).toBe(MEMBER_QUOTE_FETCH_CAP);
    // The first CAP members fetch, everyone after does not — no gaps, no fetches past the cap.
    expect(fetchDecisions.slice(0, MEMBER_QUOTE_FETCH_CAP).every(Boolean)).toBe(true);
    expect(fetchDecisions.slice(MEMBER_QUOTE_FETCH_CAP).some(Boolean)).toBe(false);
  });

  it("never exceeds the KGI 40-slot subscription ceiling even in isolation", () => {
    // This page's cap alone must stay well under MAX_SLOTS=40 (kgi-subscription-manager.ts)
    // since other pages/tiers share the same 40-slot pool.
    expect(MEMBER_QUOTE_FETCH_CAP).toBeLessThan(40);
  });
});
