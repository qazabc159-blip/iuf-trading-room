import { describe, expect, it } from "vitest";

import { normalizeBriefSearchResponse } from "./api";

describe("normalizeBriefSearchResponse", () => {
  it("normalizes the API items/total/search_mode contract for the brief search UI", () => {
    const result = normalizeBriefSearchResponse({
      items: [{
        id: "brief-1",
        date: "2026-06-19",
        title: "市場總覽",
        summary_preview: "AI 與半導體供應鏈摘要",
        matched_in: "body",
        rank: 0.75,
      }],
      total: 1,
      limit: 10,
      offset: 0,
      search_mode: "ilike",
    }, { q: "AI", limit: 10 });

    expect(result).not.toBeNull();
    expect(result?.count).toBe(1);
    expect(result?.fallback).toBe(true);
    expect(result?.results[0]).toMatchObject({
      id: "brief-1",
      status: "published",
      matchedIn: "body",
      sections: [{
        heading: "市場總覽",
        body: "AI 與半導體供應鏈摘要",
      }],
    });
  });

  it("keeps compatibility with the previous results envelope", () => {
    const legacy = {
      query: "AI",
      from: "",
      to: "",
      limit: 10,
      offset: 0,
      count: 0,
      results: [],
      fallback: false,
    };
    expect(normalizeBriefSearchResponse({ data: legacy }, { q: "AI" })).toEqual(legacy);
  });
});
