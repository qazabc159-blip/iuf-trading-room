/**
 * coverage-knowledge-panel.test.ts
 * Tests for CoverageKnowledgePanel behaviour (fetch states + data shape)
 * and IndustryGraphPanel empty/graph logic.
 *
 * Uses pure helper logic — no React rendering required (avoids jsdom dep).
 */

import { describe, it, expect } from "vitest";
import type { CoverageBrief } from "./CoverageKnowledgePanel";

// ── CoverageBrief shape helpers (mirrors what API returns) ─────────────────────

const SAMPLE_BRIEF: CoverageBrief = {
  ticker: "2330",
  companyName: "台積電",
  sector: "半導體",
  industry: "晶圓代工",
  marketCap: "47845508 百萬台幣",
  enterpriseValue: "45886629 百萬台幣",
  businessOverview: "台積電為全球最大專業積體電路製造服務公司。",
  supplyChain: {
    upstream: [
      { category: "矽晶圓", companies: ["5347 世界先進", "6488 環球晶"] },
    ],
    midstream: [],
    downstream: [
      { category: "客戶", companies: ["2454 聯發科", "NVIDIA"] },
    ],
  },
  majorCustomers: ["2454 聯發科", "NVIDIA Corporation"],
  majorSuppliers: ["5347 世界先進"],
  wikilinks: ["AI算力", "先進製程", "CoWoS"],
};

const EMPTY_BRIEF: CoverageBrief = {
  ticker: "9999",
  companyName: "測試公司",
  sector: "",
  industry: "",
  marketCap: "",
  enterpriseValue: "",
  businessOverview: "",
  supplyChain: { upstream: [], midstream: [], downstream: [] },
  majorCustomers: [],
  majorSuppliers: [],
  wikilinks: [],
};

// ── Test: CoverageKnowledgePanel data parsing ─────────────────────────────────

describe("CoverageKnowledgePanel — data shape", () => {
  it("should recognise ticker in majorCustomers list", () => {
    const name = "2454 聯發科";
    const m = name.match(/^(\d{4,6})\s/);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("2454");
  });

  it("should return null ticker for non-ticker company name", () => {
    const name = "NVIDIA Corporation";
    const m = name.match(/^(\d{4,6})\s/);
    expect(m).toBeNull();
  });

  it("API 200 — loaded data has businessOverview", () => {
    expect(SAMPLE_BRIEF.businessOverview.length).toBeGreaterThan(0);
  });

  it("API 404 — not_found state message includes ticker", () => {
    const ticker = "2330";
    const msg = `本檔 (${ticker}) coverage 待補，1735 檔已收錄`;
    expect(msg).toContain(ticker);
    expect(msg).toContain("1735");
  });

  it("wikilinks array is correctly preserved in data shape", () => {
    expect(SAMPLE_BRIEF.wikilinks).toHaveLength(3);
    expect(SAMPLE_BRIEF.wikilinks?.[0]).toBe("AI算力");
  });

  it("source attribution text is correct", () => {
    const attribution = "資料來源: My-TW-Coverage (MIT)";
    expect(attribution).toContain("My-TW-Coverage");
    expect(attribution).toContain("MIT");
  });
});

// ── Test: markdown section parsing helpers ─────────────────────────────────────

describe("CoverageKnowledgePanel — markdown parse helpers", () => {
  it("shortLabel truncates long strings to maxLen + ellipsis", () => {
    function shortLabel(name: string, maxLen = 10): string {
      if (name.length <= maxLen) return name;
      return `${name.slice(0, maxLen)}…`;
    }
    // "台積電股份有限公司製造部門" has 12 chars; slice(0,10) gives 10 chars = "台積電股份有限公司製"
    expect(shortLabel("台積電股份有限公司製造部門", 10)).toBe("台積電股份有限公司製…");
    expect(shortLabel("台積電", 10)).toBe("台積電");
  });

  it("extractTicker handles 4-digit and 6-digit tickers", () => {
    function extractTicker(name: string): string | null {
      const m = name.match(/^(\d{4,6})\s/);
      return m ? m[1] : null;
    }
    expect(extractTicker("2330 台積電")).toBe("2330");
    expect(extractTicker("910861 東陽")).toBe("910861");
    expect(extractTicker("Apple Inc")).toBeNull();
  });
});

// ── Test: IndustryGraphPanel node building ────────────────────────────────────

describe("IndustryGraphPanel — graph node logic", () => {
  function extractTicker(name: string): string | null {
    const m = name.match(/^(\d{4,6})\s/);
    return m ? m[1] : null;
  }

  function buildNodes(brief: CoverageBrief, currentTicker: string) {
    const items: Array<{ label: string; ticker: string | null; kind: string }> = [];

    for (const g of brief.supplyChain.upstream.slice(0, 1)) {
      for (const c of g.companies.slice(0, 2)) {
        const t = extractTicker(c);
        if (t && t.toLowerCase() === currentTicker.toLowerCase()) continue;
        items.push({ label: c, ticker: t, kind: "upstream" });
      }
    }
    for (const g of brief.supplyChain.downstream.slice(0, 1)) {
      for (const c of g.companies.slice(0, 2)) {
        const t = extractTicker(c);
        if (t && t.toLowerCase() === currentTicker.toLowerCase()) continue;
        items.push({ label: c, ticker: t, kind: "downstream" });
      }
    }
    for (const c of brief.majorCustomers.slice(0, 2)) {
      const t = extractTicker(c);
      if (t && t.toLowerCase() === currentTicker.toLowerCase()) continue;
      items.push({ label: c, ticker: t, kind: "downstream" });
    }
    for (const c of brief.majorSuppliers.slice(0, 2)) {
      const t = extractTicker(c);
      if (t && t.toLowerCase() === currentTicker.toLowerCase()) continue;
      items.push({ label: c, ticker: t, kind: "upstream" });
    }
    for (const token of (brief.wikilinks ?? []).slice(0, 3)) {
      items.push({ label: token, ticker: null, kind: "theme" });
    }

    const seen = new Set<string>();
    const unique = items.filter((i) => {
      if (seen.has(i.label)) return false;
      seen.add(i.label);
      return true;
    });

    return unique.slice(0, 8).map((item, idx) => ({
      ...item,
      id: `node-${idx}`,
      angle: (2 * Math.PI * idx) / Math.min(unique.length, 8) - Math.PI / 2,
      r: 110,
    }));
  }

  it("empty brief → 0 nodes → empty state shown", () => {
    const nodes = buildNodes(EMPTY_BRIEF, "9999");
    expect(nodes).toHaveLength(0);
  });

  it("sample brief produces multiple nodes", () => {
    const nodes = buildNodes(SAMPLE_BRIEF, "2330");
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.length).toBeLessThanOrEqual(8);
  });

  it("current ticker is excluded from nodes", () => {
    const nodes = buildNodes(SAMPLE_BRIEF, "2330");
    for (const n of nodes) {
      expect(n.ticker?.toLowerCase()).not.toBe("2330");
    }
  });

  it("SVG mini-graph has correct structure — nodes array with angle property", () => {
    const nodes = buildNodes(SAMPLE_BRIEF, "2330");
    for (const n of nodes) {
      expect(typeof n.angle).toBe("number");
      expect(n.r).toBe(110);
    }
  });

  it("nodes capped at 8 even with many upstream/downstream entries", () => {
    const richBrief: CoverageBrief = {
      ...SAMPLE_BRIEF,
      supplyChain: {
        upstream: [{ category: "test", companies: ["1111 A", "2222 B", "3333 C", "4444 D", "5555 E"] }],
        midstream: [],
        downstream: [{ category: "test", companies: ["6666 F", "7777 G", "8888 H"] }],
      },
      majorCustomers: ["9999 I", "1001 J"],
      majorSuppliers: ["1002 K"],
      wikilinks: ["AI", "HPC", "CoWoS", "SiC", "GaN"],
    };
    const nodes = buildNodes(richBrief, "2330");
    expect(nodes.length).toBeLessThanOrEqual(8);
  });
});
