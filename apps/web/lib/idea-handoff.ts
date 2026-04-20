import type {
  StrategyIdea,
  StrategyIdeaDirection,
  StrategyIdeaMarketDecision,
  StrategyIdeasDecisionMode
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
