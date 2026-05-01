"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  formatPaperOrderError,
  listPaperOrders,
  previewPaperOrder,
  submitPaperOrder,
  type PaperOrderInput,
  type PaperOrderState,
} from "@/lib/paper-orders-api";

// Demo capital constant — must match DEMO_CAPITAL_TWD in order-intent.ts.
const DEMO_CAPITAL_TWD = 20_000;

type PaperSide = PaperOrderInput["side"];
type PaperOrderType = PaperOrderInput["orderType"];
type QuantityUnit = "SHARE" | "LOT";

type FormState = {
  side: PaperSide;
  orderType: PaperOrderType;
  qty: string;
  price: string;
  quantityUnit: QuantityUnit;
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
];

const QUANTITY_UNITS: ReadonlyArray<{ value: QuantityUnit; label: string }> = [
  { value: "LOT", label: "整股" },
  { value: "SHARE", label: "零股" },
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

export function PaperOrderPanel({ symbol }: { symbol: string }) {
  const [form, setForm] = useState<FormState>({
    side: "buy",
    orderType: "limit",
    qty: "1",
    price: "",
    quantityUnit: "SHARE",
  });
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [orders, setOrders] = useState<OrdersState>({ status: "loading" });

  // F1: submitInFlight ref — prevents double-submit if React batching drops disabled flag for a tick.
  const submitInFlight = useRef(false);

  // F2: draftKey is generated once when the operator first previews a draft and reused for all
  // subsequent preview + submit calls for the same draft. Cleared on form change or successful submit
  // so that a fresh draft always gets a fresh key.
  const [draftKey, setDraftKey] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const qty = Number(form.qty);
    const price = Number(form.price);
    const needsPrice = form.orderType !== "market";
    const isShare = form.quantityUnit === "SHARE";
    const validQty = Number.isInteger(qty) && qty > 0 && (!isShare || qty <= 999);
    const validPrice = !needsPrice || (Number.isFinite(price) && price > 0);
    // Effective share count for notional preview
    const effectiveShares = isShare ? qty : qty * 1000;
    // Use form price for notional preview; if market order and price unknown, show null
    const refPrice = needsPrice ? price : (Number.isFinite(price) && price > 0 ? price : null);
    const estimatedNotional = refPrice && validQty ? refPrice * effectiveShares : null;
    const notionalExceedsCap = estimatedNotional !== null && estimatedNotional > DEMO_CAPITAL_TWD;
    return {
      qty,
      price,
      validQty,
      validPrice,
      estimatedNotional,
      notionalExceedsCap,
      effectiveShares,
      isShare,
    };
  }, [form]);

  const input = useMemo<PaperOrderInput | null>(() => {
    if (!parsed.validQty || !parsed.validPrice) return null;
    return {
      symbol,
      side: form.side,
      orderType: form.orderType,
      qty: parsed.qty,
      quantity_unit: form.quantityUnit,
      price: form.orderType === "market" ? null : parsed.price,
    };
  }, [form.orderType, form.side, form.quantityUnit, parsed, symbol]);

  const validationReason = !parsed.validQty
    ? parsed.isShare
      ? "零股股數必須是 1–999 的正整數。"
      : "股數必須是正整數。"
    : !parsed.validPrice
      ? "限價單需要有效價格。"
      : parsed.notionalExceedsCap
        ? `超過模擬資金 ${DEMO_CAPITAL_TWD.toLocaleString("zh-TW")} 元（預估 ${parsed.estimatedNotional?.toLocaleString("zh-TW", { maximumFractionDigits: 0 }) ?? "?"} 元）`
        : null;
  const ledgerState =
    orders.status === "blocked"
      ? "BLOCKED"
      : orders.status === "loading"
        ? "LOADING"
        : orders.items.length === 0
          ? "EMPTY"
          : "LIVE";

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
    // F2: form change invalidates the current draft; clear key so next preview generates a fresh one.
    setDraftKey(null);
  };

  const handlePreview = async () => {
    if (!input) return;
    setPreview({ status: "loading" });
    setSubmit({ status: "idle" });
    // F2: generate a stable draft key on first preview; reuse it on retry so the server can
    // deduplicate. Key encodes all intent fields + a mount-time timestamp to be unique per draft.
    const stableKey = draftKey ?? (() => {
      const ts = Date.now();
      const priceStr = input.price != null ? String(input.price) : "MKT";
      const key = `paper-${input.symbol}-${input.side}-${input.orderType}-${input.quantity_unit ?? "LOT"}-${input.qty}-${priceStr}-${ts}`;
      setDraftKey(key);
      return key;
    })();
    try {
      const result = await previewPaperOrder(input, stableKey);
      setPreview(result.blocked ? { status: "blocked", result } : { status: "live", result });
    } catch (error) {
      setPreview({ status: "error", message: formatPaperOrderError(error) });
    }
  };

  const handleSubmit = async () => {
    // F1: useRef guard — blocks duplicate network calls even if React batching delays the
    // disabled-button state by a tick (fast double-click protection).
    if (submitInFlight.current) return;
    if (!input || preview.status !== "live") return;
    submitInFlight.current = true;
    setSubmit({ status: "loading" });
    try {
      // F2: pass the same draft key used for preview so the server can deduplicate.
      const state = await submitPaperOrder(input, draftKey ?? undefined);
      setSubmit(state.intent.status === "REJECTED" ? { status: "blocked", state } : { status: "live", state });
      // F2: successful submit — clear draft key so a fresh draft gets a fresh key next time.
      setDraftKey(null);
      await refreshOrders();
    } catch (error) {
      setSubmit({ status: "error", message: formatPaperOrderError(error) });
      await refreshOrders();
    } finally {
      // F1: always release the in-flight guard so the button can be used again after an error.
      submitInFlight.current = false;
    }
  };

  const canSubmit = preview.status === "live" && !parsed.notionalExceedsCap;

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[06]</span> 模擬委託
      </h3>

      <div style={sourceBarStyle}>
        <StatePill state={ledgerState} />
        <span>模擬交易 / 風控預檢 / 個股委託紀錄</span>
      </div>

      <div style={bannerStyle}>
        此區只送模擬委託，不會送往凱基正式下單；正式送單等待 libCGCrypt.so 補齊後接上。
      </div>

      <div style={gridStyle}>
        <div>
          <label style={labelStyle}>方向</label>
          <Segmented options={SIDES} value={form.side} onChange={(side) => updateForm({ side })} />
        </div>
        <div>
          <label style={labelStyle}>類型</label>
          <Segmented
            options={TYPES}
            value={form.orderType}
            onChange={(orderType) => updateForm({ orderType, price: orderType === "market" ? "" : form.price })}
          />
        </div>
        <div>
          <label style={labelStyle}>單位</label>
          <Segmented
            options={QUANTITY_UNITS}
            value={form.quantityUnit}
            onChange={(quantityUnit) =>
              updateForm({
                quantityUnit,
                qty: quantityUnit === "SHARE" ? "1" : "1",
              })
            }
          />
        </div>
        <div>
          <label style={labelStyle}>
            {parsed.isShare ? "股數（零股）" : "張數（整股）"}
          </label>
          <input
            type="number"
            min={1}
            max={parsed.isShare ? 999 : undefined}
            value={form.qty}
            onChange={(event) => updateForm({ qty: event.target.value })}
            style={inputStyle}
          />
        </div>
        {form.orderType !== "market" && (
          <div>
            <label style={labelStyle}>價格</label>
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

      {/* Odd-lot indicator pill */}
      {parsed.isShare && (
        <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={oddLotPillStyle}>零股</span>
          <span style={{ fontSize: 10, color: "var(--night-mid, #888)", fontFamily: "var(--mono, monospace)" }}>
            1 股為單位 / 上限 999 股
          </span>
        </div>
      )}

      {/* Live notional preview + demo capital check */}
      {parsed.validQty && parsed.estimatedNotional !== null && (
        <div style={notionalPreviewStyle}>
          <div style={kvStyle}>
            <span>預估金額</span>
            <b style={parsed.notionalExceedsCap ? { color: "var(--tw-up-bright, #e63946)" } : {}}>
              {parsed.estimatedNotional.toLocaleString("zh-TW", { maximumFractionDigits: 0 })} 元
            </b>
          </div>
          <div style={kvStyle}>
            <span>模擬資金上限</span>
            <b>{DEMO_CAPITAL_TWD.toLocaleString("zh-TW")} 元</b>
          </div>
          {parsed.notionalExceedsCap && (
            <div style={{ color: "var(--tw-up-bright, #e63946)", fontFamily: "var(--mono, monospace)", fontSize: 11, paddingTop: 4 }}>
              超過模擬資金 {DEMO_CAPITAL_TWD.toLocaleString("zh-TW")} 元
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <span className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)" }}>股票</span>
        <span className="mono" style={{ marginLeft: 10, fontWeight: 700, fontSize: 15 }}>{symbol.toUpperCase()}</span>
      </div>

      {validationReason && <TruthNote state="BLOCKED" text={validationReason} />}

      <div className="action-row" style={{ gap: 8, marginBottom: 16 }}>
        <button
          className="btn-sm"
          onClick={handlePreview}
          disabled={input === null || preview.status === "loading"}
          title={validationReason ?? "執行模擬委託預覽"}
          type="button"
        >
          {preview.status === "loading" ? "預覽中" : "預覽風控"}
        </button>
        <button
          className="btn-sm"
          onClick={handleSubmit}
          disabled={!canSubmit || submit.status === "loading"}
          title={!canSubmit ? "請先完成通過的風控預覽。" : "只送出模擬委託。"}
          type="button"
          style={canSubmit ? { borderColor: "var(--gold, #b8960c)", color: "var(--gold, #b8960c)" } : {}}
        >
          {submit.status === "loading" ? "送出中" : "送出模擬單"}
        </button>
      </div>

      {preview.status === "idle" && (
        <TruthNote state="EMPTY" text="尚未預覽目前委託草稿。" />
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
          text={`模擬委託 ${submit.state.intent.id}：${orderStatusLabel(submit.state.intent.status)}${submit.state.intent.reason ? `：${submit.state.intent.reason}` : ""}`}
        />
      )}

      <div style={ledgerStyle}>
        <div style={ledgerHeaderStyle}>
          <span>個股模擬委託紀錄</span>
          <span>
            {orders.status === "live"
              ? `${uiStateLabel(ledgerState)} / ${orders.items.length} 筆 / ${formatTime(orders.updatedAt)}`
              : orders.status === "loading"
                ? "讀取中"
                : `暫停 / ${formatTime(orders.updatedAt)}`}
          </span>
        </div>
        {orders.status === "blocked" && <TruthNote state="BLOCKED" text={orders.message} />}
        {orders.status === "live" && orders.items.length === 0 && (
          <TruthNote state="EMPTY" text="此股票目前沒有模擬委託紀錄。" />
        )}
        {orders.status === "live" && orders.items.slice(0, 3).map((order) => (
          <div key={order.intent.id} style={orderRowStyle}>
            <span>{sideLabel(order.intent.side)} {order.intent.qty.toLocaleString()}</span>
            <span>{orderStatusLabel(order.intent.status)}</span>
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
      <TruthNote state={state} text={result.riskCheck.summary || `風控判斷：${result.riskCheck.decision}`} />
      <div style={kvStyle}><span>風控</span><b>{result.riskCheck.decision.toUpperCase()}</b></div>
      <div style={kvStyle}><span>報價</span><b>{result.quoteGate ? result.quoteGate.decision : "尚未檢查"}</b></div>
      <div style={kvStyle}><span>更新</span><b>{formatTime(result.riskCheck.createdAt)}</b></div>
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
  return <span style={{ color, fontWeight: 700, letterSpacing: "0.16em" }}>{uiStateLabel(state)}</span>;
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

const oddLotPillStyle: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(184,138,62,0.18)",
  border: "1px solid var(--gold, #b8960c)",
  color: "var(--gold-bright, #f4c430)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.10em",
  padding: "2px 7px",
};

const notionalPreviewStyle: React.CSSProperties = {
  border: "1px solid var(--night-rule-strong, #333)",
  padding: "8px 10px",
  marginBottom: 10,
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
};
