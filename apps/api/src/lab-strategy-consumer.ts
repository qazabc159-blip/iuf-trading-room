/**
 * lab-strategy-consumer.ts
 *
 * Read-only consumer for the IUF Quant Lab sanctioned strategy snapshot.
 *
 * Lab / TR Alignment Lock rules (2026-05-07):
 *   - TR NEVER writes to lab repo
 *   - TR NEVER fabricates strategy status or metrics
 *   - All candidates displayed with mandatory research-only disclaimer
 *   - No promotion wording / buy / sell / allocation % / 必賺 / 勝率
 *   - status must be exactly as lab publishes it (no rename / softening)
 *
 * Source of truth path:
 *   IUF_QUANT_LAB/research/finmind_sponsor_999_data_factory/codex_next/
 *     final_strategy_count_board_vNN.json
 *
 * This module is loaded by:
 *   1. GET /api/v1/lab/strategy-snapshot — REST endpoint (Owner/Admin/Analyst)
 *   2. Axis 1 internal: fallback when data/lab/strategies-snapshot.json is OUT_OF_FRAME
 *
 * Hard lines enforced here (not in caller):
 *   - researchOnly: true field always set — never removed
 *   - caveats array always includes "RESEARCH_ONLY: Not approved for paper/live"
 *   - status field preserved verbatim from lab JSON
 *   - counts_as_strategy_candidate=false rows excluded from candidates array
 *   - No Sharpe / equity / winRate / annualisedReturn ever emitted
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Lab JSON shape (final_strategy_count_board_vNN.json) ──────────────────────

type LabBoardRow = {
  candidate_id: string;
  counts_as_strategy_candidate: boolean;
  status: string;
  verdict: string;
  biggest_caveat: string;
  key_metrics: string;
  next_action: string;
};

type LabBoardJson = {
  schema: string;
  createdAtTaipei: string;
  current_strategy_count: {
    strong_candidates: number;
    strong_candidate_names: string[];
    do_we_have_3_strategy_candidates_now: boolean;
    portfolioVerdict?: string;
  };
  portfolioVerdict: string;
  rows: LabBoardRow[];
  selectedStrategy3?: string;
};

// ── Public output shape ───────────────────────────────────────────────────────

export type LabStrategyCandidate = {
  /** Verbatim candidate_id from lab board (e.g. "MAIN_execution_rank_buffer_top20") */
  strategyId: string;
  /** Human-friendly alias — same as strategyId (lab does not provide separate displayName) */
  displayName: string;
  /**
   * Status verbatim from lab JSON (e.g. "STRONG_CANDIDATE", "STRATEGY2_RS2060_CONFIRMED").
   * TR must never rename or soften this. Use labStatusDisplayWording() for UI text.
   */
  status: string;
  /**
   * Always "RESEARCH_ONLY" per Lab/TR alignment lock.
   * Lab hard line: no promotion wording until Athena/Bruce gate passes.
   */
  researchOnlyFlag: "RESEARCH_ONLY";
  /**
   * Mandatory UI disclaimer. Must be shown verbatim to end-users.
   * Not approved for paper/live. Awaiting Athena/Bruce gates.
   */
  disclaimer: string;
  /** Caveats from lab JSON biggest_caveat field + mandatory RESEARCH_ONLY caveat */
  caveats: string[];
  /** Pointer to lab governance source */
  labGovernanceSource: string;
  /** Lab next_action — informational only, no TR action implied */
  nextAction: string;
};

export type LabSnapshot = {
  /** Always true when this object is returned — confirms sanctioned source was used */
  sanctioned: true;
  /** Absolute path to lab JSON file that was read */
  sourcePath: string;
  /** Sprint id extracted from schema field (e.g. "v15") */
  sprintId: string;
  /** ISO timestamp from lab board createdAtTaipei */
  collectedAt: string;
  /**
   * Always true per Lab/TR alignment lock.
   * Hard line: only Athena/Bruce/楊董 can flip this to false (via new lab publication).
   */
  researchOnly: true;
  /** Lab portfolio-level verdict (e.g. "THREE_STRATEGY_PORTFOLIO_VALID_RESEARCH_SYSTEM") */
  portfolioVerdict: string;
  /** Only rows where counts_as_strategy_candidate=true */
  candidates: LabStrategyCandidate[];
  /** Count of strong candidates per lab board */
  strongCandidateCount: number;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const LAB_GOVERNANCE_SOURCE =
  "IUF_QUANT_LAB/research/finmind_sponsor_999_data_factory/codex_next/";

const MANDATORY_DISCLAIMER =
  "Research only · Not approved for paper/live · Awaiting Athena/Bruce gates";

const MANDATORY_CAVEAT =
  "RESEARCH_ONLY: Not approved for paper/live trading. Awaiting Athena/Bruce gate passage.";

// Sprint version to resolve — bump this when lab publishes a newer version
const CURRENT_SPRINT_VERSION = "v15";

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Resolve the path to the lab sanctioned snapshot JSON.
 *
 * Layout assumption:
 *   IUF_TRADING_ROOM_APP/   ← monorepo root (3 levels up from apps/api/src/)
 *   IUF_QUANT_LAB/          ← sibling directory to IUF_TRADING_ROOM_APP
 *
 * In Railway / prod this path does NOT exist (lab repo is not deployed).
 * loadLabSanctionedSnapshot() handles FileNotFound gracefully → returns null.
 */
function resolveLabJsonPaths(version: string): string[] {
  const __file = fileURLToPath(import.meta.url);
  const __dir = dirname(__file);
  // apps/api/src → ../../.. → monorepo root
  const monorepoRoot = join(__dir, "..", "..", "..");
  // Path 1: sibling IUF_QUANT_LAB (dev / local)
  const labRoot = join(monorepoRoot, "..", "IUF_QUANT_LAB");
  const sibling = join(
    labRoot,
    "research",
    "finmind_sponsor_999_data_factory",
    "codex_next",
    `final_strategy_count_board_${version}.json`
  );
  // Path 2: embedded snapshot (prod / Railway — lab JSON copied into TR repo)
  const embedded = join(
    monorepoRoot,
    "data",
    "lab",
    "sanctioned",
    `final_strategy_count_board_${version}.json`
  );
  return [sibling, embedded];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Load and parse the Lab sanctioned strategy snapshot.
 *
 * Returns null (never throws) when:
 *  - Lab JSON path does not exist (dev env / prod Railway — lab not deployed)
 *  - JSON is malformed
 *  - No rows with counts_as_strategy_candidate=true
 *
 * Callers must treat null as meta.source='unavailable'.
 */
export function loadLabSanctionedSnapshot(): LabSnapshot | null {
  const candidatePaths = resolveLabJsonPaths(CURRENT_SPRINT_VERSION);

  let raw: string | null = null;
  let resolvedPath: string | null = null;
  for (const path of candidatePaths) {
    try {
      raw = readFileSync(path, "utf-8");
      resolvedPath = path;
      break;
    } catch {
      // try next
    }
  }
  if (raw === null || resolvedPath === null) {
    console.warn(
      `[lab-consumer] Lab snapshot not found at any candidate path (sibling IUF_QUANT_LAB or embedded data/lab/sanctioned) — returning null`
    );
    return null;
  }
  const jsonPath = resolvedPath;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[lab-consumer] Lab snapshot JSON parse failed — returning null");
    return null;
  }

  // Shape validation
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("rows" in parsed) ||
    !Array.isArray((parsed as LabBoardJson).rows)
  ) {
    console.warn("[lab-consumer] Lab snapshot missing rows array — returning null");
    return null;
  }

  const board = parsed as LabBoardJson;

  // Filter to only counts_as_strategy_candidate=true rows
  const candidateRows = board.rows.filter(
    (row) => row.counts_as_strategy_candidate === true && row.candidate_id !== "none"
  );

  if (candidateRows.length === 0) {
    console.warn("[lab-consumer] No strategy candidates in lab snapshot — returning null");
    return null;
  }

  // Extract sprint id from schema field (e.g. "final_strategy_count_board_v15" → "v15")
  const sprintIdMatch = (board.schema ?? "").match(/v(\d+)$/);
  const sprintId = sprintIdMatch ? `v${sprintIdMatch[1]}` : CURRENT_SPRINT_VERSION;

  const candidates: LabStrategyCandidate[] = candidateRows.map((row) => ({
    strategyId: row.candidate_id,
    displayName: row.candidate_id,
    status: row.status,
    researchOnlyFlag: "RESEARCH_ONLY" as const,
    disclaimer: MANDATORY_DISCLAIMER,
    caveats: [
      MANDATORY_CAVEAT,
      ...(row.biggest_caveat ? [row.biggest_caveat] : [])
    ],
    labGovernanceSource: LAB_GOVERNANCE_SOURCE,
    nextAction: row.next_action
  }));

  return {
    sanctioned: true,
    sourcePath: jsonPath,
    sprintId,
    collectedAt: board.createdAtTaipei,
    researchOnly: true,
    portfolioVerdict: board.portfolioVerdict ?? board.current_strategy_count?.portfolioVerdict ?? "RESEARCH_SYSTEM",
    candidates,
    strongCandidateCount: board.current_strategy_count?.strong_candidates ?? candidateRows.length
  };
}

/**
 * Map lab status enum to TR display wording.
 * Per alignment lock: must use lab wording, not softened translations.
 */
export function labStatusDisplayWording(status: string): string {
  const map: Record<string, string> = {
    STRONG_CANDIDATE: "研究系統 / 未批准 TR 推廣",
    STRATEGY2_RS2060_CONFIRMED: "研究系統 / 未批准 TR 推廣",
    STRATEGY3_TURNOVER_REPAIRED: "研究系統 / 未批准 TR 推廣",
    RESEARCH_SYSTEM: "研究系統 / 未批准 TR 推廣",
    BACKTESTED_RAW: "研究 raw",
    KILL_NO_EDGE: "研究 kill / 沒 edge",
    KILL_INFORMATIVE: "研究 kill / informative only",
    PAPER_PROPOSED: "Paper 候選 / 待 Bruce 雙簽",
    PAPER_LIVE: "Paper 進行中",
    LIVE_CANDIDATE: "Live 候選 / 待楊董明示",
    IN_LIVE: "Live 進行中",
    RETIRED: "退役",
    NO_APPROVED_STRATEGY: "目前無 approved 策略可推廣",
    PROBATION: "試察期",
    LIBRARY_ONLY: "函式庫元件 / 非獨立策略",
    FALLBACK_NOT_USED: "備援（未啟用）",
    META_ALLOCATOR_RESEARCH_LEAD_NEEDS_APPEND: "研究領先 / 需補充資料",
    HOLD: "暫停 / 無當前 edge"
  };
  return map[status] ?? `研究系統 (${status})`;
}
