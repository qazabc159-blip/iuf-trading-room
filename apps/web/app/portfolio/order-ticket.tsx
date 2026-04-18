"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  OrderCreateInput,
  RiskCheckResult,
  RiskGuardResult,
  RiskLimit,
  TradePlan
} from "@iuf-trading-room/contracts";

import {
  getEffectiveRiskLimit,
  getPlans,
  previewTradingOrder,
  submitTradingOrder,
  type TradingOrderResult
} from "@/lib/api";

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
  const [lastResult, setLastResult] = useState<TradingOrderResult | null>(null);
  const [pending, setPending] = useState<"idle" | "preview" | "submit">("idle");
  const [error, setError] = useState<string | null>(null);

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

  const onPickPlan = useCallback(
    (planId: string) => {
      if (!planId) {
        setForm((prev) => ({ ...prev, tradePlanId: "" }));
        return;
      }
      const plan = plans.find((p) => p.id === planId);
      if (!plan?.execution) return;
      const ex = plan.execution;
      setForm((prev) => ({
        ...prev,
        tradePlanId: plan.id,
        symbol: ex.symbol,
        side: ex.side,
        type: ex.orderType,
        price: ex.entryPrice !== null ? String(ex.entryPrice) : prev.price,
        stopPrice: ex.orderType === "stop" || ex.orderType === "stop_limit"
          ? (ex.stopLoss !== null ? String(ex.stopLoss) : prev.stopPrice)
          : prev.stopPrice
      }));
    },
    [plans]
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
