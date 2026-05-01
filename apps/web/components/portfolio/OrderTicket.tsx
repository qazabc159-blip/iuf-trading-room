"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  cancelPaperOrder,
  formatPaperOrderError,
  getPaperOrder,
  isCancellablePaperOrder,
  isTerminalPaperOrder,
  listPaperOrders,
  previewPaperOrder,
  submitPaperOrder,
  type PaperOrderInput,
  type PaperOrderState,
} from "@/lib/paper-orders-api";
import { useIdeaHandoff } from "@/lib/radar-handoff";
import type { KillMode } from "@/lib/radar-types";

type PaperSide = PaperOrderInput["side"];
type PaperOrderType = PaperOrderInput["orderType"];

type Draft = {
  symbol: string;
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
  { value: "stop", label: "STP" },
  { value: "stop_limit", label: "STP-LMT" },
];

export function OrderTicketForm({ killMode }: { killMode: KillMode }) {
  const { handoff, clear } = useIdeaHandoff();
  const [draft, setDraft] = useState<Draft>({
    symbol: "",
    side: "buy",
    orderType: "limit",
    qty: "",
    price: "",
  });
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [orders, setOrders] = useState<OrdersState>({ status: "loading" });
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    if (!handoff) return;
    setDraft((current) => ({
      ...current,
      symbol: handoff.symbol,
      side: handoff.side === "BUY" ? "buy" : "sell",
    }));
    setPreview({ status: "idle" });
    setSubmit({ status: "idle" });
  }, [handoff]);

  const parsed = useMemo(() => {
    const qty = Number(draft.qty);
    const price = Number(draft.price);
    const needsPrice = draft.orderType !== "market";
    return {
      symbol: draft.symbol.trim().toUpperCase(),
      qty,
      price,
      needsPrice,
      validQty: Number.isInteger(qty) && qty > 0,
      validPrice: !needsPrice || (Number.isFinite(price) && price > 0),
    };
  }, [draft]);

  const orderInput = useMemo<PaperOrderInput | null>(() => {
    if (!parsed.symbol || !parsed.validQty || !parsed.validPrice) return null;
    return {
      symbol: parsed.symbol,
      side: draft.side,
      orderType: draft.orderType,
      qty: parsed.qty,
      price: draft.orderType === "market" ? null : parsed.price,
    };
  }, [draft.orderType, draft.side, parsed]);

  const refreshOrders = useCallback(async () => {
    setOrders({ status: "loading" });
    try {
      const items = await listPaperOrders();
      setOrders({
        status: "live",
        items: items.slice().reverse(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setOrders({
        status: "blocked",
        message: formatPaperOrderError(error),
        updatedAt: new Date().toISOString(),
      });
    }
  }, []);

  useEffect(() => {
    void refreshOrders();
  }, [refreshOrders]);

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview({ status: "idle" });
    setSubmit({ status: "idle" });
  };

  const validationReason = !parsed.symbol
    ? "Enter a ticker symbol."
    : !parsed.validQty
      ? "Quantity must be a positive whole number."
      : !parsed.validPrice
        ? "This order type needs a positive price."
        : null;

  const previewBlocked = preview.status === "blocked";
  const previewReady = preview.status === "live";
  const submitDisabledReason =
    killMode !== "ARMED"
      ? `BLOCKED: local kill mode is ${killMode}.`
      : validationReason
        ? `BLOCKED: ${validationReason}`
        : preview.status === "idle"
          ? "BLOCKED: run PREVIEW first."
          : preview.status === "loading"
            ? "BLOCKED: preview is still running."
            : previewBlocked
              ? "BLOCKED: risk or quote gate failed preview."
              : preview.status === "error"
                ? "BLOCKED: preview failed."
                : null;

  const runPreview = async () => {
    if (!orderInput) return;
    setPreview({ status: "loading" });
    setSubmit({ status: "idle" });
    try {
      const result = await previewPaperOrder(orderInput);
      setPreview(result.blocked ? { status: "blocked", result } : { status: "live", result });
    } catch (error) {
      setPreview({ status: "error", message: formatPaperOrderError(error) });
    }
  };

  const pollOrder = async (orderId: string) => {
    let latest = await getPaperOrder(orderId);
    for (let attempt = 0; attempt < 8 && !isTerminalPaperOrder(latest.intent.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      latest = await getPaperOrder(orderId);
    }
    return latest;
  };

  const runSubmit = async () => {
    if (!orderInput || submitDisabledReason !== null) return;
    setSubmit({ status: "loading" });
    try {
      const initial = await submitPaperOrder(orderInput);
      const state = isTerminalPaperOrder(initial.intent.status)
        ? initial
        : await pollOrder(initial.intent.id);
      setSubmit(state.intent.status === "REJECTED" ? { status: "blocked", state } : { status: "live", state });
      if (state.intent.status !== "REJECTED") {
        clear();
        setPreview({ status: "idle" });
      }
      await refreshOrders();
    } catch (error) {
      setSubmit({ status: "error", message: formatPaperOrderError(error) });
      await refreshOrders();
    }
  };

  const runCancel = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      await cancelPaperOrder(orderId);
      await refreshOrders();
      if (
        (submit.status === "live" || submit.status === "blocked")
        && submit.state.intent.id === orderId
      ) {
        const state = await getPaperOrder(orderId);
        setSubmit(state.intent.status === "REJECTED" ? { status: "blocked", state } : { status: "live", state });
      }
    } catch (error) {
      setSubmit({ status: "error", message: formatPaperOrderError(error) });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div>
      {handoff && (
        <div style={handoffStyle}>
          <div className="tg" style={{ color: "var(--gold-bright)", fontWeight: 700 }}>
            LIVE HANDOFF FROM IDEA {handoff.ideaId} · {handoff.themeCode}
          </div>
          <div style={{ color: "var(--exec-mid)", fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}>
            {handoff.rationale}
          </div>
          <button onClick={clear} style={plainButtonStyle} type="button">
            CLEAR
          </button>
        </div>
      )}

      <div style={sourceBarStyle}>
        <StatePill state={orders.status === "blocked" ? "BLOCKED" : orders.status === "loading" ? "LOADING" : "LIVE"} />
        <span>POST /api/v1/paper/orders/preview</span>
        <span>POST /api/v1/paper/orders</span>
        <span>GET /api/v1/paper/orders</span>
      </div>

      <div style={gridStyle}>
        <div style={boxStyle}>
          <Row label="SYMBOL">
            <input
              value={draft.symbol}
              onChange={(event) => updateDraft({ symbol: event.target.value.toUpperCase() })}
              placeholder="2330"
              style={inputStyle}
            />
          </Row>
          <Row label="SIDE">
            <Segmented options={SIDES} value={draft.side} onChange={(side) => updateDraft({ side })} />
          </Row>
          <Row label="TYPE">
            <Segmented
              options={TYPES}
              value={draft.orderType}
              onChange={(orderType) => updateDraft({ orderType, price: orderType === "market" ? "" : draft.price })}
            />
          </Row>
          <Row label="TIF">
            <div style={staticFieldStyle}>ROD · paper only</div>
          </Row>
          <Row label="PRICE">
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={draft.price}
              onChange={(event) => updateDraft({ price: event.target.value })}
              placeholder={draft.orderType === "market" ? "not required" : "1084.00"}
              disabled={draft.orderType === "market"}
              style={inputStyle}
            />
          </Row>
          <Row label="QTY">
            <input
              type="number"
              min={1}
              step={1}
              value={draft.qty}
              onChange={(event) => updateDraft({ qty: event.target.value })}
              placeholder="1000"
              style={inputStyle}
            />
          </Row>
          {validationReason && <TruthNote state="BLOCKED" text={validationReason} />}
        </div>

        <div style={boxStyle}>
          <div className="tg" style={panelHeadingStyle}>PREVIEW · RISK + QUOTE GATE</div>
          {preview.status === "idle" && (
            <TruthNote
              state="EMPTY"
              text="No preview has been requested for the current draft. Press PREVIEW to run the real paper dry-run."
            />
          )}
          {preview.status === "loading" && <TruthNote state="LIVE" text="Calling real preview endpoint..." />}
          {preview.status === "error" && <TruthNote state="BLOCKED" text={preview.message} />}
          {(preview.status === "live" || preview.status === "blocked") && (
            <PreviewResult result={preview.result} />
          )}
        </div>
      </div>

      <div style={actionBarStyle}>
        <button
          onClick={runPreview}
          disabled={orderInput === null || preview.status === "loading"}
          title={validationReason ?? "Run POST /api/v1/paper/orders/preview"}
          style={{
            ...actionButtonStyle,
            color: orderInput === null ? "var(--exec-soft)" : "var(--gold-bright)",
          }}
          type="button"
        >
          {preview.status === "loading" ? "PREVIEWING" : "PREVIEW"}
        </button>
        <button
          onClick={runSubmit}
          disabled={submitDisabledReason !== null || submit.status === "loading"}
          title={submitDisabledReason ?? "Submit one paper order with a fresh idempotency key."}
          style={{
            ...actionButtonStyle,
            color: submitDisabledReason ? "var(--exec-soft)" : "var(--tw-up-bright)",
          }}
          type="button"
        >
          {submit.status === "loading" ? "SUBMITTING" : "SUBMIT PAPER"}
        </button>
      </div>

      {submitDisabledReason && <TruthNote state="BLOCKED" text={submitDisabledReason} />}
      {previewReady && !submitDisabledReason && (
        <TruthNote state="LIVE" text="Preview passed. Submit remains paper-only and creates no broker/live order." />
      )}

      {(submit.status === "live" || submit.status === "blocked") && (
        <OrderOutcome state={submit.state} />
      )}
      {submit.status === "error" && <TruthNote state="BLOCKED" text={submit.message} />}

      <OrderHistory
        orders={orders}
        cancellingId={cancellingId}
        onCancel={(orderId) => void runCancel(orderId)}
      />
    </div>
  );
}

function PreviewResult({ result }: { result: Awaited<ReturnType<typeof previewPaperOrder>> }) {
  const blockedGuards = result.riskCheck.guards.filter((guard) => guard.decision === "block");
  const state = result.blocked ? "BLOCKED" : "LIVE";
  return (
    <div>
      <TruthNote
        state={state}
        text={result.riskCheck.summary || `Risk decision: ${result.riskCheck.decision}`}
      />
      <div style={kvListStyle}>
        <KV k="RISK" v={result.riskCheck.decision.toUpperCase()} />
        <KV k="GUARDS" v={`${result.riskCheck.guards.length} checked / ${blockedGuards.length} blocked`} />
        <KV k="UPDATED" v={formatTime(result.riskCheck.createdAt)} />
        <KV k="QUOTE" v={result.quoteGate ? result.quoteGate.decision : "not reached"} />
        {result.quoteGate?.selectedSource && <KV k="SOURCE" v={result.quoteGate.selectedSource} />}
      </div>
      {blockedGuards.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {blockedGuards.map((guard) => (
            <div key={`${guard.guard}-${guard.message}`} style={guardRowStyle}>
              <span>{guard.guard}</span>
              <span>{guard.message}</span>
            </div>
          ))}
        </div>
      )}
      {result.quoteGate?.reasons?.length ? (
        <div style={reasonListStyle}>
          {result.quoteGate.reasons.map((reason) => (
            <div key={reason}>{reason}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OrderOutcome({ state }: { state: PaperOrderState }) {
  const tone = state.intent.status === "REJECTED" ? "BLOCKED" : "LIVE";
  return (
    <div style={{ marginTop: 12 }}>
      <TruthNote
        state={tone}
        text={`Order ${state.intent.id} is ${state.intent.status}${state.intent.reason ? `: ${state.intent.reason}` : ""}.`}
      />
      <div style={kvListStyle}>
        <KV k="SYMBOL" v={state.intent.symbol} />
        <KV k="SIDE" v={state.intent.side.toUpperCase()} />
        <KV k="QTY" v={state.intent.qty.toLocaleString()} />
        <KV k="PRICE" v={state.intent.price === null ? "market" : String(state.intent.price)} />
        <KV k="UPDATED" v={formatTime(state.intent.updatedAt)} />
        {state.fill && <KV k="FILL" v={`${state.fill.fillQty.toLocaleString()} @ ${state.fill.fillPrice}`} />}
      </div>
    </div>
  );
}

function OrderHistory({
  orders,
  cancellingId,
  onCancel,
}: {
  orders: OrdersState;
  cancellingId: string | null;
  onCancel: (orderId: string) => void;
}) {
  return (
    <div style={{ marginTop: 14, border: "1px solid var(--exec-rule-strong)" }}>
      <div style={historyHeaderStyle}>
        <span>REAL PAPER LEDGER</span>
        <span>
          {orders.status === "live"
            ? `LIVE · ${orders.items.length} rows · ${formatTime(orders.updatedAt)}`
            : orders.status === "loading"
              ? "LOADING"
              : `BLOCKED · ${formatTime(orders.updatedAt)}`}
        </span>
      </div>
      {orders.status === "loading" && (
        <TruthNote state="LIVE" text="Loading GET /api/v1/paper/orders..." />
      )}
      {orders.status === "blocked" && (
        <TruthNote state="BLOCKED" text={`Order ledger unavailable: ${orders.message}. Owner: Jason/Bruce.`} />
      )}
      {orders.status === "live" && orders.items.length === 0 && (
        <TruthNote state="EMPTY" text="GET /api/v1/paper/orders returned zero rows for the current user." />
      )}
      {orders.status === "live" && orders.items.slice(0, 6).map((state) => (
        <div key={state.intent.id} style={orderRowStyle}>
          <span className="tg" style={{ color: "var(--gold-bright)", fontWeight: 700 }}>{state.intent.symbol}</span>
          <span className="tg">{state.intent.side.toUpperCase()} {state.intent.qty.toLocaleString()}</span>
          <span className="tg">{state.intent.status}</span>
          <span className="tg soft">{formatTime(state.intent.updatedAt)}</span>
          <button
            type="button"
            disabled={!isCancellablePaperOrder(state.intent.status) || cancellingId === state.intent.id}
            title={
              isCancellablePaperOrder(state.intent.status)
                ? "Cancel this paper order through POST /api/v1/paper/orders/:id/cancel"
                : "BLOCKED: terminal paper orders cannot be cancelled."
            }
            onClick={() => onCancel(state.intent.id)}
            style={miniButtonStyle}
          >
            {cancellingId === state.intent.id ? "..." : "CANCEL"}
          </button>
        </div>
      ))}
    </div>
  );
}

function StatePill({ state }: { state: "LIVE" | "EMPTY" | "BLOCKED" | "LOADING" }) {
  const color = state === "LIVE" ? "var(--gold-bright)"
    : state === "EMPTY" ? "var(--exec-mid)"
      : state === "LOADING" ? "var(--gold)"
        : "var(--tw-up-bright)";
  return (
    <span style={{ color, fontWeight: 700, letterSpacing: "0.18em" }}>
      {state}
    </span>
  );
}

function TruthNote({ state, text }: { state: "LIVE" | "EMPTY" | "BLOCKED"; text: string }) {
  return (
    <div style={truthNoteStyle}>
      <StatePill state={state} />
      <span>{text}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={{ flex: 1, display: "flex" }}>{children}</span>
    </label>
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
              borderLeft: index === 0 ? "none" : "1px solid var(--exec-rule)",
              background: active ? "rgba(184,138,62,0.16)" : "transparent",
              color: active ? "var(--gold-bright)" : "var(--exec-mid)",
              cursor: active ? "default" : "pointer",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={kvStyle}>
      <span style={{ color: "var(--exec-mid)", letterSpacing: "0.16em" }}>{k}</span>
      <span style={{ color: "var(--exec-ink)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

const handoffStyle: React.CSSProperties = {
  padding: "10px 12px",
  marginBottom: 12,
  border: "1px solid var(--gold)",
  background: "rgba(184,138,62,0.10)",
  fontFamily: "var(--mono)",
  position: "relative",
};

const plainButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  background: "transparent",
  border: "none",
  color: "var(--exec-soft)",
  cursor: "pointer",
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: "0.16em",
};

const sourceBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 14px",
  alignItems: "center",
  padding: "8px 0",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontSize: 10.5,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)",
  gap: 18,
};

const boxStyle: React.CSSProperties = {
  border: "1px solid var(--exec-rule-strong)",
  padding: 16,
  minHeight: 300,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  marginBottom: 10,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: "0.20em",
  color: "var(--exec-mid)",
  textTransform: "uppercase",
  width: 82,
  paddingTop: 8,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  background: "var(--exec-bg)",
  border: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-ink)",
  fontFamily: "var(--mono)",
  fontSize: 13,
  fontFeatureSettings: "\"tnum\",\"lnum\"",
  outline: "none",
  minWidth: 0,
};

const staticFieldStyle: React.CSSProperties = {
  ...inputStyle,
  color: "var(--exec-mid)",
};

const segmentedStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  border: "1px solid var(--exec-rule-strong)",
  minWidth: 0,
};

const segmentButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 6px",
  border: "none",
  fontFamily: "var(--mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
};

const panelHeadingStyle: React.CSSProperties = {
  color: "var(--exec-mid)",
  marginBottom: 8,
  letterSpacing: "0.16em",
};

const actionBarStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  marginTop: 14,
  border: "1px solid var(--exec-rule-strong)",
};

const actionButtonStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  borderRight: "1px solid var(--exec-rule-strong)",
  padding: "14px 16px",
  fontFamily: "var(--mono)",
  letterSpacing: "0.18em",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const truthNoteStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "9px 0",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontSize: 11.5,
  lineHeight: 1.5,
};

const kvListStyle: React.CSSProperties = {
  borderTop: "1px solid var(--exec-rule-strong)",
  marginTop: 8,
};

const kvStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "96px 1fr",
  gap: 8,
  padding: "6px 0",
  borderBottom: "1px solid var(--exec-rule)",
  fontFamily: "var(--mono)",
  fontSize: 11.5,
};

const guardRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "130px 1fr",
  gap: 10,
  padding: "6px 0",
  borderBottom: "1px solid var(--exec-rule)",
  color: "var(--tw-up-bright)",
  fontFamily: "var(--mono)",
  fontSize: 11,
};

const reasonListStyle: React.CSSProperties = {
  marginTop: 8,
  color: "var(--exec-soft)",
  fontFamily: "var(--mono)",
  fontSize: 11,
  lineHeight: 1.5,
};

const historyHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "9px 10px",
  borderBottom: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  letterSpacing: "0.14em",
};

const orderRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px 1fr 86px 74px 74px",
  gap: 10,
  alignItems: "center",
  padding: "9px 10px",
  borderTop: "1px solid var(--exec-rule)",
  fontFamily: "var(--mono)",
  fontSize: 11.5,
};

const miniButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: "0.12em",
  padding: "5px 6px",
  cursor: "pointer",
};
