// M-1 2026-05-06 — Real risk + quote gate for paper submit.
//
// Bridges paper-layer OrderIntent inputs → the broker-layer risk check
// pipeline (evaluateRiskCheck + evaluateExecutionGate) without touching
// risk-engine.ts or trading-service.ts.
//
// Used exclusively by the paper/submit and paper/orders routes in server.ts
// to enforce real risk semantics before driveOrder() is called.
//
// Hard lines:
//   - NO KGI SDK import.
//   - NO broker write-side (/order/create).
//   - Does NOT modify paper-ledger-db, order-driver, or risk-engine.

import type { AppSession, OrderCreateInput, RiskCheckResult } from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

import { evaluateRiskCheck } from "../../risk-engine.js";
import { evaluateExecutionGate } from "../../broker/execution-gate.js";
import { getPaperBalance, listPaperOrders, listPaperPositions } from "../../broker/paper-broker.js";
import { getMarketDataDecisionSummary } from "../../market-data.js";
import type { PaperOrderCreateInput } from "@iuf-trading-room/contracts";

// ---------------------------------------------------------------------------
// normalizePaperQuantity
// ---------------------------------------------------------------------------

/**
 * Returns the effective share count for risk notional calculations.
 * LOT: 1 lot = 1,000 shares (TWSE board lot).
 * SHARE: 1 share = 1 share (odd-lot).
 */
export function normalizePaperQuantity(qty: number, unit: "SHARE" | "LOT"): number {
  return unit === "LOT" ? qty * 1000 : qty;
}

// ---------------------------------------------------------------------------
// buildPaperOrderContext
// ---------------------------------------------------------------------------

/** Constructs the OrderCreateInput from a PaperOrderCreateInput payload.
 *  Uses a fixed "paper-default" accountId — the canonical paper account. */
export function buildPaperOrderContext(payload: PaperOrderCreateInput): OrderCreateInput {
  return {
    accountId: "paper-default",
    symbol: payload.symbol,
    side: payload.side,
    type: payload.orderType as "market" | "limit" | "stop" | "stop_limit",
    timeInForce: "rod" as const,
    quantity: payload.qty,
    quantity_unit: payload.quantity_unit,
    price: payload.price ?? null,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [] as string[],
    overrideReason: ""
  };
}

// ---------------------------------------------------------------------------
// evaluatePaperOrderRisk result type
// ---------------------------------------------------------------------------

export interface PaperRiskGateResult {
  blocked: boolean;
  decision: "pass" | "block" | "review_required";
  riskCheck: RiskCheckResult;
  quoteGate: Awaited<ReturnType<typeof evaluateExecutionGate>> | null;
  guards: RiskCheckResult["guards"];
  reasonCodes: string[];
}

// ---------------------------------------------------------------------------
// evaluatePaperOrderRisk
// ---------------------------------------------------------------------------

/**
 * Runs the real risk engine + quote gate for a paper order.
 *
 * This mirrors what trading-service.ts::submitOrder() does for the real
 * broker path, but writes to no state (commit=false here — the route
 * must pass commit=true to record order intent in the rate-limit window).
 *
 * @param commit  Pass `true` for actual submit (records order intent in
 *                risk engine rate-limiter); `false` for preview/dry-run.
 */
export async function evaluatePaperOrderRisk(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  order: OrderCreateInput;
  commit: boolean;
}): Promise<PaperRiskGateResult> {
  const { session, repo, order, commit } = input;

  // Step 1: Build account context (mirrors trading-service.ts::buildAccountContext)
  const balance = await getPaperBalance(session, order.accountId);
  const positions = await listPaperPositions(session, order.accountId);
  const orders = await listPaperOrders(session, { accountId: order.accountId });

  const openStatuses = new Set(["pending", "submitted", "acknowledged", "partial"]);
  const openOrders = orders.filter((o) => openStatuses.has(o.status)).length;

  const equity = balance.equity > 0 ? balance.equity : 1;
  const grossExposure = positions.reduce((acc, p) => acc + Math.abs(p.marketValue ?? 0), 0);
  const symbolPos = positions.find((p) => p.symbol === order.symbol);
  const symbolPosPct = symbolPos ? (Math.abs(symbolPos.marketValue ?? 0) / equity) * 100 : 0;
  const realizedPnlTodayPct = (balance.realizedPnlToday / equity) * 100;

  const account = {
    equity,
    availableCash: balance.availableCash,
    realizedPnlTodayPct,
    openOrders,
    grossExposurePct: (grossExposure / equity) * 100,
    symbolPositionPct: symbolPosPct,
    themeExposurePct: symbolPosPct,
    brokerConnected: true
  };

  // Step 2: Build market context (mirrors trading-service.ts::resolveMarketContext).
  // The inline quote schema in risk-engine has strict enum types for source + market;
  // we coerce any non-conforming values to safe defaults.
  type RiskInlineQuote = {
    symbol?: string;
    market?: "TWSE" | "TPEX" | "TWO" | "TW_EMERGING" | "TW_INDEX" | "OTHER";
    source?: "tradingview" | "kgi" | "paper" | "manual";
    last?: number | null;
    bid?: number | null;
    ask?: number | null;
    timestamp?: string;
    ageMs?: number;
    isStale?: boolean;
  };

  const VALID_MARKET_VALUES = new Set<string>(["TWSE", "TPEX", "TWO", "TW_EMERGING", "TW_INDEX", "OTHER"]);
  const VALID_SOURCE_VALUES = new Set<string>(["tradingview", "kgi", "paper", "manual"]);

  let marketQuote: RiskInlineQuote | undefined;
  try {
    const summary = await getMarketDataDecisionSummary({
      session,
      symbols: order.symbol,
      includeStale: true,
      limit: 1
    });
    const item = summary.items[0];
    const quote = item?.quote ?? null;
    if (quote) {
      const rawMarket = item?.market ?? "TWSE";
      const rawSource = quote.source;
      marketQuote = {
        symbol: order.symbol,
        market: VALID_MARKET_VALUES.has(rawMarket)
          ? (rawMarket as RiskInlineQuote["market"])
          : "OTHER",
        source: VALID_SOURCE_VALUES.has(rawSource)
          ? (rawSource as RiskInlineQuote["source"])
          : "manual",
        last: quote.last,
        bid: quote.bid,
        ask: quote.ask,
        timestamp: quote.timestamp,
        ageMs: quote.ageMs,
        isStale: quote.isStale
      };
    }
  } catch {
    // Market data unavailable — risk engine will handle stale_quote guard
  }

  // Coerce top-level source to valid risk-engine enum.
  const rawTopSource = marketQuote?.source ?? "manual";
  const riskSource: "tradingview" | "kgi" | "paper" | "manual" =
    VALID_SOURCE_VALUES.has(rawTopSource)
      ? (rawTopSource as "tradingview" | "kgi" | "paper" | "manual")
      : "manual";

  const market = {
    source: riskSource,
    quote: marketQuote,
    now: new Date().toISOString(),
    timeZone: "Asia/Taipei"
  };

  // Step 3: Run real risk check
  const riskCheck = await evaluateRiskCheck({
    session,
    repo,
    payload: { order, account, market, commit }
  });

  if (riskCheck.decision === "block") {
    const reasonCodes = riskCheck.guards
      .filter((g) => g.decision === "block")
      .map((g) => g.guard);
    return {
      blocked: true,
      decision: "block",
      riskCheck,
      quoteGate: null,
      guards: riskCheck.guards,
      reasonCodes
    };
  }

  // Step 4: Run quote gate (same as submitOrder path)
  const quoteGate = await evaluateExecutionGate({ session, order, mode: "paper" });

  if (quoteGate.blocked) {
    return {
      blocked: true,
      decision: quoteGate.decision === "review_required" ? "review_required" : "block",
      riskCheck,
      quoteGate,
      guards: riskCheck.guards,
      reasonCodes: [quoteGate.decision, ...quoteGate.reasons]
    };
  }

  return {
    blocked: false,
    decision: "pass",
    riskCheck,
    quoteGate,
    guards: riskCheck.guards,
    reasonCodes: []
  };
}
