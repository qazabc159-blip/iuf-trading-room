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
import {
  estimateTaiwanStockNotional,
  formatTwd,
  quantityUnitDescription,
  quantityUnitLabel,
  toTaiwanStockShareCount,
  validateTaiwanStockQuantity,
  type TaiwanStockQuantityUnit,
} from "@/lib/order-units";
import {
  paperGateReasonLabel,
  paperQuoteDecisionLabel,
  paperQuoteSourceLabel,
  paperRiskDecisionLabel,
  paperRiskGuardLabel,
  paperRiskMessageLabel,
} from "@/lib/paper-order-vocab";

// Demo capital constant — must match DEMO_CAPITAL_TWD in order-intent.ts.
const DEMO_CAPITAL_TWD = 20_000;

type PaperSide = PaperOrderInput["side"];
type PaperOrderType = PaperOrderInput["orderType"];
type QuantityUnit = TaiwanStockQuantityUnit;

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
  { value: "SHARE", label: "零股" },
  { value: "LOT", label: "整張" },
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
  const [reviewOpen, setReviewOpen] = useState(false);

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
    const quantityReason = validateTaiwanStockQuantity(qty, form.quantityUnit);
    const validQty = quantityReason === null;
    const validPrice = !needsPrice || (Number.isFinite(price) && price > 0);
    // Effective share count for notional preview
    const effectiveShares = validQty ? toTaiwanStockShareCount(qty, form.quantityUnit) : 0;
    // Use form price for notional preview; if market order and price unknown, show null
    const refPrice = needsPrice ? price : (Number.isFinite(price) && price > 0 ? price : null);
    const estimatedNotional = refPrice && validQty
      ? estimateTaiwanStockNotional(refPrice, qty, form.quantityUnit)
      : null;
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
      quantityReason,
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
    ? parsed.quantityReason ?? "股數必須是正整數。"
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
    setReviewOpen(false);
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
      setReviewOpen(false);
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
            {parsed.isShare ? "股數（零股）" : "張數（整張）"}
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

      {/* Quantity-unit indicator pill */}
      {parsed.validQty && (
        <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={oddLotPillStyle}>{parsed.isShare ? "零股" : "整張"}</span>
          <span style={{ fontSize: 10, color: "var(--night-mid, #888)", fontFamily: "var(--mono, monospace)" }}>
            {quantityUnitDescription(form.quantityUnit)} / 實際 {parsed.effectiveShares.toLocaleString("zh-TW")} 股
          </span>
        </div>
      )}

      {/* Live notional preview + demo capital check */}
      {parsed.validQty && parsed.estimatedNotional !== null && (
        <div style={notionalPreviewStyle}>
          <div style={kvStyle}>
            <span>預估金額</span>
            <b style={parsed.notionalExceedsCap ? { color: "var(--tw-up-bright, #e63946)" } : {}}>
              {formatTwd(parsed.estimatedNotional)}
            </b>
          </div>
          <div style={kvStyle}>
            <span>模擬資金上限</span>
            <b>{formatTwd(DEMO_CAPITAL_TWD)}</b>
          </div>
          {parsed.notionalExceedsCap && (
            <div style={{ color: "var(--tw-up-bright, #e63946)", fontFamily: "var(--mono, monospace)", fontSize: 11, paddingTop: 4 }}>
              超過模擬資金 {formatTwd(DEMO_CAPITAL_TWD)}
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
          onClick={() => setReviewOpen(true)}
          disabled={!canSubmit || submit.status === "loading"}
          title={!canSubmit ? "請先完成通過的風控預覽。" : "送出前會開啟零股/整張確認視窗。"}
          type="button"
          style={canSubmit ? { borderColor: "var(--gold, #b8960c)", color: "var(--gold, #b8960c)" } : {}}
        >
          {submit.status === "loading" ? "送出中" : "檢查並送出"}
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
            <span>
              {sideLabel(order.intent.side)} {order.intent.qty.toLocaleString("zh-TW")} {quantityUnitLabel(order.intent.quantity_unit)}
              <small style={orderShareHintStyle}>
                實際 {toTaiwanStockShareCount(order.intent.qty, order.intent.quantity_unit).toLocaleString("zh-TW")} 股
              </small>
            </span>
            <span>{orderStatusLabel(order.intent.status)}</span>
            <span>{formatTime(order.intent.updatedAt)}</span>
          </div>
        ))}
      </div>

      {reviewOpen && input && (
        <CompanyOrderReviewModal
          input={input}
          canSubmit={canSubmit}
          isSubmitting={submit.status === "loading"}
          demoCapital={DEMO_CAPITAL_TWD}
          onCancel={() => setReviewOpen(false)}
          onConfirm={() => void handleSubmit()}
        />
      )}
    </section>
  );
}

function PreviewResult({ result }: { result: Awaited<ReturnType<typeof previewPaperOrder>> }) {
  const state = result.blocked ? "BLOCKED" : "LIVE";
  const blocked = result.riskCheck.guards.filter((guard) => guard.decision === "block");
  const riskDecision = paperRiskDecisionLabel(result.riskCheck.decision);
  return (
    <div style={previewBoxStyle}>
      <TruthNote state={state} text={paperRiskMessageLabel(result.riskCheck.summary) || `風控判斷：${riskDecision}`} />
      <div style={kvStyle}><span>風控</span><b>{riskDecision}</b></div>
      <div style={kvStyle}><span>報價</span><b>{result.quoteGate ? paperQuoteDecisionLabel(result.quoteGate.decision) : "尚未檢查"}</b></div>
      {result.quoteGate?.selectedSource && (
        <div style={kvStyle}><span>報價來源</span><b>{paperQuoteSourceLabel(result.quoteGate.selectedSource)}</b></div>
      )}
      <div style={kvStyle}><span>更新</span><b>{formatTime(result.riskCheck.createdAt)}</b></div>
      {blocked.map((guard) => (
        <div key={`${guard.guard}-${guard.message}`} style={blockedGuardStyle}>
          {paperRiskGuardLabel(guard.guard)}：{paperRiskMessageLabel(guard.message) || guard.message}
        </div>
      ))}
      {result.quoteGate?.reasons?.length ? (
        <div style={blockedGuardStyle}>
          {result.quoteGate.reasons.map((reason) => (
            <div key={reason}>報價原因：{paperGateReasonLabel(reason)}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CompanyOrderReviewModal({
  input,
  canSubmit,
  isSubmitting,
  demoCapital,
  onCancel,
  onConfirm,
}: {
  input: PaperOrderInput;
  canSubmit: boolean;
  isSubmitting: boolean;
  demoCapital: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const unit = input.quantity_unit;
  const qty = input.qty;
  const shares = toTaiwanStockShareCount(qty, unit);
  const price = input.price ?? null;
  const notional = price === null ? null : estimateTaiwanStockNotional(price, qty, unit);
  const lotNeedsAck = unit === "LOT";
  const [lotAcknowledged, setLotAcknowledged] = useState(!lotNeedsAck);
  const unitFormula = unit === "LOT"
    ? `${qty.toLocaleString("zh-TW")} 張 × 1,000 股/張 × ${price === null ? "市價" : formatTwd(price)}`
    : `${qty.toLocaleString("zh-TW")} 股 × ${price === null ? "市價" : formatTwd(price)}`;
  const overCapital = notional !== null && notional > demoCapital;
  const canConfirm = canSubmit && !overCapital && (!lotNeedsAck || lotAcknowledged);

  return (
    <div style={modalBackdropStyle} role="presentation">
      <div style={modalShellStyle} role="dialog" aria-modal="true" aria-label="模擬委託送出確認">
        <div style={modalHeaderStyle}>
          <div>
            <div className="tg" style={{ color: "var(--gold-bright)", fontWeight: 800 }}>模擬委託送出確認</div>
            <div style={modalSourceStyle}>台股單位防呆：零股=股，整張=1,000 股。本視窗確認後才送出模擬委託。</div>
          </div>
          <button type="button" onClick={onCancel} style={modalCloseStyle} disabled={isSubmitting}>取消</button>
        </div>

        <div style={reviewGridStyle}>
          <KV k="股票" v={input.symbol} />
          <KV k="方向" v={sideLabel(input.side)} />
          <KV k="類型" v={input.orderType === "market" ? "市價" : "限價"} />
          <KV
            k="單位"
            v={
              <span style={unitBadgeRowStyle}>
                <span style={unit === "SHARE" ? activeUnitBadgeStyle : unitBadgeStyle}>零股（SHARE）</span>
                <span style={unit === "LOT" ? activeUnitBadgeStyle : unitBadgeStyle}>整張（LOT）</span>
              </span>
            }
          />
          <KV k={unit === "LOT" ? "張數" : "股數"} v={qty.toLocaleString("zh-TW")} />
          <KV k="實際股數" v={`${shares.toLocaleString("zh-TW")} 股`} />
          <KV k="委託價格" v={price === null ? "市價，送出時依後端報價門檻處理" : formatTwd(price)} />
          <KV
            k="金額算式"
            v={notional === null ? "市價單待後端報價門檻計算" : `${unitFormula} = ${formatTwd(notional)}`}
          />
          <KV k="模擬可用資金" v={formatTwd(demoCapital)} />
          <KV k="預估佔用" v={notional === null ? "市價單待後端計算" : formatTwd(notional)} />
          <KV k="預估手續費" v="NT$0（模擬單；正式券商另依費率）" />
          <KV k="送出型態" v="模擬委託，不送券商" />
        </div>

        <TruthNote
          state={(unit === "LOT" && !lotAcknowledged) || overCapital ? "BLOCKED" : "LIVE"}
          text={
            overCapital
              ? `此單預估 ${formatTwd(notional ?? 0)}，超過模擬可用資金 ${formatTwd(demoCapital)}。`
              : unit === "LOT"
                ? "你目前選的是整張（LOT）：1 張一定會用 1,000 股計算。高價股測試請優先改用零股（SHARE）；若確定要測整張，請先勾選下方確認。"
                : "你目前選的是零股（SHARE）：1 股就是 1 股，送出資料也會明確標記為零股（quantity_unit=SHARE）。"
          }
        />

        {lotNeedsAck && (
          <label style={lotAckStyle}>
            <input
              checked={lotAcknowledged}
              disabled={isSubmitting || overCapital}
              onChange={(event) => setLotAcknowledged(event.target.checked)}
              type="checkbox"
            />
            <span>我知道這是整張委託，1 張會送出 1,000 股；不是零股測試。</span>
          </label>
        )}

        <div style={modalActionStyle}>
          <button type="button" onClick={onCancel} disabled={isSubmitting} style={secondaryActionStyle}>
            取消
          </button>
          <button type="button" onClick={onConfirm} disabled={!canConfirm || isSubmitting} style={primaryActionStyle}>
            {isSubmitting ? "送出中..." : "確認送出"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={reviewRowStyle}>
      <span>{k}</span>
      <b>{v}</b>
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
  gap: "8px 14px",
  alignItems: "center",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  lineHeight: 1.6,
  marginBottom: 14,
};

const bannerStyle: React.CSSProperties = {
  background: "rgba(184,138,62,0.14)",
  border: "1px solid var(--gold, #b8960c)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontWeight: 700,
  fontSize: 11,
  lineHeight: 1.8,
  padding: "12px 14px",
  letterSpacing: "0.08em",
  marginBottom: 18,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "16px 18px",
  marginBottom: 18,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--night-mid, #888)",
  display: "block",
  marginBottom: 7,
  fontFamily: "var(--mono, monospace)",
  letterSpacing: "0.16em",
};

const inputStyle: React.CSSProperties = {
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 12,
  minHeight: 48,
  padding: "12px 14px",
  width: "100%",
  boxSizing: "border-box",
};

const segmentedStyle: React.CSSProperties = {
  display: "flex",
  border: "1px solid var(--night-rule-strong, #333)",
  minHeight: 48,
};

const segmentButtonStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  padding: "12px 12px",
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
  padding: "10px 2px",
};

const previewBoxStyle: React.CSSProperties = {
  border: "1px solid var(--night-rule-strong, #333)",
  padding: "12px 14px",
  marginBottom: 12,
};

const kvStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  borderTop: "1px solid var(--night-rule, #222)",
  padding: "9px 0",
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
  gridTemplateColumns: "minmax(0, 1fr) 80px 70px",
  gap: 8,
  borderTop: "1px solid var(--night-rule, #222)",
  padding: "10px 2px",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
};

const orderShareHintStyle: React.CSSProperties = {
  display: "block",
  marginTop: 2,
  color: "var(--night-mid, #888)",
  fontSize: 10,
  lineHeight: 1.35,
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
  padding: "12px 14px",
  marginBottom: 10,
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(0,0,0,0.70)",
  backdropFilter: "blur(3px)",
};

const modalShellStyle: React.CSSProperties = {
  width: "min(720px, 96vw)",
  maxHeight: "86vh",
  overflow: "auto",
  border: "1px solid var(--gold, #b8960c)",
  background: "linear-gradient(180deg, rgba(14,15,16,0.98), rgba(4,6,8,0.98))",
  boxShadow: "0 24px 80px rgba(0,0,0,0.56)",
  padding: 22,
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  alignItems: "flex-start",
  borderBottom: "1px solid var(--night-rule-strong, #333)",
  paddingBottom: 16,
  marginBottom: 16,
};

const modalSourceStyle: React.CSSProperties = {
  marginTop: 6,
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
  lineHeight: 1.55,
};

const modalCloseStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  padding: "6px 10px",
  cursor: "pointer",
};

const reviewGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 0,
  borderTop: "1px solid var(--night-rule, #222)",
};

const reviewRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "150px minmax(0, 1fr)",
  gap: 12,
  alignItems: "start",
  borderBottom: "1px solid var(--night-rule, #222)",
  padding: "13px 2px",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 12,
  lineHeight: 1.6,
};

const unitBadgeRowStyle: React.CSSProperties = {
  display: "inline-flex",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: 6,
};

const unitBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  minHeight: 24,
  alignItems: "center",
  padding: "0 8px",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-mid, #888)",
  background: "rgba(255,255,255,0.018)",
  fontFamily: "var(--mono, monospace)",
  fontWeight: 800,
  fontSize: 10,
};

const activeUnitBadgeStyle: React.CSSProperties = {
  ...unitBadgeStyle,
  borderColor: "var(--gold, #b8960c)",
  color: "#080808",
  background: "var(--gold-bright, #f4c430)",
};

const modalActionStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  borderTop: "1px solid var(--night-rule-strong, #333)",
  marginTop: 16,
  paddingTop: 16,
};

const lotAckStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  marginTop: 12,
  padding: 12,
  border: "1px solid rgba(226,184,92,0.35)",
  background: "rgba(226,184,92,0.08)",
  color: "var(--night-ink, #f3f4f6)",
  fontFamily: "var(--sans-tc)",
  fontSize: 13,
  lineHeight: 1.65,
};

const secondaryActionStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontWeight: 700,
  padding: "12px 16px",
  cursor: "pointer",
};

const primaryActionStyle: React.CSSProperties = {
  background: "var(--gold, #b8960c)",
  border: "1px solid var(--gold-bright, #f4c430)",
  color: "#080808",
  fontFamily: "var(--mono, monospace)",
  fontWeight: 800,
  padding: "12px 18px",
  cursor: "pointer",
};
