"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatPaperOrderError,
  listPaperOrders,
  previewPaperOrder,
  submitPaperOrder,
  type PaperOrderInput,
  type PaperOrderState,
} from "@/lib/paper-orders-api";

type PaperSide = PaperOrderInput["side"];
type PaperOrderType = PaperOrderInput["orderType"];

type FormState = {
  side: PaperSide;
  orderType: PaperOrderType;
  qty: string;
  price: string;
};

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "live"; result: Awaited<ReturnType<typeof previewPaperOrder>> }
  | { status: "blocked"; result: Awaited<ReturnType<typeof previewPaperOrder>> }
  | { status: "error"; message: string };

type SubmitState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "live"; state: PaperOrderState }
  | { status: "blocked"; state: PaperOrderState }
  | { status: "error"; message: string };

type OrdersState =
  | { status: "loading" }
  | { status: "live"; items: PaperOrderState[]; updatedAt: string }
  | { status: "blocked"; message: string; updatedAt: string };

const SIDES: ReadonlyArray<{ value: PaperSide; label: string }> = [
  { value: "buy", label: "BUY" },
  { value: "sell", label: "SELL" },
];

const TYPES: ReadonlyArray<{ value: PaperOrderType; label: string }> = [
  { value: "market", label: "MKT" },
  { value: "limit", label: "LMT" },
];

export function PaperOrderPanel({ symbol }: { symbol: string }) {
  const [form, setForm] = useState<FormState>({
    side: "buy",
    orderType: "limit",
    qty: "1000",
    price: "",
  });
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [orders, setOrders] = useState<OrdersState>({ status: "loading" });

  const parsed = useMemo(() => {
    const qty = Number(form.qty);
    const price = Number(form.price);
    const needsPrice = form.orderType !== "market";
    return {
      qty,
      price,
      validQty: Number.isInteger(qty) && qty > 0,
      validPrice: !needsPrice || (Number.isFinite(price) && price > 0),
    };
  }, [form]);

  const input = useMemo<PaperOrderInput | null>(() => {
    if (!parsed.validQty || !parsed.validPrice) return null;
    return {
      symbol,
      side: form.side,
      orderType: form.orderType,
      qty: parsed.qty,
      price: form.orderType === "market" ? null : parsed.price,
    };
  }, [form.orderType, form.side, parsed, symbol]);

  const validationReason = !parsed.validQty
    ? "Quantity must be a positive whole number."
    : !parsed.validPrice
      ? "Limit orders need a positive price."
      : null;

  const refreshOrders = async () => {
    setOrders({ status: "loading" });
    try {
      const items = await listPaperOrders();
      setOrders({
        status: "live",
        items: items
          .filter((order) => order.intent.symbol === symbol.toUpperCase())
          .slice()
          .reverse(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setOrders({
        status: "blocked",
        message: formatPaperOrderError(error),
        updatedAt: new Date().toISOString(),
      });
    }
  };

  useEffect(() => {
    void refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview({ status: "idle" });
    setSubmit({ status: "idle" });
  };

  const handlePreview = async () => {
    if (!input) return;
    setPreview({ status: "loading" });
    setSubmit({ status: "idle" });
    try {
      const result = await previewPaperOrder(input);
      setPreview(result.blocked ? { status: "blocked", result } : { status: "live", result });
    } catch (error) {
      setPreview({ status: "error", message: formatPaperOrderError(error) });
    }
  };

  const handleSubmit = async () => {
    if (!input || preview.status !== "live") return;
    setSubmit({ status: "loading" });
    try {
      const state = await submitPaperOrder(input);
      setSubmit(state.intent.status === "REJECTED" ? { status: "blocked", state } : { status: "live", state });
      await refreshOrders();
    } catch (error) {
      setSubmit({ status: "error", message: formatPaperOrderError(error) });
      await refreshOrders();
    }
  };

  const canSubmit = preview.status === "live";

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[06]</span> Paper Orders
      </h3>

      <div style={sourceBarStyle}>
        <StatePill state={orders.status === "blocked" ? "BLOCKED" : orders.status === "loading" ? "LOADING" : "LIVE"} />
        <span>Contract 1 · paper only · no broker submit</span>
      </div>

      <div style={bannerStyle}>
        PAPER ONLY. This panel calls paper endpoints only and never touches KGI/live order routes.
      </div>

      <div style={gridStyle}>
        <div>
          <label style={labelStyle}>SIDE</label>
          <Segmented options={SIDES} value={form.side} onChange={(side) => updateForm({ side })} />
        </div>
        <div>
          <label style={labelStyle}>TYPE</label>
          <Segmented
            options={TYPES}
            value={form.orderType}
            onChange={(orderType) => updateForm({ orderType, price: orderType === "market" ? "" : form.price })}
          />
        </div>
        <div>
          <label style={labelStyle}>QTY</label>
          <input
            type="number"
            min={1}
            value={form.qty}
            onChange={(event) => updateForm({ qty: event.target.value })}
            style={inputStyle}
          />
        </div>
        {form.orderType !== "market" && (
          <div>
            <label style={labelStyle}>PRICE</label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={form.price}
              onChange={(event) => updateForm({ price: event.target.value })}
              placeholder="780.5"
              style={inputStyle}
            />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <span className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)" }}>SYMBOL</span>
        <span className="mono" style={{ marginLeft: 10, fontWeight: 700, fontSize: 15 }}>{symbol.toUpperCase()}</span>
      </div>

      {validationReason && <TruthNote state="BLOCKED" text={validationReason} />}

      <div className="action-row" style={{ gap: 8, marginBottom: 16 }}>
        <button
          className="btn-sm"
          onClick={handlePreview}
          disabled={input === null || preview.status === "loading"}
          title={validationReason ?? "Run real paper preview endpoint"}
          type="button"
        >
          {preview.status === "loading" ? "PREVIEWING" : "PREVIEW"}
        </button>
        <button
          className="btn-sm"
          onClick={handleSubmit}
          disabled={!canSubmit || submit.status === "loading"}
          title={!canSubmit ? "BLOCKED: run a passing preview first." : "Submit a paper order only."}
          type="button"
          style={canSubmit ? { borderColor: "var(--gold, #b8960c)", color: "var(--gold, #b8960c)" } : {}}
        >
          {submit.status === "loading" ? "SUBMITTING" : "SUBMIT PAPER"}
        </button>
      </div>

      {preview.status === "idle" && (
        <TruthNote state="EMPTY" text="No preview for the current draft yet." />
      )}
      {preview.status === "error" && (
        <TruthNote state="BLOCKED" text={preview.message} />
      )}
      {(preview.status === "live" || preview.status === "blocked") && (
        <PreviewResult result={preview.result} />
      )}

      {submit.status === "error" && (
        <TruthNote state="BLOCKED" text={submit.message} />
      )}
      {(submit.status === "live" || submit.status === "blocked") && (
        <TruthNote
          state={submit.state.intent.status === "REJECTED" ? "BLOCKED" : "LIVE"}
          text={`Paper order ${submit.state.intent.id} is ${submit.state.intent.status}${submit.state.intent.reason ? `: ${submit.state.intent.reason}` : ""}.`}
        />
      )}

      <div style={ledgerStyle}>
        <div style={ledgerHeaderStyle}>
          <span>SYMBOL PAPER LEDGER</span>
          <span>
            {orders.status === "live"
              ? `${orders.items.length} rows · ${formatTime(orders.updatedAt)}`
              : orders.status === "loading"
                ? "loading"
                : `blocked · ${formatTime(orders.updatedAt)}`}
          </span>
        </div>
        {orders.status === "blocked" && <TruthNote state="BLOCKED" text={orders.message} />}
        {orders.status === "live" && orders.items.length === 0 && (
          <TruthNote state="EMPTY" text="No paper orders returned for this symbol." />
        )}
        {orders.status === "live" && orders.items.slice(0, 3).map((order) => (
          <div key={order.intent.id} style={orderRowStyle}>
            <span>{order.intent.side.toUpperCase()} {order.intent.qty.toLocaleString()}</span>
            <span>{order.intent.status}</span>
            <span>{formatTime(order.intent.updatedAt)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PreviewResult({ result }: { result: Awaited<ReturnType<typeof previewPaperOrder>> }) {
  const state = result.blocked ? "BLOCKED" : "LIVE";
  const blocked = result.riskCheck.guards.filter((guard) => guard.decision === "block");
  return (
    <div style={previewBoxStyle}>
      <TruthNote state={state} text={result.riskCheck.summary || `Risk decision: ${result.riskCheck.decision}`} />
      <div style={kvStyle}><span>RISK</span><b>{result.riskCheck.decision.toUpperCase()}</b></div>
      <div style={kvStyle}><span>QUOTE</span><b>{result.quoteGate ? result.quoteGate.decision : "not reached"}</b></div>
      <div style={kvStyle}><span>UPDATED</span><b>{formatTime(result.riskCheck.createdAt)}</b></div>
      {blocked.map((guard) => (
        <div key={`${guard.guard}-${guard.message}`} style={blockedGuardStyle}>
          {guard.guard}: {guard.message}
        </div>
      ))}
    </div>
  );
}

function StatePill({ state }: { state: "LIVE" | "EMPTY" | "BLOCKED" | "LOADING" }) {
  const color = state === "LIVE" ? "var(--gold-bright)"
    : state === "EMPTY" ? "var(--night-mid)"
      : state === "LOADING" ? "var(--gold)"
        : "var(--tw-up-bright)";
  return <span style={{ color, fontWeight: 700, letterSpacing: "0.16em" }}>{state}</span>;
}

function TruthNote({ state, text }: { state: "LIVE" | "EMPTY" | "BLOCKED"; text: string }) {
  return (
    <div style={truthNoteStyle}>
      <StatePill state={state} />
      <span>{text}</span>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div style={segmentedStyle}>
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              ...segmentButtonStyle,
              borderLeft: index === 0 ? "none" : "1px solid var(--night-rule-strong, #333)",
              color: active ? "var(--gold, #b8960c)" : "var(--night-mid, #888)",
              background: active ? "rgba(184,138,62,0.14)" : "transparent",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

const sourceBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 12px",
  alignItems: "center",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  marginBottom: 10,
};

const bannerStyle: React.CSSProperties = {
  background: "rgba(184,138,62,0.14)",
  border: "1px solid var(--gold, #b8960c)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontWeight: 700,
  fontSize: 11,
  padding: "8px 10px",
  letterSpacing: "0.08em",
  marginBottom: 14,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
  marginBottom: 14,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--night-mid, #888)",
  display: "block",
  marginBottom: 4,
  fontFamily: "var(--mono, monospace)",
  letterSpacing: "0.16em",
};

const inputStyle: React.CSSProperties = {
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 12,
  padding: "6px 10px",
  width: "100%",
  boxSizing: "border-box",
};

const segmentedStyle: React.CSSProperties = {
  display: "flex",
  border: "1px solid var(--night-rule-strong, #333)",
};

const segmentButtonStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  padding: "7px 8px",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const truthNoteStyle: React.CSSProperties = {
  display: "flex",
  gap: 9,
  alignItems: "flex-start",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
  lineHeight: 1.5,
  padding: "7px 0",
};

const previewBoxStyle: React.CSSProperties = {
  border: "1px solid var(--night-rule-strong, #333)",
  padding: "9px 10px",
  marginBottom: 12,
};

const kvStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  borderTop: "1px solid var(--night-rule, #222)",
  padding: "6px 0",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
};

const blockedGuardStyle: React.CSSProperties = {
  color: "var(--tw-up-bright, #e63946)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
  lineHeight: 1.5,
};

const ledgerStyle: React.CSSProperties = {
  borderTop: "1px solid var(--night-rule-strong, #333)",
  marginTop: 12,
  paddingTop: 8,
};

const ledgerHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  letterSpacing: "0.10em",
};

const orderRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 80px 70px",
  gap: 8,
  borderTop: "1px solid var(--night-rule, #222)",
  padding: "7px 0",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
};
