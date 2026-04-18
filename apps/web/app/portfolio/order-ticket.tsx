"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Balance,
  OrderCreateInput,
  RiskCheckResult,
  RiskGuardResult,
  RiskLimit,
  TradePlan,
  TradePlanExecution
} from "@iuf-trading-room/contracts";

import {
  getEffectiveRiskLimit,
  getPlans,
  getTradingBalance,
  previewTradingOrder,
  submitTradingOrder,
  type TradingOrderResult
} from "@/lib/api";
import { computeSizedQuantity, type SizingResult } from "@/lib/sizing";

type Props = {
  accountId: string;
  onSubmitted: () => void;
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

export function OrderTicket({ accountId, onSubmitted }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [effectiveLimits, setEffectiveLimits] = useState<RiskLimit | null>(null);
  const [pendingLimits, setPendingLimits] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [lastResult, setLastResult] = useState<TradingOrderResult | null>(null);
  const [pending, setPending] = useState<"idle" | "preview" | "submit">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSizing, setLastSizing] = useState<SizingResult | null>(null);

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

  const planEntryPrice = useCallback((ex: TradePlanExecution): number | null => {
    if (ex.entryPrice !== null) return ex.entryPrice;
    if (ex.entryRange) return (ex.entryRange.low + ex.entryRange.high) / 2;
    return null;
  }, []);

  const onPickPlan = useCallback(
    (planId: string) => {
      if (!planId) {
        setForm((prev) => ({ ...prev, tradePlanId: "" }));
        setLastSizing(null);
        return;
      }
      const plan = plans.find((p) => p.id === planId);
      if (!plan?.execution) return;
      const ex = plan.execution;
      const entryForSizing = planEntryPrice(ex);
      const sized = computeSizedQuantity({
        equity: balance?.equity ?? null,
        sizing: ex.positionSizing,
        entryPrice: entryForSizing,
        stopLoss: ex.stopLoss
      });
      setLastSizing(sized);
      setForm((prev) => ({
        ...prev,
        tradePlanId: plan.id,
        symbol: ex.symbol,
        side: ex.side,
        type: ex.orderType,
        quantity: sized.qty !== null ? String(sized.qty) : prev.quantity,
        price: ex.entryPrice !== null ? String(ex.entryPrice) : prev.price,
        stopPrice: ex.orderType === "stop" || ex.orderType === "stop_limit"
          ? (ex.stopLoss !== null ? String(ex.stopLoss) : prev.stopPrice)
          : prev.stopPrice
      }));
    },
    [plans, balance, planEntryPrice]
  );

  // If equity arrives after the plan was picked (or balance refreshes), recompute
  // sizing for the currently selected plan and refill quantity.
  useEffect(() => {
    if (!form.tradePlanId || !balance) return;
    const plan = plans.find((p) => p.id === form.tradePlanId);
    if (!plan?.execution) return;
    const ex = plan.execution;
    const sized = computeSizedQuantity({
      equity: balance.equity,
      sizing: ex.positionSizing,
      entryPrice: planEntryPrice(ex),
      stopLoss: ex.stopLoss
    });
    setLastSizing(sized);
    if (sized.qty !== null) {
      setForm((prev) =>
        prev.tradePlanId === plan.id ? { ...prev, quantity: String(sized.qty) } : prev
      );
    }
  }, [balance, form.tradePlanId, plans, planEntryPrice]);

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
      overrideGuards: [],
      overrideReason: ""
    };
  }, [accountId, form]);

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
          disabled={disabled}
          style={buttonStyle("var(--phosphor)")}
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

      {result.riskCheck.guards.length === 0 ? (
        <div style={{ color: "var(--dim)" }}>無風控註記。</div>
      ) : (
        <GuardsTable guards={result.riskCheck.guards} />
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
