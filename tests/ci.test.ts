import assert from "node:assert/strict";
import test from "node:test";

import { signalCreateInputSchema } from "../packages/contracts/src/signal.ts";
import { MemoryTradingRoomRepository } from "../packages/domain/src/memory-repository.ts";
import { parseGraphData } from "../packages/integrations/src/my-tw-coverage/graph-parser.ts";

test("signal schema applies expected defaults", () => {
  const parsed = signalCreateInputSchema.parse({
    category: "industry",
    direction: "bullish",
    title: "Optics demand inflects",
    confidence: 4
  });

  assert.equal(parsed.summary, "");
  assert.deepEqual(parsed.themeIds, []);
  assert.deepEqual(parsed.companyIds, []);
});

test("graph parser extracts companies and relation types", () => {
  const graph = {
    nodes: [
      { id: "Acme Optics", count: 4, category: "taiwan_company" },
      { id: "NVIDIA", count: 10, category: "international_company" },
      { id: "CPO", count: 7, category: "technology" }
    ],
    links: [
      { source: "Acme Optics", target: "CPO", value: 3 },
      { source: "NVIDIA", target: "Acme Optics", value: 2 }
    ]
  };

  const parsed = parseGraphData(JSON.stringify(graph), "network/graph_data.json");

  assert.equal(parsed.companies.length, 2);
  assert.deepEqual(
    parsed.companies.map((company) => company.displayName).sort(),
    ["Acme Optics", "NVIDIA"]
  );
  assert.equal(parsed.relations.length, 2);
  assert.equal(parsed.relations[0]?.relationType, "technology");
  assert.equal(parsed.relations[1]?.relationType, "co_occurrence");
});

test("memory repository supports core research-to-review loop", async () => {
  const repo = new MemoryTradingRoomRepository();

  const theme = await repo.createTheme({
    name: "AI Optics Expansion",
    marketState: "Selective Attack",
    lifecycle: "Discovery",
    priority: 4,
    thesis: "Optical interconnect demand is broadening.",
    whyNow: "1.6T discussion is moving from prototypes into budgeting.",
    bottleneck: "Module capacity"
  });

  const company = await repo.createCompany({
    name: "Photon Switch",
    ticker: "PHTN",
    market: "NASDAQ",
    country: "United States",
    themeIds: [theme.id],
    chainPosition: "Optical switching",
    beneficiaryTier: "Direct",
    exposure: {
      volume: 5,
      asp: 4,
      margin: 3,
      capacity: 4,
      narrative: 4
    },
    validation: {
      capitalFlow: "Institutions adding exposure.",
      consensus: "Revisions turning up.",
      relativeStrength: "Outperforming peers."
    },
    notes: "Higher-beta optics candidate."
  });

  const signal = await repo.createSignal({
    category: "industry",
    direction: "bullish",
    title: "Optics lead times extend",
    summary: "Lead indicators suggest more spending urgency.",
    confidence: 4,
    themeIds: [theme.id],
    companyIds: [company.id]
  });

  const plan = await repo.createTradePlan({
    companyId: company.id,
    status: "ready",
    entryPlan: "Buy on pullback into reclaimed breakout.",
    invalidationPlan: "Exit on failed retest.",
    targetPlan: "Scale out into prior high.",
    riskReward: "1:3",
    notes: "Pair with theme validation."
  });

  const review = await repo.createReview({
    tradePlanId: plan.id,
    outcome: "Took partials into strength.",
    attribution: "Thesis and timing aligned.",
    lesson: "Add faster once signal quality confirms.",
    setupTags: ["theme", "breakout"],
    executionQuality: 4
  });

  const brief = await repo.createBrief({
    date: "2026-04-13",
    marketState: "Balanced",
    sections: [
      {
        heading: "Optics",
        body: "Demand remains healthy."
      }
    ],
    generatedBy: "manual",
    status: "draft"
  });

  assert.equal((await repo.listThemes()).some((item) => item.id === theme.id), true);
  assert.equal((await repo.listCompanies(theme.id)).some((item) => item.id === company.id), true);
  assert.equal((await repo.listSignals({ themeId: theme.id })).some((item) => item.id === signal.id), true);
  assert.equal(
    (await repo.listTradePlans({ companyId: company.id })).some((item) => item.id === plan.id),
    true
  );
  assert.equal(
    (await repo.listReviews({ tradePlanId: plan.id })).some((item) => item.id === review.id),
    true
  );
  assert.equal((await repo.listBriefs()).some((item) => item.id === brief.id), true);
});
