"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import type { KillMode } from "@/components/portfolio/KillSwitch";
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
  { value: "buy", label: "買進" },
  { value: "sell", label: "賣出" },
];

const TYPES: ReadonlyArray<{ value: PaperOrderType; label: string }> = [
  { value: "market", label: "市價" },
  { value: "limit", label: "限價" },
  { value: "stop", label: "停損" },
  { value: "stop_limit", label: "停損限價" },
];

function uiStateLabel(state: "LIVE" | "EMPTY" | "BLOCKED" | "LOADING") {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  if (state === "LOADING") return "讀取中";
  return "暫停";
}

function sideLabel(side: PaperSide | string) {
  return side === "buy" ? "買進" : side === "sell" ? "賣出" : String(side);
}

function orderStatusLabel(status: string) {
  if (status === "REJECTED") return "已拒絕";
  if (status === "FILLED") return "已成交";
  if (status === "CANCELLED") return "已撤單";
  if (status === "WORKING") return "委託中";
  if (status === "ACCEPTED") return "已接受";
  if (status === "PENDING") return "待處理";
  if (status === "SUBMITTED") return "已送出";
  return status;
}

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
      quantity_unit: "SHARE" as const,
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
    ? "請輸入股票代號。"
    : !parsed.validQty
      ? "股數必須是正整數。"
      : !parsed.validPrice
        ? "此委託類型需要有效價格。"
        : null;

  const submitDisabledReason =
    killMode !== "ARMED"
      ? "目前交易模式未開放送出。"
      : validationReason
        ? validationReason
        : preview.status === "idle"
          ? "請先預覽風控與報價。"
          : preview.status === "loading"
            ? "風控預覽讀取中。"
            : preview.status === "blocked"
              ? "風控或報價預檢未通過。"
              : preview.status === "error"
                ? "風控預覽失敗。"
                : null;

  const ledgerState =
    orders.status === "blocked"
      ? "BLOCKED"
      : orders.status === "loading"
        ? "LOADING"
        : orders.items.length === 0
          ? "EMPTY"
          : "LIVE";

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

  const canPreview = orderInput !== null && preview.status !== "loading";
  const canSubmit = submitDisabledReason === null && submit.status !== "loading";

  return (
    <div>
      {handoff && (
        <div style={handoffStyle}>
          <div className="tg" style={{ color: "var(--gold-bright)", fontWeight: 700 }}>
            由策略想法帶入 {handoff.ideaId} / {handoff.themeCode}
          </div>
          <div style={{ color: "var(--exec-mid)", fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}>
            {handoff.rationale}
          </div>
          <button onClick={clear} style={plainButtonStyle} type="button">
            清除
          </button>
        </div>
      )}

      <div style={sourceBarStyle}>
        <StatePill state={ledgerState} />
        <span>紙上交易</span>
        <span>送出前風控預檢</span>
        <span>委託紀錄</span>
      </div>

      <div style={ticketShellStyle}>
        <div style={formCardStyle}>
          <Row label="股票">
            <input
              value={draft.symbol}
              onChange={(event) => updateDraft({ symbol: event.target.value.toUpperCase() })}
              placeholder="2330"
              style={inputStyle}
            />
          </Row>
          <Row label="方向">
            <Segmented options={SIDES} value={draft.side} onChange={(side) => updateDraft({ side })} />
          </Row>
          <Row label="類型">
            <Segmented
              options={TYPES}
              value={draft.orderType}
              onChange={(orderType) => updateDraft({ orderType, price: orderType === "market" ? "" : draft.price })}
            />
          </Row>
          <Row label="效期">
            <div style={staticFieldStyle}>ROD / 紙上</div>
          </Row>
          <Row label="價格">
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={draft.price}
              onChange={(event) => updateDraft({ price: event.target.value })}
              placeholder={draft.orderType === "market" ? "市價免填" : "1084.00"}
              disabled={draft.orderType === "market"}
              style={inputStyle}
            />
          </Row>
          <Row label="股數">
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

        <div style={previewCardStyle}>
          <div className="tg" style={panelHeadingStyle}>風控與報價預覽</div>
          {preview.status === "idle" && (
            <TruthNote state="EMPTY" text="尚未預覽目前委託草稿。送出前請先跑紙上風控預檢。" />
          )}
          {preview.status === "loading" && <TruthNote state="LIVE" text="正在檢查風控與報價..." />}
          {preview.status === "error" && <TruthNote state="BLOCKED" text={preview.message} />}
          {(preview.status === "live" || preview.status === "blocked") && (
            <PreviewResult result={preview.result} />
          )}
        </div>
      </div>

      <div style={actionBarStyle}>
        <button
          onClick={runPreview}
          disabled={!canPreview}
          title={validationReason ?? "執行模擬委託預覽"}
          style={{
            ...actionButtonStyle,
            color: canPreview ? "var(--gold-bright)" : "var(--exec-soft)",
          }}
          type="button"
        >
          {preview.status === "loading" ? "預覽中" : "預覽風控"}
        </button>
        <button
          onClick={runSubmit}
          disabled={!canSubmit}
          title={submitDisabledReason ?? "送出一筆模擬委託"}
          style={{
            ...actionButtonStyle,
            borderRight: "none",
            color: canSubmit ? "var(--tw-dn-bright)" : "var(--exec-soft)",
          }}
          type="button"
        >
          {submit.status === "loading" ? "送出中" : "送出紙上單"}
        </button>
      </div>

      {submitDisabledReason && <TruthNote state="BLOCKED" text={submitDisabledReason} />}
      {preview.status === "live" && !submitDisabledReason && (
        <TruthNote state="LIVE" text="預檢通過。此送單只建立紙上委託，不會送往券商；凱基正式下單待 libCGCrypt.so 補齊後接上。" />
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
        text={result.riskCheck.summary || `風控判斷：${result.riskCheck.decision}`}
      />
      <div style={kvListStyle}>
        <KV k="風控" v={result.riskCheck.decision.toUpperCase()} />
        <KV k="檢查項目" v={`${result.riskCheck.guards.length} 項 / ${blockedGuards.length} 項阻擋`} />
        <KV k="更新" v={formatTime(result.riskCheck.createdAt)} />
        <KV k="報價" v={result.quoteGate ? result.quoteGate.decision : "尚未檢查"} />
        {result.quoteGate?.selectedSource && <KV k="來源" v={result.quoteGate.selectedSource} />}
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
        text={`委託 ${state.intent.id}：${orderStatusLabel(state.intent.status)}${state.intent.reason ? `：${state.intent.reason}` : ""}`}
      />
      <div style={kvListStyle}>
        <KV k="股票" v={state.intent.symbol} />
        <KV k="方向" v={sideLabel(state.intent.side)} />
        <KV k="股數" v={state.intent.qty.toLocaleString()} />
        <KV k="價格" v={state.intent.price === null ? "市價" : String(state.intent.price)} />
        <KV k="更新" v={formatTime(state.intent.updatedAt)} />
        {state.fill && <KV k="成交" v={`${state.fill.fillQty.toLocaleString()} @ ${state.fill.fillPrice}`} />}
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
  const ledgerState =
    orders.status === "blocked"
      ? "BLOCKED"
      : orders.status === "loading"
        ? "LOADING"
        : orders.items.length === 0
          ? "EMPTY"
          : "LIVE";

  return (
    <div style={{ marginTop: 14, border: "1px solid var(--exec-rule-strong)" }}>
      <div style={historyHeaderStyle}>
        <span>紙上委託紀錄</span>
        <span>
          {orders.status === "live"
            ? `${uiStateLabel(ledgerState)} / ${orders.items.length} 筆 / ${formatTime(orders.updatedAt)}`
            : orders.status === "loading"
              ? "讀取中"
              : `暫停 / ${formatTime(orders.updatedAt)}`}
        </span>
      </div>
      {orders.status === "loading" && (
        <TruthNote state="LIVE" text="正在讀取紙上委託紀錄..." />
      )}
      {orders.status === "blocked" && (
        <TruthNote state="BLOCKED" text={`暫時無法讀取委託紀錄：${orders.message}`} />
      )}
      {orders.status === "live" && orders.items.length === 0 && (
        <TruthNote state="EMPTY" text="目前沒有紙上委託紀錄。" />
      )}
      {orders.status === "live" && orders.items.slice(0, 6).map((state) => (
        <div key={state.intent.id} style={orderRowStyle}>
          <span className="tg" style={{ color: "var(--gold-bright)", fontWeight: 700 }}>{state.intent.symbol}</span>
          <span className="tg">{sideLabel(state.intent.side)} {state.intent.qty.toLocaleString()}</span>
          <span className="tg">{orderStatusLabel(state.intent.status)}</span>
          <span className="tg soft">{formatTime(state.intent.updatedAt)}</span>
          <button
            type="button"
            disabled={!isCancellablePaperOrder(state.intent.status) || cancellingId === state.intent.id}
            title={isCancellablePaperOrder(state.intent.status) ? "撤銷此紙上委託" : "終態委託無法撤銷"}
            onClick={() => onCancel(state.intent.id)}
            style={miniButtonStyle}
          >
            {cancellingId === state.intent.id ? "..." : "撤單"}
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
      {uiStateLabel(state)}
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
              background: active ? "rgba(184,138,62,0.18)" : "transparent",
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
      <span style={{ color: "var(--exec-mid)", letterSpacing: "0.12em" }}>{k}</span>
      <span style={{ color: "var(--exec-ink)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

const handoffStyle: CSSProperties = {
  padding: "10px 12px",
  marginBottom: 12,
  border: "1px solid var(--gold)",
  background: "rgba(184,138,62,0.10)",
  fontFamily: "var(--mono)",
  position: "relative",
};

const plainButtonStyle: CSSProperties = {
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

const sourceBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 14px",
  alignItems: "center",
  padding: "8px 0 10px",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontSize: 11.5,
};

const ticketShellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(280px, 0.9fr) minmax(300px, 1.1fr)",
  gap: 16,
};

const formCardStyle: CSSProperties = {
  border: "1px solid var(--exec-rule-strong)",
  padding: 18,
  minHeight: 326,
  background: "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.010))",
};

const previewCardStyle: CSSProperties = {
  border: "1px solid var(--exec-rule-strong)",
  padding: 18,
  minHeight: 326,
  background: "linear-gradient(180deg, rgba(200,148,63,0.040), rgba(255,255,255,0.010))",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "var(--exec-mid)",
  width: 64,
};

const inputStyle: CSSProperties = {
  flex: 1,
  padding: "11px 12px",
  background: "var(--exec-bg)",
  border: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-ink)",
  fontFamily: "var(--mono)",
  fontSize: 15,
  fontFeatureSettings: "\"tnum\",\"lnum\"",
  outline: "none",
  minWidth: 0,
};

const staticFieldStyle: CSSProperties = {
  ...inputStyle,
  color: "var(--exec-mid)",
};

const segmentedStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  border: "1px solid var(--exec-rule-strong)",
  minWidth: 0,
};

const segmentButtonStyle: CSSProperties = {
  flex: 1,
  minHeight: 42,
  padding: "9px 8px",
  border: "none",
  fontFamily: "var(--mono)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
};

const panelHeadingStyle: CSSProperties = {
  color: "var(--gold-bright)",
  marginBottom: 8,
  letterSpacing: "0.14em",
};

const actionBarStyle: CSSProperties = {
  display: "flex",
  gap: 0,
  marginTop: 14,
  border: "1px solid var(--exec-rule-strong)",
};

const actionButtonStyle: CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  borderRight: "1px solid var(--exec-rule-strong)",
  minHeight: 48,
  padding: "14px 18px",
  fontFamily: "var(--mono)",
  letterSpacing: "0.08em",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const truthNoteStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "9px 0",
  color: "var(--exec-mid)",
  fontFamily: "var(--serif-tc)",
  fontSize: 14,
  lineHeight: 1.65,
};

const kvListStyle: CSSProperties = {
  borderTop: "1px solid var(--exec-rule-strong)",
  marginTop: 8,
};

const kvStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "96px 1fr",
  gap: 8,
  padding: "6px 0",
  borderBottom: "1px solid var(--exec-rule)",
  fontFamily: "var(--mono)",
  fontSize: 11.5,
};

const guardRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "130px 1fr",
  gap: 10,
  padding: "6px 0",
  borderBottom: "1px solid var(--exec-rule)",
  color: "var(--tw-up-bright)",
  fontFamily: "var(--mono)",
  fontSize: 11,
};

const reasonListStyle: CSSProperties = {
  marginTop: 8,
  color: "var(--exec-soft)",
  fontFamily: "var(--mono)",
  fontSize: 11,
  lineHeight: 1.5,
};

const historyHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "9px 10px",
  borderBottom: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  letterSpacing: "0.1em",
};

const orderRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px 1fr 86px 74px 64px",
  gap: 10,
  alignItems: "center",
  padding: "9px 10px",
  borderTop: "1px solid var(--exec-rule)",
  fontFamily: "var(--mono)",
  fontSize: 11.5,
};

const miniButtonStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  padding: "5px 6px",
  cursor: "pointer",
};
