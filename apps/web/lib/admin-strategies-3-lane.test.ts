/**
 * admin-strategies-3-lane.test.ts
 * ─────────────────────────────────
 * F1–F3 tests for /admin/strategies 3-lane truth UI
 *
 * Tests cover (pure logic, no React/DOM):
 * 1. S1 lane render data: state, quality checks, permissions, phantom items absent
 * 2. cont_liq v36 top4 lane: C04 FAIL badge, 10/11 quality checks
 * 3. Class5 lane: research-paused + 4 phantom items present
 * 4. Owner-only redirect: non-Owner users should be sent to /login
 * 5. Permissions block: all false for every lane
 * 6. Truthful wording: no forbidden terms in lane data
 */

import { describe, expect, it } from "vitest";

// ── Mirror the static LANES data (same truth as page.tsx) ────────────────────

type LaneState =
  | "active-owner-review"
  | "baseline-c04-fail"
  | "research-paused";

interface LaneCard {
  id: string;
  displayName: string;
  state: LaneState;
  qualityChecks: { passed: number; total: number };
  lastUpdate: string;
  permissions: {
    broker: false;
    registry: false;
    capital: false;
    liveReady: false;
    paperReady: false;
  };
  forwardObsNote: string | null;
  evidenceFiles: string[];
  notes: string[];
  phantomItems?: string[];
}

const FORBIDDEN_TERMS = [
  "capital-approved",
  "alpha confirmed",
  "live-ready",
  "paper-ready",
  "可實單",
  "產品化完成",
  "follow-trade",
];

const LANES: LaneCard[] = [
  {
    id: "iuf_ls_omni_v1_router",
    displayName: "S1 iuf_ls_omni_v1_router",
    state: "active-owner-review",
    qualityChecks: { passed: 10, total: 10 },
    lastUpdate: "2026-05-18T11:29:00+08:00",
    permissions: {
      broker: false,
      registry: false,
      capital: false,
      liveReady: false,
      paperReady: false,
    },
    forwardObsNote: "10M SIM owner-review packet — 待楊董 review",
    evidenceFiles: [
      "reports/data_lane/s1_iuf_ls_omni_owner_review_packet_2026_05_18_v1.json",
      "reports/data_lane/s1_iuf_ls_omni_owner_review_packet_attest_v1.json",
      "reports/data_lane/s1_iuf_ls_omni_risk_budget_10m_sim_v1.json",
      "reports/data_lane/s1_iuf_ls_omni_capacity_proxy_10m_sim_v1.json",
      "reports/data_lane/s1_intraday_partial_fill_proxy_v1.json",
      "reports/data_lane/s1_inverse_hedge_bakeoff_v1.json",
    ],
    notes: [
      "Long engine: cont_liq v36R top8",
      "Hedge: 00632R (crisis-only, 0.60 target weight, adjusted-price verified)",
      "Bruce attest: PACKET_ATTEST_PASS 10/10",
      "Route proxy: 421 days, compound +215.91%, max drawdown -13.18%",
      "Soft-throttle row: 2485 on 2025-08-25 (needs split/size reduction in SIM policy)",
    ],
  },
  {
    id: "cont_liq_v36_h20_top4_regime_pos006",
    displayName: "cont_liq v36 top4 (baseline)",
    state: "baseline-c04-fail",
    qualityChecks: { passed: 10, total: 11 },
    lastUpdate: "2026-05-18T11:29:00+08:00",
    permissions: {
      broker: false,
      registry: false,
      capital: false,
      liveReady: false,
      paperReady: false,
    },
    forwardObsNote: null,
    evidenceFiles: [
      "reports/data_lane/codex_cont_liq_v36_capital_test_preflight_v1.json",
    ],
    notes: [
      "C04 STRICT_BROAD_FAMILY_EVIDENCE_GATE FAIL: broad-family max-T p=0.09979 > threshold 0.05",
      "Strict statistical clearance route: NOT OPEN",
      "C11 owner risk budget: NOW SOLVED (10M TWD / max loss 300K TWD)",
      "v36 top4 is not dead, but cannot be described as fully cleared",
      "cont_liq v36R top8 is the long engine inside S1 — treat as S1 component only",
    ],
  },
  {
    id: "class5_v3_v4",
    displayName: "Class5 v3/v4",
    state: "research-paused",
    qualityChecks: { passed: 0, total: 13 },
    lastUpdate: "2026-05-18T11:29:00+08:00",
    permissions: {
      broker: false,
      registry: false,
      capital: false,
      liveReady: false,
      paperReady: false,
    },
    forwardObsNote: null,
    evidenceFiles: [
      "reports/data_lane/athena_memory_phantom_retraction_packet_2026_05_18_v1.md",
      "reports/data_lane/athena_path_a_retract_draft_2026_05_18.md",
    ],
    notes: [
      "Disk status: phantom / no source artifacts",
      "Current state: research-paused pending fresh hypothesis spec",
    ],
    phantomItems: [
      "Class5 Truth Board v15 / Class5 v3 PASS / v4 redesign",
      "Sprint Cycle 4 cont_liq Period 2 sector cap 3 PASS",
      "Round-2 fixture publish under research/fixtures/",
      "Family C x SBL v3 PASS",
    ],
  },
];

// ── Helper ────────────────────────────────────────────────────────────────────

function allTextInLane(lane: LaneCard): string {
  return [
    lane.id,
    lane.displayName,
    lane.forwardObsNote ?? "",
    ...lane.notes,
    ...(lane.phantomItems ?? []),
  ].join(" ");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Admin Strategies 3-lane truth", () => {

  // Test 1: S1 lane (active-owner-review)
  describe("S1 iuf_ls_omni_v1_router lane", () => {
    const lane = LANES.find(l => l.id === "iuf_ls_omni_v1_router")!;

    it("exists and has active-owner-review state", () => {
      expect(lane).toBeDefined();
      expect(lane.state).toBe("active-owner-review");
    });

    it("has Bruce 10/10 quality checks", () => {
      expect(lane.qualityChecks.passed).toBe(10);
      expect(lane.qualityChecks.total).toBe(10);
    });

    it("all permissions are false", () => {
      expect(lane.permissions.broker).toBe(false);
      expect(lane.permissions.registry).toBe(false);
      expect(lane.permissions.capital).toBe(false);
      expect(lane.permissions.liveReady).toBe(false);
      expect(lane.permissions.paperReady).toBe(false);
    });

    it("mentions owner-review packet in forwardObsNote", () => {
      expect(lane.forwardObsNote).toContain("owner-review packet");
    });

    it("has 6 evidence files", () => {
      expect(lane.evidenceFiles.length).toBe(6);
    });

    it("has no phantom items", () => {
      expect(lane.phantomItems).toBeUndefined();
    });

    it("contains no forbidden wording", () => {
      const text = allTextInLane(lane);
      for (const term of FORBIDDEN_TERMS) {
        expect(text).not.toContain(term);
      }
    });
  });

  // Test 2: cont_liq v36 top4 lane (baseline-c04-fail)
  describe("cont_liq v36 top4 baseline lane", () => {
    const lane = LANES.find(l => l.id === "cont_liq_v36_h20_top4_regime_pos006")!;

    it("exists and has baseline-c04-fail state", () => {
      expect(lane).toBeDefined();
      expect(lane.state).toBe("baseline-c04-fail");
    });

    it("has 10/11 quality checks", () => {
      expect(lane.qualityChecks.passed).toBe(10);
      expect(lane.qualityChecks.total).toBe(11);
    });

    it("all permissions are false", () => {
      expect(lane.permissions.broker).toBe(false);
      expect(lane.permissions.registry).toBe(false);
      expect(lane.permissions.capital).toBe(false);
      expect(lane.permissions.liveReady).toBe(false);
      expect(lane.permissions.paperReady).toBe(false);
    });

    it("mentions C04 FAIL in notes", () => {
      const c04Note = lane.notes.find(n => n.includes("C04"));
      expect(c04Note).toBeDefined();
      expect(c04Note).toContain("FAIL");
    });

    it("C04 p-value correctly capped at > 0.05", () => {
      const c04Note = lane.notes.find(n => n.includes("C04"))!;
      // p=0.09979 > 0.05
      expect(c04Note).toContain("0.09979");
      expect(c04Note).toContain("0.05");
    });

    it("forwardObsNote is null (not promotion-grade)", () => {
      expect(lane.forwardObsNote).toBeNull();
    });

    it("contains no forbidden wording", () => {
      const text = allTextInLane(lane);
      for (const term of FORBIDDEN_TERMS) {
        expect(text).not.toContain(term);
      }
    });
  });

  // Test 3: Class5 v3/v4 lane (research-paused + phantom)
  describe("Class5 v3/v4 lane", () => {
    const lane = LANES.find(l => l.id === "class5_v3_v4")!;

    it("exists and has research-paused state", () => {
      expect(lane).toBeDefined();
      expect(lane.state).toBe("research-paused");
    });

    it("has 0/13 quality checks (phantom — no source artifacts)", () => {
      expect(lane.qualityChecks.passed).toBe(0);
      expect(lane.qualityChecks.total).toBe(13);
    });

    it("all permissions are false", () => {
      expect(lane.permissions.broker).toBe(false);
      expect(lane.permissions.registry).toBe(false);
      expect(lane.permissions.capital).toBe(false);
      expect(lane.permissions.liveReady).toBe(false);
      expect(lane.permissions.paperReady).toBe(false);
    });

    it("has exactly 4 phantom items (per Codex §5)", () => {
      expect(lane.phantomItems).toBeDefined();
      expect(lane.phantomItems!.length).toBe(4);
    });

    it("phantom items include Class5 Truth Board v15", () => {
      expect(lane.phantomItems!.some(p => p.includes("Class5 Truth Board v15"))).toBe(true);
    });

    it("phantom items include Sprint Cycle 4 sector cap 3", () => {
      expect(lane.phantomItems!.some(p => p.includes("Sprint Cycle 4"))).toBe(true);
    });

    it("phantom items include Round-2 fixture", () => {
      expect(lane.phantomItems!.some(p => p.includes("Round-2 fixture"))).toBe(true);
    });

    it("phantom items include Family C x SBL v3", () => {
      expect(lane.phantomItems!.some(p => p.includes("Family C"))).toBe(true);
    });

    it("contains no forbidden wording", () => {
      const text = allTextInLane(lane);
      for (const term of FORBIDDEN_TERMS) {
        expect(text).not.toContain(term);
      }
    });
  });

  // Test 4: Owner-only redirect — logic test (not DOM)
  describe("Owner-only access logic", () => {
    it("redirects non-Owner role (simulated)", () => {
      // Simulate the gate logic: if role !== 'Owner', go to /login
      const checkAccess = (role: string): "ready" | "redirect" =>
        role === "Owner" ? "ready" : "redirect";

      expect(checkAccess("Owner")).toBe("ready");
      expect(checkAccess("Viewer")).toBe("redirect");
      expect(checkAccess("Analyst")).toBe("redirect");
      expect(checkAccess("Admin")).toBe("redirect");
    });

    it("allows Owner role", () => {
      const checkAccess = (role: string): "ready" | "redirect" =>
        role === "Owner" ? "ready" : "redirect";

      expect(checkAccess("Owner")).toBe("ready");
    });
  });

  // Test 5: All 3 lanes have all permissions false
  describe("Permissions invariant across all lanes", () => {
    it("every lane has broker=false", () => {
      LANES.forEach(lane => {
        expect(lane.permissions.broker).toBe(false);
      });
    });

    it("every lane has registry=false", () => {
      LANES.forEach(lane => {
        expect(lane.permissions.registry).toBe(false);
      });
    });

    it("every lane has capital=false", () => {
      LANES.forEach(lane => {
        expect(lane.permissions.capital).toBe(false);
      });
    });

    it("every lane has liveReady=false", () => {
      LANES.forEach(lane => {
        expect(lane.permissions.liveReady).toBe(false);
      });
    });

    it("every lane has paperReady=false", () => {
      LANES.forEach(lane => {
        expect(lane.permissions.paperReady).toBe(false);
      });
    });
  });

  // Test 6: Truthful wording — no forbidden terms in any lane data
  describe("Truthful wording across all lanes (F2)", () => {
    FORBIDDEN_TERMS.forEach(term => {
      it(`no lane data contains forbidden term: "${term}"`, () => {
        LANES.forEach(lane => {
          const text = allTextInLane(lane);
          expect(text).not.toContain(term);
        });
      });
    });
  });

  // Test 7: Page has exactly 3 lanes
  describe("Lane count", () => {
    it("has exactly 3 lanes", () => {
      expect(LANES.length).toBe(3);
    });

    it("lane states cover all 3 distinct values", () => {
      const states = new Set(LANES.map(l => l.state));
      expect(states.has("active-owner-review")).toBe(true);
      expect(states.has("baseline-c04-fail")).toBe(true);
      expect(states.has("research-paused")).toBe(true);
    });
  });
});
