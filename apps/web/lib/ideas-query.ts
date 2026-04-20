import type {
  StrategyIdeasDecisionFilter,
  StrategyIdeasDecisionMode,
  StrategyIdeasQualityFilter,
  StrategyIdeasSort
} from "@iuf-trading-room/contracts";

import type { StrategyIdeasQueryParams } from "./api";

// ── Enum whitelists ────────────────────────────────────────────
// Mirror the zod enums on packages/contracts/src/strategy.ts so the parser
// silently drops malformed URL input instead of letting "?sort=pwned" through
// to the query state. If contracts adds a value, update these sets.
const DECISION_MODES: ReadonlySet<StrategyIdeasDecisionMode> = new Set([
  "strategy",
  "paper",
  "execution"
]);

const DECISION_FILTERS: ReadonlySet<StrategyIdeasDecisionFilter> = new Set([
  "allow",
  "review",
  "block",
  "usable_only"
]);

const QUALITY_FILTERS: ReadonlySet<StrategyIdeasQualityFilter> = new Set([
  "strategy_ready",
  "exclude_insufficient"
]);

const SORTS: ReadonlySet<StrategyIdeasSort> = new Set([
  "score",
  "signal_strength",
  "signal_recency",
  "theme_rank",
  "symbol"
]);

// Matches strategyIdeasQuerySchema limit (1..50) + signalDays (1..90). Keep
// bounds aligned so a pre-populated /ideas view doesn't immediately throw on
// the server when a crafted URL slips through.
const LIMIT_MIN = 1;
const LIMIT_MAX = 50;
const SIGNAL_DAYS_MIN = 1;
const SIGNAL_DAYS_MAX = 90;

function parseIntInRange(
  raw: string | null,
  min: number,
  max: number
): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return undefined;
  }
  return n;
}

function parseBool(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

function cleanString(raw: string | null, maxLen: number): string | undefined {
  if (raw === null) return undefined;
  const v = raw.trim();
  if (!v || v.length > maxLen) return undefined;
  return v;
}

// Read ideas query state from a URLSearchParams-like object. Unknown or
// malformed fields are dropped silently — the page falls back to defaults
// for anything not explicitly provided.
export function parseIdeasQuery(
  params: URLSearchParams
): StrategyIdeasQueryParams {
  const out: StrategyIdeasQueryParams = {};

  const mode = params.get("decisionMode");
  if (mode && DECISION_MODES.has(mode as StrategyIdeasDecisionMode)) {
    out.decisionMode = mode as StrategyIdeasDecisionMode;
  }

  const decisionFilter = params.get("decisionFilter");
  if (
    decisionFilter &&
    DECISION_FILTERS.has(decisionFilter as StrategyIdeasDecisionFilter)
  ) {
    out.decisionFilter = decisionFilter as StrategyIdeasDecisionFilter;
  }

  const qualityFilter = params.get("qualityFilter");
  if (
    qualityFilter &&
    QUALITY_FILTERS.has(qualityFilter as StrategyIdeasQualityFilter)
  ) {
    out.qualityFilter = qualityFilter as StrategyIdeasQualityFilter;
  }

  const sort = params.get("sort");
  if (sort && SORTS.has(sort as StrategyIdeasSort)) {
    out.sort = sort as StrategyIdeasSort;
  }

  const limit = parseIntInRange(params.get("limit"), LIMIT_MIN, LIMIT_MAX);
  if (limit !== undefined) out.limit = limit;

  const signalDays = parseIntInRange(
    params.get("signalDays"),
    SIGNAL_DAYS_MIN,
    SIGNAL_DAYS_MAX
  );
  if (signalDays !== undefined) out.signalDays = signalDays;

  const includeBlocked = parseBool(params.get("includeBlocked"));
  if (includeBlocked !== undefined) out.includeBlocked = includeBlocked;

  const market = cleanString(params.get("market"), 32);
  if (market !== undefined) out.market = market;

  const symbol = cleanString(params.get("symbol"), 32);
  if (symbol !== undefined) out.symbol = symbol.toUpperCase();

  const theme = cleanString(params.get("theme"), 120);
  if (theme !== undefined) out.theme = theme;

  const themeId = cleanString(params.get("themeId"), 64);
  if (themeId !== undefined) out.themeId = themeId;

  return out;
}

// Serialize an ideas query for the `/ideas?...` URL. Returns the bare query
// string (no leading "?") so callers can build `/ideas${qs ? "?" + qs : ""}`.
// Mirrors what `getStrategyIdeas` sends on the wire, so the pre-populated
// page requests the same set the API would for the saved run.
export function buildIdeasSearchString(query: StrategyIdeasQueryParams): string {
  const p = new URLSearchParams();
  if (query.limit !== undefined) p.set("limit", String(query.limit));
  if (query.signalDays !== undefined)
    p.set("signalDays", String(query.signalDays));
  if (query.includeBlocked !== undefined)
    p.set("includeBlocked", String(query.includeBlocked));
  if (query.market) p.set("market", query.market);
  if (query.themeId) p.set("themeId", query.themeId);
  if (query.theme) p.set("theme", query.theme);
  if (query.symbol) p.set("symbol", query.symbol);
  if (query.decisionMode) p.set("decisionMode", query.decisionMode);
  if (query.decisionFilter) p.set("decisionFilter", query.decisionFilter);
  if (query.qualityFilter) p.set("qualityFilter", query.qualityFilter);
  if (query.sort) p.set("sort", query.sort);
  return p.toString();
}
