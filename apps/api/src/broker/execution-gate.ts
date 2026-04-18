import type {
  AppSession,
  BrokerKind,
  ExecutionQuoteContext,
  MarketDataDecisionModeSummary,
  MarketDataDecisionSummaryItem,
  OrderCreateInput
} from "@iuf-trading-room/contracts";

import { getMarketDataDecisionSummary } from "../market-data.js";

// Single source of truth for "can this order proceed?" based on the
// decision-summary surface. Both the server-side submit path and the UI should
// read the same decision vocabulary so allow/review/block never drift.

export const GATE_OVERRIDE_KEY = "quote_review";

export type ExecutionGateMode = "paper" | "execution";

export type ExecutionGateDecision =
  | "allow"
  | "review_accepted"
  | "review_required"
  | "block"
  | "quote_unknown";

export type ExecutionGateResult = {
  mode: ExecutionGateMode;
  decision: ExecutionGateDecision;
  blocked: boolean;
  reasons: string[];
  item: MarketDataDecisionSummaryItem | null;
  quoteContext: ExecutionQuoteContext | null;
  quoteError: string | null;
};

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
    return {
      mode: args.mode,
      decision: "quote_unknown",
      blocked: false,
      reasons: quoteError ? [`quote_error:${quoteError}`] : ["no_quote"],
      item: null,
      quoteContext: null,
      quoteError
    };
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
    return {
      mode: args.mode,
      decision: "block",
      blocked: true,
      reasons: ["decision:block", ...reasons],
      item,
      quoteContext,
      quoteError: null
    };
  }

  if (summary.decision === "review") {
    if (!overrideRequested) {
      return {
        mode: args.mode,
        decision: "review_required",
        blocked: true,
        reasons: ["decision:review_required_override", ...reasons],
        item,
        quoteContext,
        quoteError: null
      };
    }
    if (!summary.safe) {
      return {
        mode: args.mode,
        decision: "block",
        blocked: true,
        reasons: ["decision:review_not_safe", ...reasons],
        item,
        quoteContext,
        quoteError: null
      };
    }
    return {
      mode: args.mode,
      decision: "review_accepted",
      blocked: false,
      reasons: ["decision:review_accepted", ...reasons],
      item,
      quoteContext,
      quoteError: null
    };
  }

  return {
    mode: args.mode,
    decision: "allow",
    blocked: false,
    reasons,
    item,
    quoteContext,
    quoteError: null
  };
}

export function gateDecisionLabel(result: ExecutionGateResult): string {
  switch (result.decision) {
    case "allow":
      return "報價決策允許送單";
    case "review_accepted":
      return "報價需 review，但已接受 override";
    case "review_required":
      return "報價需 review，請先勾選 quote_review override";
    case "block":
      return "報價決策封鎖送單";
    case "quote_unknown":
      return "報價不可用，採 fail-open 進入後續檢查";
  }
}
