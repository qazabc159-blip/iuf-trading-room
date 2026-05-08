// paper-four-layer-risk-gate.ts
//
// 5/12 KGI unlock pre-requisite: 4-layer risk gate for paper/sim/live submit paths.
//
// Layers:
//   L1 — Kill switch (env PAPER_KILL_SWITCH; default ON = blocked)
//   L2 — Max position size cap (env RISK_MAX_POSITION_PCT; default 30%)
//         Block when: order notional > equity × RISK_MAX_POSITION_PCT/100
//         audit_log type: risk_block_max_position
//   L3 — Daily loss limit (env RISK_DAILY_LOSS_PCT; default 2%)
//         Block when: (realizedPnlToday + unrealizedPnl) ≤ −equity × RISK_DAILY_LOSS_PCT/100
//         Auto-engages kill switch when triggered.
//         audit_log type: risk_block_daily_loss
//   L4 — Per-symbol concentration cap (env RISK_PER_SYMBOL_MAX_PCT; default 30%)
//         Block when: post-trade symbol exposure > equity × RISK_PER_SYMBOL_MAX_PCT/100
//         audit_log type: risk_block_concentration
//
// Design:
//   - All 4 layers enforced on paper, sim, and live submit (preview runs L1-L4 too,
//     but does NOT auto-engage the kill switch on L3 hit — preview is read-only).
//   - Standalone module; does NOT import risk-engine.ts.
//   - Returns a structured result so callers can return a 422 with audit context.
//   - writeAuditLog wired at call sites (server.ts) so session is always available.

import type { AppSession, OrderCreateInput } from "@iuf-trading-room/contracts";

import { getPaperBalance as _getPaperBalance, listPaperPositions as _listPaperPositions } from "./broker/paper-broker.js";
import { isKillSwitchEnabled, _setKillSwitchEnabled } from "./domain/trading/execution-mode.js";

// ---------------------------------------------------------------------------
// Test injection (ESM live-binding workaround for unit tests)
// ---------------------------------------------------------------------------

type PaperBalanceFn = typeof _getPaperBalance;
type PaperPositionsFn = typeof _listPaperPositions;

let _getPaperBalanceImpl: PaperBalanceFn = _getPaperBalance;
let _listPaperPositionsImpl: PaperPositionsFn = _listPaperPositions;

/** For unit tests only — inject mock implementations to avoid DB/broker deps. */
export function _setPaperBrokerOverride(overrides: {
  getPaperBalance?: PaperBalanceFn;
  listPaperPositions?: PaperPositionsFn;
}): void {
  if (overrides.getPaperBalance) _getPaperBalanceImpl = overrides.getPaperBalance;
  if (overrides.listPaperPositions) _listPaperPositionsImpl = overrides.listPaperPositions;
}

/** Reset to real implementations (call in test cleanup). */
export function _resetPaperBrokerOverride(): void {
  _getPaperBalanceImpl = _getPaperBalance;
  _listPaperPositionsImpl = _listPaperPositions;
}

// ---------------------------------------------------------------------------
// Env-sourced thresholds
// ---------------------------------------------------------------------------

export function readMaxPositionPct(): number {
  const raw = Number(process.env.RISK_MAX_POSITION_PCT);
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : 30;
}

export function readDailyLossPct(): number {
  const raw = Number(process.env.RISK_DAILY_LOSS_PCT);
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : 2;
}

export function readPerSymbolMaxPct(): number {
  const raw = Number(process.env.RISK_PER_SYMBOL_MAX_PCT);
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : 30;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type FourLayerRiskAuditType =
  | "risk_block_max_position"
  | "risk_block_daily_loss"
  | "risk_block_concentration";

export type FourLayerRiskGateResult =
  | {
      blocked: false;
      layer: null;
      reason: null;
      auditType: null;
      observedValue: null;
      limitValue: null;
    }
  | {
      blocked: true;
      layer: 1 | 2 | 3 | 4;
      reason: string;
      auditType: FourLayerRiskAuditType | "kill_switch_on";
      observedValue: number | null;
      limitValue: number | null;
      /** True when L3 triggered the kill switch auto-engage */
      killSwitchAutoEngaged?: boolean;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOARD_LOT_SIZE = 1000;

function effectiveShares(order: OrderCreateInput): number {
  const unit = order.quantity_unit ?? "SHARE";
  return unit === "SHARE" ? order.quantity : order.quantity * BOARD_LOT_SIZE;
}

// Reference price for notional: limit price > stop price > null
// If null → caller must handle (we treat it as 0 for position cap purposes,
// which means the guard may not fire on market orders with no price — by
// design: risk engine elsewhere handles stale_quote for market orders).
function referencePrice(order: OrderCreateInput): number | null {
  return order.price ?? order.stopPrice ?? null;
}

// ---------------------------------------------------------------------------
// Main gate
// ---------------------------------------------------------------------------

/**
 * Runs the 4-layer risk gate for a paper order.
 *
 * @param isPreview  Pass `true` for preview mode — L3 will NOT auto-engage the
 *                   kill switch (preview is read-only / non-committal).
 */
export async function evaluateFourLayerRiskGate(input: {
  session: AppSession;
  order: OrderCreateInput;
  isPreview?: boolean;
}): Promise<FourLayerRiskGateResult> {
  const { session, order, isPreview = false } = input;
  const accountId = order.accountId;

  // ── L1: Kill switch ───────────────────────────────────────────────────────
  if (isKillSwitchEnabled()) {
    return {
      blocked: true,
      layer: 1,
      reason: "Kill switch is ON — all order submission blocked.",
      auditType: "kill_switch_on",
      observedValue: null,
      limitValue: null
    };
  }

  // Fetch account state once; shared across L2/L3/L4.
  let equity = 1;
  let realizedPnlToday = 0;
  let symbolMarketValue = 0;
  let unrealizedPnl = 0;

  try {
    const balance = await _getPaperBalanceImpl(session, accountId);
    equity = balance.equity > 0 ? balance.equity : 1;
    realizedPnlToday = balance.realizedPnlToday;
    unrealizedPnl = balance.unrealizedPnl;

    const positions = await _listPaperPositionsImpl(session, accountId);
    const symPos = positions.find(
      (p) => p.symbol.toUpperCase() === order.symbol.toUpperCase()
    );
    symbolMarketValue = Math.abs(symPos?.marketValue ?? 0);
  } catch {
    // If paper-broker unavailable, skip L2/L3/L4 account-based checks.
    // L1 (kill switch) already passed. Return allowed so the existing
    // evaluatePaperOrderRisk handles the full risk check.
    return {
      blocked: false,
      layer: null,
      reason: null,
      auditType: null,
      observedValue: null,
      limitValue: null
    };
  }

  // ── L2: Max position size cap ─────────────────────────────────────────────
  // Compares new order notional against equity × maxPositionPct.
  // Only fires on buy orders (we are adding to position).
  if (order.side === "buy") {
    const maxPositionPct = readMaxPositionPct();
    const refPrice = referencePrice(order);
    // Market orders (price=null, stopPrice=null): refPrice is null → L2 skipped.
    // By design: notional cannot be calculated without a reference price.
    // Market order risk is handled upstream by the stale_quote guard in
    // evaluatePaperOrderRisk (paper-risk-bridge.ts).
    if (refPrice !== null && refPrice > 0) {
      const shares = effectiveShares(order);
      const orderNotional = refPrice * shares;
      const capNtd = equity * (maxPositionPct / 100);
      if (orderNotional > capNtd) {
        return {
          blocked: true,
          layer: 2,
          reason: `Order notional ${orderNotional.toFixed(0)} TWD exceeds max position cap ${maxPositionPct}% of portfolio (${capNtd.toFixed(0)} TWD).`,
          auditType: "risk_block_max_position",
          observedValue: Math.round(orderNotional),
          limitValue: Math.round(capNtd)
        };
      }
    }
  }

  // ── L3: Daily loss limit ──────────────────────────────────────────────────
  // Compares (realizedPnlToday + unrealizedPnl) against −equity × dailyLossPct.
  {
    const dailyLossPct = readDailyLossPct();
    const totalDailyPnl = realizedPnlToday + unrealizedPnl;
    const lossThresholdNtd = -(equity * (dailyLossPct / 100));
    if (totalDailyPnl <= lossThresholdNtd) {
      // Auto-engage kill switch (non-preview only — preview must not mutate state)
      let killSwitchAutoEngaged = false;
      if (!isPreview && !isKillSwitchEnabled()) {
        _setKillSwitchEnabled(true);
        killSwitchAutoEngaged = true;
      }
      return {
        blocked: true,
        layer: 3,
        reason: `Daily loss limit reached: ${totalDailyPnl.toFixed(0)} TWD ≤ threshold ${lossThresholdNtd.toFixed(0)} TWD (${dailyLossPct}% of equity). Kill switch${killSwitchAutoEngaged ? " auto-engaged" : " already ON"}.`,
        auditType: "risk_block_daily_loss",
        observedValue: Math.round(Math.abs(totalDailyPnl)),
        limitValue: Math.round(Math.abs(lossThresholdNtd)),
        killSwitchAutoEngaged
      };
    }
  }

  // ── L4: Per-symbol concentration cap ─────────────────────────────────────
  // Compares post-trade symbol exposure (existing + new order notional) against
  // equity × perSymbolMaxPct. Only fires on buy orders.
  if (order.side === "buy") {
    const perSymbolMaxPct = readPerSymbolMaxPct();
    const refPrice = referencePrice(order);
    // Market orders (price=null, stopPrice=null): refPrice is null → L4 skipped.
    // By design: same rationale as L2 above — notional undefined without price.
    // Upstream stale_quote guard in evaluatePaperOrderRisk covers market order risk.
    if (refPrice !== null && refPrice > 0) {
      const shares = effectiveShares(order);
      const orderNotional = refPrice * shares;
      const postTradeSymbolExposure = symbolMarketValue + orderNotional;
      const capNtd = equity * (perSymbolMaxPct / 100);
      if (postTradeSymbolExposure > capNtd) {
        return {
          blocked: true,
          layer: 4,
          reason: `Post-trade symbol concentration ${postTradeSymbolExposure.toFixed(0)} TWD exceeds cap ${perSymbolMaxPct}% of portfolio (${capNtd.toFixed(0)} TWD).`,
          auditType: "risk_block_concentration",
          observedValue: Math.round(postTradeSymbolExposure),
          limitValue: Math.round(capNtd)
        };
      }
    }
  }

  // All 4 layers passed
  return {
    blocked: false,
    layer: null,
    reason: null,
    auditType: null,
    observedValue: null,
    limitValue: null
  };
}
