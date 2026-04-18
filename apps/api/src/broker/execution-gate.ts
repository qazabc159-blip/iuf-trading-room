import type {
  AppSession,
  BrokerKind,
  ExecutionGateDecision,
  ExecutionGateMode,
  ExecutionQuoteContext,
  ExecutionQuoteGateResult,
  MarketDataDecisionModeSummary,
  MarketDataDecisionSummaryItem,
  OrderCreateInput
} from "@iuf-trading-room/contracts";

import { getMarketDataDecisionSummary } from "../market-data.js";

// Single source of truth for "can this order proceed?" based on the
// decision-summary surface. Both the server-side submit path and the UI should
// read the same decision vocabulary so allow/review/block never drift.

export const GATE_OVERRIDE_KEY = "quote_review";

// Re-export contract types so broker-internal callers can keep importing from
// execution-gate without knowing these live in the contracts package now.
export type { ExecutionGateDecision, ExecutionGateMode } from "@iuf-trading-room/contracts";

// Gate result returned over the API boundary — contract-typed so the web UI
// binds to the same shape the server emits.
export type ExecutionGateResult = ExecutionQuoteGateResult;

export function modeForBroker(broker: BrokerKind): ExecutionGateMode {
  return broker === "paper" ? "paper" : "execution";
}

function modeSummaryFor(
  item: MarketDataDecisionSummaryItem,
  mode: ExecutionGateMode
): MarketDataDecisionModeSummary {
  return mode === "paper" ? item.paper : item.execution;
}

function buildReasons(item: MarketDataDecisionSummaryItem): string[] {
  const reasons = item.reasons.filter(Boolean);
  if (item.primaryReason && !reasons.includes(item.primaryReason)) {
    return [item.primaryReason, ...reasons];
  }
  return reasons;
}

export function buildQuoteContext(args: {
  item: MarketDataDecisionSummaryItem;
  mode: ExecutionGateMode;
  now: string;
}): ExecutionQuoteContext {
  const { item, mode } = args;
  const summary = modeSummaryFor(item, mode);
  return {
    mode,
    decision: summary.decision,
    source: item.selectedSource,
    readiness: item.readiness,
    freshnessStatus: item.freshnessStatus,
    paperUsable: item.paper.usable,
    liveUsable: item.execution.usable,
    providerConnected: item.selectedSource !== null && item.quote !== null,
    fallbackReason: item.fallbackReason,
    staleReason: item.staleReason,
    reasons: buildReasons(item),
    last: item.quote?.last ?? null,
    bid: item.quote?.bid ?? null,
    ask: item.quote?.ask ?? null,
    capturedAt: item.quote?.timestamp ?? args.now
  };
}

export async function evaluateExecutionGate(args: {
  session: AppSession;
  order: OrderCreateInput;
  mode: ExecutionGateMode;
}): Promise<ExecutionGateResult> {
  const now = new Date().toISOString();

  let item: MarketDataDecisionSummaryItem | null = null;
  let quoteError: string | null = null;
  try {
    const summary = await getMarketDataDecisionSummary({
      session: args.session,
      symbols: args.order.symbol,
      includeStale: true,
      limit: 1
    });
    item = summary.items[0] ?? null;
  } catch (err) {
    quoteError = err instanceof Error ? err.message : String(err);
  }

  if (!item) {
    return buildGateResult({
      mode: args.mode,
      decision: "quote_unknown",
      blocked: false,
      reasons: quoteError ? [`quote_error:${quoteError}`] : ["no_quote"],
      item: null,
      quoteContext: null,
      quoteError
    });
  }

  const summary = modeSummaryFor(item, args.mode);
  const quoteContext = buildQuoteContext({
    item,
    mode: args.mode,
    now
  });
  const reasons = buildReasons(item);
  const overrideRequested =
    args.order.overrideGuards?.includes(GATE_OVERRIDE_KEY) ?? false;

  if (summary.decision === "block") {
    return buildGateResult({
      mode: args.mode,
      decision: "block",
      blocked: true,
      reasons: ["decision:block", ...reasons],
      item,
      quoteContext,
      quoteError: null
    });
  }

  if (summary.decision === "review") {
    if (!overrideRequested) {
      return buildGateResult({
        mode: args.mode,
        decision: "review_required",
        blocked: true,
        reasons: ["decision:review_required_override", ...reasons],
        item,
        quoteContext,
        quoteError: null
      });
    }

    if (!summary.usable) {
      return buildGateResult({
        mode: args.mode,
        decision: "review_unusable",
        blocked: true,
        reasons: ["decision:review_not_usable", ...reasons],
        item,
        quoteContext,
        quoteError: null
      });
    }

    return buildGateResult({
      mode: args.mode,
      decision: "review_accepted",
      blocked: false,
      reasons: ["decision:review_accepted", ...reasons],
      item,
      quoteContext,
      quoteError: null
    });
  }

  return buildGateResult({
    mode: args.mode,
    decision: "allow",
    blocked: false,
    reasons,
    item,
    quoteContext,
    quoteError: null
  });
}

// Assembles the contract-typed gate result. Hoists primary/fallback/stale
// fields from `item` so the UI can read them without defensively unwrapping
// nested state — guarantees the contract's flattened fields line up with the
// backing decision-summary item.
function buildGateResult(args: {
  mode: ExecutionGateMode;
  decision: ExecutionGateDecision;
  blocked: boolean;
  reasons: string[];
  item: MarketDataDecisionSummaryItem | null;
  quoteContext: ExecutionQuoteContext | null;
  quoteError: string | null;
}): ExecutionGateResult {
  return {
    mode: args.mode,
    decision: args.decision,
    blocked: args.blocked,
    reasons: args.reasons,
    primaryReason: args.item?.primaryReason ?? null,
    fallbackReason: args.item?.fallbackReason ?? null,
    staleReason: args.item?.staleReason ?? null,
    selectedSource: args.item?.selectedSource ?? null,
    readiness: args.item?.readiness ?? null,
    freshnessStatus: args.item?.freshnessStatus ?? null,
    item: args.item,
    quoteContext: args.quoteContext,
    quoteError: args.quoteError
  };
}

export function gateDecisionLabel(result: ExecutionGateResult): string {
  switch (result.decision) {
    case "allow":
      return "Execution gate allows submit.";
    case "review_accepted":
      return "Execution gate accepted quote_review override.";
    case "review_required":
      return "Execution gate requires quote_review override.";
    case "review_unusable":
      return "Quote review override accepted, but the source is still unusable.";
    case "block":
      return "Execution gate blocks submit.";
    case "quote_unknown":
      return "Quote is unavailable; gate failed open so later checks can decide.";
  }
}
