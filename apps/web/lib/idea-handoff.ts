import type {
  StrategyIdea,
  StrategyIdeaDirection,
  StrategyIdeaMarketDecision,
  StrategyIdeasDecisionMode,
  StrategyRunCompactIdea
} from "@iuf-trading-room/contracts";

// Minimum strategy context carried from /ideas → /portfolio so the trader
// arrives at the order ticket knowing which idea they're acting on and why.
// Kept intentionally small: the three things a human asks before sending an
// order — "which symbol?", "what did the idea say?", "can I trust it?".
export type IdeaHandoff = {
  symbol: string;
  companyName: string;
  market: string;
  direction: StrategyIdeaDirection;
  score: number;
  confidence: number;
  topThemeId: string | null;
  topThemeName: string | null;
  qualityGrade: StrategyIdea["quality"]["grade"];
  qualityReason: string;
  decision: StrategyIdeaMarketDecision;
  decisionMode: StrategyIdeasDecisionMode;
  primaryReason: string;
  capturedAt: string;
};

const STORAGE_KEY = "iuf:ideaHandoff";

function isBrowser() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function writeIdeaHandoff(payload: IdeaHandoff) {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage can be disabled or full; the handoff is best-effort.
  }
}

// Reads the handoff if and only if it matches the given symbol. Mismatched
// payloads (e.g. the user manually typed /portfolio?symbol=X while a stale
// handoff for Y sits in sessionStorage) are ignored so the card never
// misattributes context to the wrong ticker.
export function readIdeaHandoff(expectedSymbol: string | undefined): IdeaHandoff | null {
  if (!isBrowser() || !expectedSymbol) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IdeaHandoff;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.symbol?.toUpperCase() !== expectedSymbol.toUpperCase()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearIdeaHandoff() {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

// Build an IdeaHandoff from a full StrategyIdea — used by both /ideas and
// /runs/[id] so the handoff shape can't drift between the live and snapshot
// surfaces.
export function handoffFromIdea(
  item: StrategyIdea,
  mode: StrategyIdeasDecisionMode
): IdeaHandoff {
  const topTheme = item.topThemes[0] ?? null;
  return {
    symbol: item.symbol,
    companyName: item.companyName,
    market: item.market,
    direction: item.direction,
    score: item.score,
    confidence: item.confidence,
    topThemeId: topTheme?.themeId ?? null,
    topThemeName: topTheme?.name ?? null,
    qualityGrade: item.quality.grade,
    qualityReason: item.quality.primaryReason,
    decision: item.marketData.decision,
    decisionMode: mode,
    primaryReason: item.rationale.primaryReason,
    capturedAt: new Date().toISOString()
  };
}

// Compact ideas (on run list rows) only carry a flat primaryReason — use it
// for both rationale and quality reason. The /portfolio card will still show
// the single reason twice-deduped because its dedupe checks equality.
export function handoffFromCompact(
  item: StrategyRunCompactIdea,
  opts: { market: string; mode: StrategyIdeasDecisionMode }
): IdeaHandoff {
  return {
    symbol: item.symbol,
    companyName: item.companyName,
    market: opts.market,
    direction: item.direction,
    score: item.score,
    confidence: item.confidence,
    topThemeId: item.topThemeId,
    topThemeName: item.topThemeName,
    qualityGrade: item.qualityGrade,
    qualityReason: item.primaryReason,
    decision: item.marketDecision,
    decisionMode: opts.mode,
    primaryReason: item.primaryReason,
    capturedAt: new Date().toISOString()
  };
}
