"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Balance,
  ExecutionGateDecision,
  ExecutionQuoteGateResult,
  MarketDataDecisionSummaryItem,
  OrderCreateInput,
  RiskCheckResult,
  RiskGuardResult,
  RiskLimit,
  TradePlan
} from "@iuf-trading-room/contracts";

import {
  getEffectiveRiskLimit,
  getMarketDataDecisionSummary,
  getPlans,
  getTradingBalance,
  previewTradingOrder,
  submitTradingOrder,
  type TradingOrderResult
} from "@/lib/api";
import { type SizingResult } from "@/lib/sizing";
import { buildOrderInputFromPlan } from "@/lib/plan-to-order";

type Props = {
  accountId: string;
  onSubmitted: () => void;
  // Paper account → "paper" mode; live broker → "execution". Defaults to paper
  // so the gate leans conservative when unspecified.
  quoteMode?: "paper" | "execution";
};

type Side = "buy" | "sell";
type OrderType = "market" | "limit" | "stop" | "stop_limit";

type FormState = {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: string;
  price: string;
  stopPrice: string;
  tradePlanId: string;
};

const EMPTY_FORM: FormState = {
  symbol: "",
  side: "buy",
  type: "limit",
  quantity: "1000",
  price: "",
  stopPrice: "",
  tradePlanId: ""
};

const DECISION_COLOR: Record<RiskCheckResult["decision"], string> = {
  allow: "var(--phosphor)",
  warn: "var(--amber)",
  block: "var(--danger, #ff4d4d)"
};

const QUOTE_GATE_COLOR: Record<ExecutionGateDecision, string> = {
  allow: "var(--phosphor)",
  review_accepted: "var(--phosphor)",
  review_required: "var(--amber)",
  review_unusable: "var(--danger, #ff4d4d)",
  block: "var(--danger, #ff4d4d)",
  quote_unknown: "var(--amber)"
};

// Short, copy-friendly label for every gate decision. Used both in the result
// panel and (via gateDecisionSubmitBlock) in the submit-button tooltip so the
// two sides say the same thing.
const QUOTE_GATE_LABEL: Record<ExecutionGateDecision, string> = {
  allow: "允許送單",
  review_accepted: "REVIEW 已接受",
  review_required: "需勾選接受 REVIEW 報價",
  review_unusable: "REVIEW 已勾選但報價仍不可用",
  block: "報價不可執行",
  quote_unknown: "報價未知（伺服器仍會最終判斷）"
};

export function OrderTicket({ accountId, onSubmitted, quoteMode = "paper" }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [effectiveLimits, setEffectiveLimits] = useState<RiskLimit | null>(null);
  const [pendingLimits, setPendingLimits] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [quote, setQuote] = useState<MarketDataDecisionSummaryItem | null>(null);
  const [quoteGeneratedAt, setQuoteGeneratedAt] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pendingQuote, setPendingQuote] = useState(false);
  const [lastResult, setLastResult] = useState<TradingOrderResult | null>(null);
  const [pending, setPending] = useState<"idle" | "preview" | "submit">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSizing, setLastSizing] = useState<SizingResult | null>(null);
  const [acceptDegraded, setAcceptDegraded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPlans()
      .then((res) => {
        if (cancelled) return;
        setPlans(res.data.filter((p) => p.execution !== null));
      })
      .catch((err) => {
        if (!cancelled) console.warn("[order-ticket] getPlans failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const plansWithExecution = useMemo(
    () => plans.filter((p) => p.execution !== null),
    [plans]
  );

  // Fetch live equity once per accountId; sizing uses balance.equity for the
  // risk_per_trade / fixed_pct math. Errors surface as a sizing blocker rather
  // than blocking the form so manual entry still works.
  useEffect(() => {
    if (!accountId) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    getTradingBalance(accountId)
      .then((res) => {
        if (!cancelled) setBalance(res.data);
      })
      .catch((err) => {
        if (!cancelled) console.warn("[order-ticket] getTradingBalance failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const onPickPlan = useCallback(
    (planId: string) => {
      if (!planId) {
        setForm((prev) => ({ ...prev, tradePlanId: "" }));
        setLastSizing(null);
        return;
      }
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return;
      const { order, sizing } = buildOrderInputFromPlan({
        plan,
        accountId,
        equity: balance?.equity ?? null
      });
      setLastSizing(sizing);
      setForm((prev) => ({
        ...prev,
        tradePlanId: plan.id,
        symbol: order.symbol || prev.symbol,
        side: order.side,
        type: order.type,
        quantity: sizing.qty !== null ? String(sizing.qty) : prev.quantity,
        price: order.price !== null ? String(order.price) : prev.price,
        stopPrice: order.stopPrice !== null ? String(order.stopPrice) : prev.stopPrice
      }));
    },
    [plans, balance, accountId]
  );

  // If equity arrives after the plan was picked (or balance refreshes), recompute
  // sizing for the currently selected plan and refill quantity.
  useEffect(() => {
    if (!form.tradePlanId || !balance) return;
    const plan = plans.find((p) => p.id === form.tradePlanId);
    if (!plan?.execution) return;
    const { sizing } = buildOrderInputFromPlan({
      plan,
      accountId,
      equity: balance.equity
    });
    setLastSizing(sizing);
    if (sizing.qty !== null) {
      setForm((prev) =>
        prev.tradePlanId === plan.id ? { ...prev, quantity: String(sizing.qty) } : prev
      );
    }
  }, [balance, form.tradePlanId, plans, accountId]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === form.tradePlanId) ?? null,
    [plans, form.tradePlanId]
  );

  // Re-fetch effective limits whenever accountId or symbol changes.
  useEffect(() => {
    const symbol = form.symbol.trim().toUpperCase();
    if (!accountId) {
      setEffectiveLimits(null);
      return;
    }
    let cancelled = false;
    setPendingLimits(true);
    getEffectiveRiskLimit({
      accountId,
      symbol: symbol || undefined
    })
      .then((res) => {
        if (!cancelled) setEffectiveLimits(res.data);
      })
      .catch((err) => {
        if (!cancelled) console.warn("[order-ticket] getEffectiveRiskLimit failed:", err);
      })
      .finally(() => {
        if (!cancelled) setPendingLimits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, form.symbol]);

  // Fetch decision-summary for the typed symbol so the UI reads the same
  // execution-safe surface the broker submit path consumes. Re-running on
  // symbol change resets
  // the "I accept degraded" override so each new symbol re-prompts confirmation.
  useEffect(() => {
    const symbol = form.symbol.trim().toUpperCase();
    if (!symbol) {
      setQuote(null);
      setQuoteGeneratedAt(null);
      setQuoteError(null);
      setAcceptDegraded(false);
      return;
    }
    let cancelled = false;
    setPendingQuote(true);
    setQuoteError(null);
    setAcceptDegraded(false);
    getMarketDataDecisionSummary({
      symbols: symbol,
      includeStale: true,
      limit: 1
    })
      .then((res) => {
        if (cancelled) return;
        setQuote(res.data.items[0] ?? null);
        setQuoteGeneratedAt(res.data.generatedAt);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[order-ticket] decision-summary failed:", err);
        setQuote(null);
        setQuoteError((err as Error).message || "報價取得失敗");
      })
      .finally(() => {
        if (!cancelled) setPendingQuote(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.symbol, quoteMode]);

  const buildPayload = useCallback((): OrderCreateInput | null => {
    const qty = Number(form.quantity);
    if (!form.symbol.trim() || !Number.isFinite(qty) || qty <= 0) {
      setError("請輸入合法的代號與張數");
      return null;
    }
    const priceRaw = form.price.trim();
    const price = priceRaw ? Number(priceRaw) : null;
    if (priceRaw && (!Number.isFinite(price) || (price ?? 0) <= 0)) {
      setError("價格必須為正數或留空");
      return null;
    }
    const stopRaw = form.stopPrice.trim();
    const stopPrice = stopRaw ? Number(stopRaw) : null;
    if (stopRaw && (!Number.isFinite(stopPrice) || (stopPrice ?? 0) <= 0)) {
      setError("停損/觸發價必須為正數或留空");
      return null;
    }
    setError(null);
    const modeSummary = quote
      ? quoteMode === "paper"
        ? quote.paper
        : quote.execution
      : null;
    const acceptQuoteReview =
      acceptDegraded && modeSummary?.decision === "review";
    return {
      accountId,
      symbol: form.symbol.trim().toUpperCase(),
      side: form.side,
      type: form.type,
      timeInForce: "rod",
      quantity: qty,
      price,
      stopPrice,
      tradePlanId: form.tradePlanId || null,
      strategyId: null,
      overrideGuards: acceptQuoteReview ? ["quote_review"] : [],
      overrideReason: acceptQuoteReview
        ? `operator accepted ${quoteMode} review gate`
        : ""
    };
  }, [accountId, form, quote, quoteMode, acceptDegraded]);

  const onPreview = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) return;
    setPending("preview");
    try {
      const res = await previewTradingOrder(payload);
      setLastResult(res.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending("idle");
    }
  }, [buildPayload]);

  const onSubmit = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) return;
    setPending("submit");
    try {
      const res = await submitTradingOrder(payload);
      setLastResult(res.data);
      if (!res.data.blocked) {
        onSubmitted();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending("idle");
    }
  }, [buildPayload, onSubmitted]);

  const onClear = useCallback(() => {
    setForm(EMPTY_FORM);
    setLastResult(null);
    setError(null);
  }, []);

  const disabled = pending !== "idle";
  // Project the server's ExecutionGateDecision from the decision-summary the
  // UI already holds. Preview is always allowed — it's a dry run whose entire
  // purpose is to surface what would have been blocked. For submit, the client
  // mirrors the server gate's exact vocabulary so a user cannot click through
  // a state the server would then reject:
  //   block               → server would return "block"
  //   review + no accept  → server would return "review_required"
  //   review + !usable    → server would return "review_unusable"
  //   review + usable     → server would return "review_accepted"
  //   no quote / error    → "quote_unknown" (fail open; server makes final call)
  //   allow               → "allow"
  // Client-side submit gate mirrors the server's ExecutionGateDecision vocabulary
  // so the button label and the server's quoteGate.decision stay in sync. The
  // projected decision is what we expect the server to return if the user clicks
  // submit right now.
  const submitGate = ((): {
    allow: boolean;
    label: string | null;
    projectedDecision: ExecutionGateDecision;
  } => {
    const modeSummary = quote
      ? quoteMode === "paper"
        ? quote.paper
        : quote.execution
      : null;
    if (quoteError) {
      return {
        allow: true,
        label: QUOTE_GATE_LABEL.quote_unknown,
        projectedDecision: "quote_unknown"
      };
    }
    if (!quote || !modeSummary) {
      // No symbol / no quote yet — fail open so the user can still preview.
      return { allow: true, label: null, projectedDecision: "quote_unknown" };
    }
    if (modeSummary.decision === "block") {
      return {
        allow: false,
        label: `${QUOTE_GATE_LABEL.block}（${quote.primaryReason || quote.readiness}），禁止下單`,
        projectedDecision: "block"
      };
    }
    if (modeSummary.decision === "review") {
      if (!acceptDegraded) {
        return {
          allow: false,
          label: `${QUOTE_GATE_LABEL.review_required}（${quote.primaryReason || quote.readiness}）`,
          projectedDecision: "review_required"
        };
      }
      if (!modeSummary.usable) {
        // Override checked, but the selected source is still unusable — the
        // server will reject with review_unusable. Don't let the click fire.
        return {
          allow: false,
          label: `${QUOTE_GATE_LABEL.review_unusable}（${quote.primaryReason || quote.readiness}）`,
          projectedDecision: "review_unusable"
        };
      }
      return {
        allow: true,
        label: QUOTE_GATE_LABEL.review_accepted,
        projectedDecision: "review_accepted"
      };
    }
    return { allow: true, label: null, projectedDecision: "allow" };
  })();

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {plansWithExecution.length > 0 && (
        <label
          style={{
            display: "grid",
            gap: "0.25rem",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.85rem"
          }}
        >
          <span style={{ color: "var(--dim)" }}>以 Trade Plan 預填</span>
          <select
            value={form.tradePlanId}
            onChange={(e) => onPickPlan(e.target.value)}
            disabled={disabled}
            style={selectStyle}
          >
            <option value="">— 手動下單 —</option>
            {plansWithExecution.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.execution!.symbol} {plan.execution!.side} {plan.execution!.orderType}
                {plan.execution!.entryPrice ? ` @${plan.execution!.entryPrice}` : ""}
                {" · "}
                {plan.status}
              </option>
            ))}
          </select>
        </label>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.75rem"
        }}
      >
        <Field label="代號">
          <input
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
            placeholder="2330"
            disabled={disabled}
            style={inputStyle}
          />
        </Field>
        <Field label="方向">
          <select
            value={form.side}
            onChange={(e) => setForm({ ...form, side: e.target.value as Side })}
            disabled={disabled}
            style={selectStyle}
          >
            <option value="buy">買 Buy</option>
            <option value="sell">賣 Sell</option>
          </select>
        </Field>
        <Field label="類型">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as OrderType })}
            disabled={disabled}
            style={selectStyle}
          >
            <option value="market">MKT</option>
            <option value="limit">LMT</option>
            <option value="stop">STP</option>
            <option value="stop_limit">STP-LMT</option>
          </select>
        </Field>
        <Field label="張數">
          <input
            inputMode="numeric"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            disabled={disabled}
            style={inputStyle}
          />
        </Field>
        <Field label={form.type === "market" ? "價格（忽略）" : "價格"}>
          <input
            inputMode="decimal"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder={form.type === "market" ? "MKT" : "580"}
            disabled={disabled || form.type === "market"}
            style={inputStyle}
          />
        </Field>
        {(form.type === "stop" || form.type === "stop_limit") && (
          <Field label="觸發價">
            <input
              inputMode="decimal"
              value={form.stopPrice}
              onChange={(e) => setForm({ ...form, stopPrice: e.target.value })}
              disabled={disabled}
              style={inputStyle}
            />
          </Field>
        )}
      </div>

      {selectedPlan?.execution && (
        <PlanContextCard plan={selectedPlan} />
      )}

      {selectedPlan?.execution && lastSizing && (
        <SizingBreakdownCard sizing={lastSizing} equity={balance?.equity ?? null} />
      )}

      <QuoteReadinessCard
        quote={quote}
        pending={pendingQuote}
        error={quoteError}
        generatedAt={quoteGeneratedAt}
        symbol={form.symbol.trim().toUpperCase()}
        mode={quoteMode}
        acceptDegraded={acceptDegraded}
        onAcceptDegraded={setAcceptDegraded}
      />

      <EffectiveLimitsCard
        limits={effectiveLimits}
        pending={pendingLimits}
        symbol={form.symbol.trim().toUpperCase()}
      />

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          onClick={onPreview}
          disabled={disabled}
          style={buttonStyle("var(--dim)")}
        >
          {pending === "preview" ? "[...]" : "[PREVIEW 風控試算]"}
        </button>
        <button
          onClick={onSubmit}
          disabled={disabled || !submitGate.allow}
          title={submitGate.label ?? undefined}
          style={buttonStyle(submitGate.allow ? "var(--phosphor)" : "var(--dim)")}
        >
          {pending === "submit" ? "[...]" : "[SUBMIT 送單]"}
        </button>
        <button
          onClick={onClear}
          disabled={disabled}
          style={buttonStyle("var(--amber)")}
        >
          [CLEAR]
        </button>
      </div>

      {!submitGate.allow && submitGate.label && (
        <p style={{ color: "var(--amber)", fontFamily: "var(--mono, monospace)", fontSize: "0.85rem" }}>
          [GATE] {submitGate.label}
        </p>
      )}

      {error && (
        <p style={{ color: "var(--amber)", fontFamily: "var(--mono, monospace)" }}>
          [ERR] {error}
        </p>
      )}

      {lastResult && <RiskCheckPanel result={lastResult} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "grid",
        gap: "0.25rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.8rem"
      }}
    >
      <span style={{ color: "var(--dim)" }}>{label}</span>
      {children}
    </label>
  );
}

function PlanContextCard({ plan }: { plan: TradePlan }) {
  const ex = plan.execution!;
  const ladderSum = ex.takeProfitLadder.reduce((s, leg) => s + leg.portion, 0);
  const sizingLabel =
    ex.positionSizing.mode === "fixed_qty"
      ? `固定張數 ${ex.positionSizing.qty ?? "—"}`
      : ex.positionSizing.mode === "fixed_pct"
        ? `固定比例 ${ex.positionSizing.pct}% 權益`
        : `風險 ${ex.positionSizing.pct}% / 單筆`;
  return (
    <div
      style={{
        border: "1px dashed var(--phosphor)",
        padding: "0.75rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.8rem"
      }}
    >
      <div style={{ color: "var(--dim)", marginBottom: "0.4rem" }}>
        [PLAN CONTEXT · {ex.symbol}]
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.5rem"
        }}
      >
        <PlanStat
          label="進場區間"
          value={
            ex.entryRange
              ? `${ex.entryRange.low} – ${ex.entryRange.high}`
              : "—"
          }
        />
        <PlanStat
          label="停損"
          value={ex.stopLoss !== null ? String(ex.stopLoss) : "—"}
          accent="amber"
        />
        <PlanStat label="部位規則" value={sizingLabel} />
        <PlanStat
          label="部位上限"
          value={`${ex.positionSizing.maxPositionPct}%`}
        />
        <PlanStat
          label="觸發條件"
          value={ex.triggerCondition || "—"}
        />
        <PlanStat
          label="有效至"
          value={ex.validUntil ?? "—"}
        />
      </div>

      {ex.takeProfitLadder.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ color: "var(--dim)", marginBottom: "0.25rem" }}>
            分批停利（合計 {Math.round(ladderSum * 100)}%）
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--dim)", textAlign: "left" }}>
                <th style={cell}>價位</th>
                <th style={cellRight}>分批</th>
                <th style={cell}>備註</th>
              </tr>
            </thead>
            <tbody>
              {ex.takeProfitLadder.map((leg, i) => (
                <tr
                  key={`tp-${i}`}
                  style={{ borderTop: "1px solid var(--line, #2a2a2a)" }}
                >
                  <td style={{ ...cell, color: "var(--phosphor)" }}>
                    {leg.price}
                  </td>
                  <td style={cellRight}>{Math.round(leg.portion * 100)}%</td>
                  <td style={{ ...cell, color: "var(--dim)" }}>
                    {leg.note || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlanStat({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: "amber";
}) {
  return (
    <div>
      <div style={{ color: "var(--dim)" }}>{label}</div>
      <div style={{ color: accent === "amber" ? "var(--amber)" : "var(--fg, #eee)" }}>
        {value}
      </div>
    </div>
  );
}

const READINESS_COLOR: Record<MarketDataDecisionSummaryItem["readiness"], string> = {
  ready: "var(--phosphor)",
  degraded: "var(--amber)",
  blocked: "var(--danger, #ff4d4d)"
};

const READINESS_LABEL: Record<MarketDataDecisionSummaryItem["readiness"], string> = {
  ready: "READY",
  degraded: "DEGRADED",
  blocked: "BLOCKED"
};

const DECISION_STYLE: Record<
  MarketDataDecisionSummaryItem["strategy"]["decision"],
  { color: string; label: string }
> = {
  allow: { color: "var(--phosphor)", label: "ALLOW" },
  review: { color: "var(--amber)", label: "REVIEW" },
  block: { color: "var(--danger, #ff4d4d)", label: "BLOCK" }
};

const MODE_LABEL: Record<"paper" | "execution", string> = {
  paper: "PAPER",
  execution: "LIVE"
};

function QuoteReadinessCard({
  quote,
  pending,
  error,
  generatedAt,
  symbol,
  mode,
  acceptDegraded,
  onAcceptDegraded
}: {
  quote: MarketDataDecisionSummaryItem | null;
  pending: boolean;
  error: string | null;
  generatedAt: string | null;
  symbol: string;
  mode: "paper" | "execution";
  acceptDegraded: boolean;
  onAcceptDegraded: (next: boolean) => void;
}) {
  const modeSummary = quote
    ? mode === "paper"
      ? quote.paper
      : quote.execution
    : null;
  const decisionStyle = modeSummary ? DECISION_STYLE[modeSummary.decision] : null;
  const readinessColor = quote ? READINESS_COLOR[quote.readiness] : "var(--dim)";
  const accent = decisionStyle?.color ?? readinessColor;
  const generatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("zh-TW", { hour12: false })
    : null;
  return (
    <div
      style={{
        border: `1px solid ${accent}`,
        padding: "0.65rem 0.75rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.8rem"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "0.4rem",
          gap: "0.75rem",
          flexWrap: "wrap"
        }}
      >
        <span style={{ color: "var(--dim)" }}>
          [QUOTE · {MODE_LABEL[mode]} {symbol ? `· ${symbol}` : ""}]
          {pending && <span style={{ marginLeft: "0.5rem" }}>…</span>}
          {generatedLabel && !pending && (
            <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem" }}>
              @ {generatedLabel}
            </span>
          )}
        </span>
        {quote && decisionStyle && (
          <span style={{ color: decisionStyle.color, letterSpacing: "0.05em" }}>
            ● {decisionStyle.label} ·{" "}
            <span style={{ color: readinessColor }}>
              {READINESS_LABEL[quote.readiness]}
            </span>
          </span>
        )}
      </div>
      {error ? (
        <div style={{ color: "var(--amber)" }}>
          [WARN] 報價服務回應錯誤：{error}。伺服器仍會在送單時重新風控，請小心操作。
        </div>
      ) : !quote ? (
        <div style={{ color: "var(--dim)" }}>
          {symbol ? "—（此代號尚無報價）" : "輸入代號以檢查報價狀態"}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "0.4rem",
              marginBottom: "0.4rem"
            }}
          >
            <Stat label="來源" value={quote.selectedSource ?? "—"} />
            <Stat
              label="last"
              value={quote.quote?.last?.toString() ?? "—"}
              accent="phosphor"
            />
            <Stat
              label="bid / ask"
              value={`${quote.quote?.bid ?? "—"} / ${quote.quote?.ask ?? "—"}`}
            />
            <Stat
              label="freshness"
              value={quote.freshnessStatus}
              accent={quote.freshnessStatus === "fresh" ? "phosphor" : "amber"}
            />
            <Stat
              label="usable / safe"
              value={`${modeSummary?.usable ? "✓" : "×"} / ${modeSummary?.safe ? "✓" : "×"}`}
              accent={modeSummary?.safe ? "phosphor" : "amber"}
            />
            <Stat
              label="fallback"
              value={quote.fallbackReason || "none"}
              accent={
                quote.fallbackReason && quote.fallbackReason !== "none"
                  ? "amber"
                  : undefined
              }
            />
            <Stat
              label="stale"
              value={quote.staleReason || "none"}
              accent={
                quote.staleReason && quote.staleReason !== "none"
                  ? "amber"
                  : undefined
              }
            />
            <Stat
              label="primary"
              value={quote.primaryReason || "none"}
              accent={quote.primaryReason && quote.primaryReason !== "none" ? "amber" : undefined}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "0.4rem",
              marginBottom: "0.4rem"
            }}
          >
            <Stat
              label="strategy"
              value={`${quote.strategy.decision} / ${quote.strategy.usable ? "usable" : "hold"}`}
              accent={quote.strategy.safe ? "phosphor" : "amber"}
            />
            <Stat
              label="paper"
              value={`${quote.paper.decision} / ${quote.paper.usable ? "usable" : "hold"}`}
              accent={quote.paper.safe ? "phosphor" : "amber"}
            />
            <Stat
              label="execution"
              value={`${quote.execution.decision} / ${quote.execution.usable ? "usable" : "hold"}`}
              accent={quote.execution.safe ? "phosphor" : "amber"}
            />
          </div>
          {quote.reasons.length > 0 && (
            <ul
              style={{
                margin: "0.3rem 0 0 1rem",
                padding: 0,
                color: "var(--dim)",
                fontSize: "0.75rem"
              }}
            >
              {quote.reasons.map((r, i) => (
                <li key={`r-${i}`}>{r}</li>
              ))}
            </ul>
          )}
          {modeSummary?.decision === "review" && (
            <label
              style={{
                marginTop: "0.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "var(--amber)"
              }}
            >
              <input
                type="checkbox"
                checked={acceptDegraded}
                onChange={(e) => onAcceptDegraded(e.target.checked)}
              />
              <span>
                接受 review 報價（{quote.readiness}）並承擔風險
              </span>
            </label>
          )}
          {modeSummary?.decision === "block" && (
            <p style={{ color: "var(--danger, #ff4d4d)", marginTop: "0.4rem" }}>
              報價決策 block：{quote.primaryReason || quote.readiness}。Preview 仍可運作。
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: "phosphor" | "amber";
}) {
  const color =
    accent === "phosphor"
      ? "var(--phosphor)"
      : accent === "amber"
        ? "var(--amber)"
        : "var(--fg, #eee)";
  return (
    <div>
      <div style={{ color: "var(--dim)", fontSize: "0.7rem" }}>{label}</div>
      <div style={{ color }}>{value}</div>
    </div>
  );
}

function EffectiveLimitsCard({
  limits,
  pending,
  symbol
}: {
  limits: RiskLimit | null;
  pending: boolean;
  symbol: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line, #2a2a2a)",
        padding: "0.75rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.8rem"
      }}
    >
      <div style={{ color: "var(--dim)", marginBottom: "0.4rem" }}>
        [EFFECTIVE LIMITS {symbol ? `· ${symbol}` : ""}]
        {pending && <span style={{ marginLeft: "0.5rem" }}>…</span>}
      </div>
      {!limits ? (
        <div style={{ color: "var(--dim)" }}>—</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "0.5rem"
          }}
        >
          <LimitStat label="單筆風險" value={`${limits.maxPerTradePct}%`} />
          <LimitStat label="當日最大損失" value={`${limits.maxDailyLossPct}%`} />
          <LimitStat label="單一標的" value={`${limits.maxSinglePositionPct}%`} />
          <LimitStat label="同主題曝險" value={`${limits.maxThemeCorrelatedPct}%`} />
          <LimitStat label="最大未結單" value={String(limits.maxOpenOrders)} />
          <LimitStat label="每分鐘張數" value={String(limits.maxOrdersPerMinute)} />
          <LimitStat
            label="交易時段"
            value={`${limits.tradingHoursStart}–${limits.tradingHoursEnd}`}
          />
          <LimitStat
            label="白名單限制"
            value={limits.whitelistOnly ? "ON" : "OFF"}
            accent={limits.whitelistOnly ? "amber" : undefined}
          />
        </div>
      )}
    </div>
  );
}

function LimitStat({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: "amber";
}) {
  return (
    <div>
      <div style={{ color: "var(--dim)" }}>{label}</div>
      <div style={{ color: accent === "amber" ? "var(--amber)" : "var(--phosphor)" }}>
        {value}
      </div>
    </div>
  );
}

function SizingBreakdownCard({
  sizing,
  equity
}: {
  sizing: SizingResult;
  equity: number | null;
}) {
  const accent = sizing.blocker
    ? "var(--amber)"
    : sizing.cappedByMaxPosition
      ? "var(--amber)"
      : "var(--phosphor)";
  return (
    <div
      style={{
        border: `1px dashed ${accent}`,
        padding: "0.6rem 0.75rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.8rem"
      }}
    >
      <div style={{ color: "var(--dim)", marginBottom: "0.3rem" }}>
        [SIZING · 自動計算]
      </div>
      {sizing.blocker ? (
        <div style={{ color: "var(--amber)" }}>{sizing.blocker}</div>
      ) : (
        <>
          <div style={{ color: "var(--fg, #eee)" }}>{sizing.reason}</div>
          <div
            style={{
              marginTop: "0.3rem",
              display: "flex",
              gap: "1.25rem",
              flexWrap: "wrap"
            }}
          >
            <span>
              <span style={{ color: "var(--dim)" }}>下單張數 </span>
              <span style={{ color: accent, fontWeight: 600 }}>
                {sizing.qty?.toLocaleString() ?? "—"}
              </span>
            </span>
            {sizing.cappedByMaxPosition && (
              <span style={{ color: "var(--amber)" }}>
                ⚠ 受 maxPositionPct 上限壓低（原 {sizing.rawQty?.toLocaleString()} 股）
              </span>
            )}
            <span style={{ color: "var(--dim)" }}>
              權益 {equity !== null ? equity.toLocaleString() : "—"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function RiskCheckPanel({ result }: { result: TradingOrderResult }) {
  const decision = result.riskCheck.decision;
  const color = DECISION_COLOR[decision];
  const label =
    decision === "allow" ? "ALLOW" : decision === "warn" ? "WARN" : "BLOCK";
  const quoteGate = result.quoteGate;
  const quoteGateColor = quoteGate ? QUOTE_GATE_COLOR[quoteGate.decision] : "var(--dim)";

  return (
    <div
      style={{
        border: `1px solid ${color}`,
        padding: "0.75rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.85rem"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "0.5rem"
        }}
      >
        <span style={{ color, fontSize: "1rem", letterSpacing: "0.05em" }}>
          [{label}] {result.riskCheck.summary}
        </span>
        {result.order && (
          <span style={{ color: "var(--dim)" }}>
            order {result.order.id.slice(0, 8)} · {result.order.status}
          </span>
        )}
      </div>

      {result.riskCheck.overridden && (
        <div style={{ color: "var(--amber)", marginBottom: "0.5rem" }}>
          [OVERRIDDEN] {result.riskCheck.overrideReason}
        </div>
      )}

      {quoteGate && <QuoteGateResultPanel quoteGate={quoteGate} color={quoteGateColor} />}

      {result.riskCheck.guards.length === 0 ? (
        <div style={{ color: "var(--dim)" }}>無風控註記。</div>
      ) : (
        <GuardsTable guards={result.riskCheck.guards} />
      )}
    </div>
  );
}

function QuoteGateResultPanel({
  quoteGate,
  color
}: {
  quoteGate: ExecutionQuoteGateResult;
  color: string;
}) {
  // Read exclusively from the flattened contract fields — `item` is still
  // available on the shape for future detail views but no path here needs it.
  const details = [
    quoteGate.selectedSource ? `source=${quoteGate.selectedSource}` : null,
    quoteGate.readiness ? `readiness=${quoteGate.readiness}` : null,
    quoteGate.freshnessStatus ? `freshness=${quoteGate.freshnessStatus}` : null,
    quoteGate.fallbackReason && quoteGate.fallbackReason !== "none"
      ? `fallback=${quoteGate.fallbackReason}`
      : null,
    quoteGate.staleReason && quoteGate.staleReason !== "none"
      ? `stale=${quoteGate.staleReason}`
      : null,
    quoteGate.primaryReason ? `primary=${quoteGate.primaryReason}` : null
  ].filter(Boolean);

  return (
    <div
      style={{
        marginBottom: "0.5rem",
        padding: "0.5rem 0.65rem",
        border: `1px dashed ${color}`,
        color
      }}
    >
      <div style={{ marginBottom: "0.25rem" }}>
        [QUOTE GATE · {quoteGate.mode.toUpperCase()}] {quoteGate.decision} —{" "}
        {QUOTE_GATE_LABEL[quoteGate.decision]}
      </div>
      {details.length > 0 && (
        <div style={{ color: "var(--dim)", fontSize: "0.78rem" }}>
          {details.join(" · ")}
        </div>
      )}
      {quoteGate.quoteError && (
        <div style={{ color: "var(--amber)", fontSize: "0.78rem", marginTop: "0.2rem" }}>
          quote_error: {quoteGate.quoteError}
        </div>
      )}
      {quoteGate.reasons.length > 0 && (
        <div style={{ color: "var(--dim)", fontSize: "0.78rem", marginTop: "0.2rem" }}>
          {quoteGate.reasons.join(" · ")}
        </div>
      )}
    </div>
  );
}

function GuardsTable({ guards }: { guards: RiskGuardResult[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ color: "var(--dim)", textAlign: "left" }}>
          <th style={cell}>Guard</th>
          <th style={cell}>結果</th>
          <th style={cell}>說明</th>
          <th style={cellRight}>觀察值</th>
          <th style={cellRight}>上限</th>
        </tr>
      </thead>
      <tbody>
        {guards.map((g, i) => (
          <tr key={`${g.guard}-${i}`} style={{ borderTop: "1px solid var(--line, #2a2a2a)" }}>
            <td style={cell}>{g.guard}</td>
            <td style={{ ...cell, color: DECISION_COLOR[g.decision] }}>{g.decision}</td>
            <td style={cell}>{g.message}</td>
            <td style={cellRight}>
              {g.observedValue !== null ? Number(g.observedValue).toLocaleString() : "—"}
            </td>
            <td style={cellRight}>
              {g.limitValue !== null ? Number(g.limitValue).toLocaleString() : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.4rem 0.5rem",
  background: "var(--bg-muted, #111)",
  color: "var(--fg, #eee)",
  border: "1px solid var(--line, #2a2a2a)",
  fontFamily: "var(--mono, monospace)",
  fontSize: "0.9rem"
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const cell: React.CSSProperties = { padding: "0.3rem 0.4rem" };
const cellRight: React.CSSProperties = { ...cell, textAlign: "right" };

function buttonStyle(color: string): React.CSSProperties {
  return {
    padding: "0.5rem 1rem",
    background: "transparent",
    color,
    border: `1px solid ${color}`,
    fontFamily: "var(--mono, monospace)",
    fontSize: "0.85rem",
    letterSpacing: "0.05em",
    cursor: "pointer"
  };
}
