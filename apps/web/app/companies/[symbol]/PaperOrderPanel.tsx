"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import {
  formatPaperOrderError,
  getPaperHealth,
  listPaperOrders,
  previewPaperOrder,
  submitPaperOrder,
  type PaperHealthState,
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

// Demo capital constant — must match PAPER_BROKER_INITIAL_CASH in Railway env (default 10,000,000).
const DEMO_CAPITAL_TWD = 10_000_000;

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

type PaperHealthUiState =
  | { status: "loading" }
  | { status: "live"; health: PaperHealthState; updatedAt: string }
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

const SHARE_QUANTITY_PRESETS = [1, 10, 100, 499, 999] as const;
const LOT_QUANTITY_PRESETS = [1, 2, 5] as const;
const COMPANY_PAGE_PAPER_SUBMIT_ENABLED = false;

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

function orderTypeLabel(type: PaperOrderType | string) {
  if (type === "market") return "市價";
  if (type === "limit") return "限價";
  if (type === "stop") return "停損";
  if (type === "stop_limit") return "停損限價";
  return String(type);
}

function formatPrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function quoteFreshnessLabel(value: string | null | undefined) {
  if (value === "fresh") return "報價新鮮";
  if (value === "stale") return "報價過舊";
  if (value === "missing") return "缺少報價";
  return "尚未取得";
}

function quoteReadinessLabel(value: string | null | undefined) {
  if (value === "ready") return "可用";
  if (value === "degraded") return "降級";
  if (value === "blocked") return "阻擋";
  return "待檢查";
}

function guardReasonList(result: Awaited<ReturnType<typeof previewPaperOrder>> | null) {
  if (!result) return [];
  const guards = result.riskCheck.guards
    .filter((guard) => guard.decision === "block" || guard.decision === "warn")
    .map((guard) => `${paperRiskGuardLabel(guard.guard)}：${paperRiskMessageLabel(guard.message) || guard.message}`);
  const quoteReasons = result.quoteGate?.reasons?.map((reason) => `報價：${paperGateReasonLabel(reason)}`) ?? [];
  return [...guards, ...quoteReasons];
}

export function PaperOrderPanel({ symbol, lastPrice = null }: { symbol: string; lastPrice?: number | null }) {
  const initialPrice = typeof lastPrice === "number" && Number.isFinite(lastPrice) ? String(lastPrice) : "";
  const [form, setForm] = useState<FormState>({
    side: "buy",
    orderType: "limit",
    qty: "1",
    price: initialPrice,
    quantityUnit: "SHARE",
  });
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [orders, setOrders] = useState<OrdersState>({ status: "loading" });
  const [paperHealth, setPaperHealth] = useState<PaperHealthUiState>({ status: "loading" });
  const [reviewOpen, setReviewOpen] = useState(false);
  const lastSymbolRef = useRef(symbol);

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
  const paperHealthReady = paperHealth.status === "live" && paperHealth.health.submitReady;
  const paperPreviewReady = paperHealth.status === "live" && paperHealth.health.previewReady;
  const quantityPresets = form.quantityUnit === "SHARE" ? SHARE_QUANTITY_PRESETS : LOT_QUANTITY_PRESETS;

  const refreshPaperHealth = async () => {
    setPaperHealth({ status: "loading" });
    try {
      const health = await getPaperHealth();
      setPaperHealth({ status: "live", health, updatedAt: new Date().toISOString() });
    } catch (error) {
      setPaperHealth({
        status: "blocked",
        message: formatPaperOrderError(error),
        updatedAt: new Date().toISOString(),
      });
    }
  };

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
    void refreshPaperHealth();
    void refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    const nextPrice = typeof lastPrice === "number" && Number.isFinite(lastPrice) ? String(lastPrice) : "";
    if (lastSymbolRef.current !== symbol) {
      lastSymbolRef.current = symbol;
      setForm((current) => ({ ...current, price: current.orderType === "market" ? "" : nextPrice }));
      return;
    }
    if (nextPrice && form.orderType !== "market" && form.price.trim() === "") {
      setForm((current) => ({ ...current, price: current.price.trim() === "" ? nextPrice : current.price }));
    }
  }, [form.orderType, form.price, lastPrice, symbol]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview({ status: "idle" });
    setSubmit({ status: "idle" });
    setReviewOpen(false);
    // F2: form change invalidates the current draft; clear key so next preview generates a fresh one.
    setDraftKey(null);
  };

  const canPreview = input !== null && validationReason === null && preview.status !== "loading";

  const handlePreview = async () => {
    if (!input || validationReason !== null) return;
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

  const canSubmit =
    COMPANY_PAGE_PAPER_SUBMIT_ENABLED
    && preview.status === "live"
    && !parsed.notionalExceedsCap
    && paperHealthReady;

  return (
    <section className="panel hud-frame paper-order-panel" id="paper-order">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">模擬委託</span>
        <span className="tg soft">零股 / 整張防呆</span>
      </h3>

      <div className="paper-order-source-row">
        <StatePill state={ledgerState} />
        <span>只送紙上交易 / 風控預檢 / 個股委託紀錄</span>
      </div>

      <div className="paper-order-lock-note">
        目前 paper 模式（虛擬下單）：所有委託只在模擬帳戶執行，不送凱基正式下單。
        {paperHealth.status === "live" && !paperHealth.health.gate.killSwitchOk && (
          <span style={{ color: "var(--tw-up-bright, #ff4d5f)", fontWeight: 700, marginLeft: 8 }}>
            killSwitch 守住
          </span>
        )}
      </div>

      <PaperHealthPanel state={paperHealth} />

      <div className="paper-order-price-row">
        <span>最新參考價</span>
        <b>{formatPrice(lastPrice)}</b>
        <small>
          {lastPrice ? "來自最新正式 K 線；限價可自行修改。" : "正式價格尚未回傳，請手動輸入限價。"}
        </small>
      </div>

      <div className="paper-order-workbench">
        <div className="paper-order-ticket">
          <div className="paper-order-grid">
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

          <div className="paper-order-summary-strip">
            <div>
              <span>股票</span>
              <b>{symbol.toUpperCase()}</b>
            </div>
            <div>
              <span>單位</span>
              <b>{parsed.isShare ? "零股" : "整張"}</b>
              <small>{quantityUnitDescription(form.quantityUnit)}</small>
            </div>
            <div>
              <span>實際股數</span>
              <b>{parsed.validQty ? parsed.effectiveShares.toLocaleString("zh-TW") : "--"}</b>
              <small>送出時標記為{parsed.isShare ? "零股" : "整張"}</small>
            </div>
            <div>
              <span>預估金額</span>
              <b className={parsed.notionalExceedsCap ? "status-bad" : ""}>
                {parsed.estimatedNotional !== null ? formatTwd(parsed.estimatedNotional) : "--"}
              </b>
              <small>模擬上限 {formatTwd(DEMO_CAPITAL_TWD)}</small>
            </div>
          </div>

          <PaperPreviewTruthPanel
            form={form}
            preview={preview}
            validationReason={validationReason}
            symbol={symbol}
            effectiveShares={parsed.effectiveShares}
            estimatedNotional={parsed.estimatedNotional}
            demoCapital={DEMO_CAPITAL_TWD}
            lastPrice={lastPrice}
          />

          <div className="paper-order-quick-row" aria-label={parsed.isShare ? "零股股數快選" : "整張張數快選"}>
            <span>{parsed.isShare ? "零股快選" : "整張快選"}</span>
            {quantityPresets.map((preset) => (
              <button
                key={`${form.quantityUnit}-${preset}`}
                type="button"
                className={Number(form.qty) === preset ? "is-active" : ""}
                onClick={() => updateForm({ qty: String(preset) })}
              >
                {parsed.isShare ? `${preset} 股` : `${preset} 張`}
              </button>
            ))}
          </div>

          {!parsed.isShare && (
            <TruthNote
              state={parsed.notionalExceedsCap ? "BLOCKED" : "EMPTY"}
              text={`整張模式會以 ${parsed.validQty ? parsed.effectiveShares.toLocaleString("zh-TW") : "--"} 股計算；高價股測試請切回零股。`}
            />
          )}

          {validationReason && <TruthNote state="BLOCKED" text={validationReason} />}

          <div className="action-row paper-order-actions">
            <button
              className="btn-sm"
              onClick={handlePreview}
              disabled={!canPreview}
              title={validationReason ?? (paperPreviewReady ? "執行模擬委託預覽" : "後端預覽閘門目前未開；仍可嘗試取得後端阻擋原因。")}
              type="button"
            >
              {preview.status === "loading" ? "預覽中" : "預覽風控"}
            </button>
            <button
              className="btn-sm"
              onClick={() => setReviewOpen(true)}
              disabled={!canSubmit || submit.status === "loading"}
              title={
                !COMPANY_PAGE_PAPER_SUBMIT_ENABLED
                  ? "目前 paper 模式（虛擬下單）：送出等待楊董明示後開啟。"
                  : paperHealth.status === "live" && !paperHealth.health.gate.killSwitchOk
                    ? "killSwitch 守住 — 全部送單暫停，等待楊董明示解除。"
                    : !paperHealthReady
                      ? "Paper E2E 送出閘門尚未開啟；不會送出模擬單。"
                      : !canSubmit
                        ? "請先完成通過的風控預覽。"
                        : "送出前會開啟零股/整張確認視窗。"
              }
              type="button"
              style={canSubmit ? {
                borderColor: "rgba(46,204,113,0.42)",
                color: "var(--tw-dn-bright, #2ecc71)",
                background: "rgba(46,204,113,0.05)",
              } : {}}
            >
              {submit.status === "loading"
                ? "送出中"
                : !COMPANY_PAGE_PAPER_SUBMIT_ENABLED
                  ? (paperHealth.status === "live" && !paperHealth.health.gate.killSwitchOk ? "killSwitch 守住" : "目前 Paper 模式")
                  : "檢查並送出"}
            </button>
          </div>

          <div className="paper-flow-guide" aria-label="紙上交易流程導引">
            <div>
              <span className="tg gold">流程導引</span>
              <strong>
                {preview.status === "live" || preview.status === "blocked"
                  ? "預覽結果已回來，下一步看紙上部位與成交明細。"
                  : "先做風控預覽，再到紙上部位確認是否有模擬結果。"}
              </strong>
              <small>公司頁目前只做 preview/check；不建立正式委託、不送券商、不用 FinMind 或 K 線當成交價。</small>
            </div>
            <Link className="terminal-button" href="/portfolio">
              查看紙上部位
            </Link>
          </div>
        </div>

        <div className="paper-order-sidecar">
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
        </div>
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

function PaperHealthPanel({ state }: { state: PaperHealthUiState }) {
  if (state.status === "loading") {
    return (
      <div style={paperHealthShellStyle}>
        <TruthNote state="EMPTY" text="正在確認 Paper E2E 後端閘門與委託資料庫狀態。" />
      </div>
    );
  }
  if (state.status === "blocked") {
    return (
      <div style={paperHealthShellStyle}>
        <TruthNote state="BLOCKED" text={`Paper E2E 健康檢查無法讀取：${state.message}`} />
      </div>
    );
  }

  const h = state.health;
  const killSwitchOn = !h.gate.killSwitchOk;
  const paperModeOff = !h.gate.paperModeOk;

  function execModeLabel(mode: string) {
    if (mode === "trading") return "可交易";
    if (mode === "paper_only") return "模擬模式";
    if (mode === "liquidate_only") return "只減倉";
    if (mode === "halted") return "全鎖定";
    return mode.replace(/_/g, " ");
  }

  // Honest gate note — name the exact blocker, never hide.
  let gateNote: string;
  if (h.gate.gateOpen) {
    gateNote = "閘門已開，可送出模擬委託。";
  } else if (killSwitchOn) {
    gateNote = "killSwitch 守住 — 全部送單已暫停，等待楊董明示解除。";
  } else if (paperModeOff) {
    gateNote = `目前執行模式：「${execModeLabel(h.gate.executionMode)}」，模擬送出功能未啟用。`;
  } else {
    gateNote = `後端 Paper 閘門未開；執行模式：${execModeLabel(h.gate.executionMode)}。`;
  }

  const persistenceText = h.persistence.dbError
    ? `資料庫異常：${h.persistence.dbError}`
    : `${h.persistence.mode} / paper_orders=${h.persistence.tableExists ? "可讀" : "未建立"}`;

  return (
    <div style={paperHealthShellStyle} aria-label="Paper E2E 後端健康狀態">
      <div style={paperHealthHeaderStyle}>
        <span>目前模式：紙上交易 (paper)</span>
        <span style={killSwitchOn ? { color: "var(--tw-up-bright, #ff4d5f)", fontWeight: 800 } : {}}>
          {killSwitchOn ? "killSwitch 守住" : "正常"} / {formatTime(state.updatedAt)}
        </span>
      </div>
      <div style={paperHealthGridStyle}>
        <PaperHealthCell label="預覽" ready={h.previewReady} note={gateNote} />
        <PaperHealthCell
          label="送出"
          ready={h.submitReady}
          note={h.submitReady ? "可建立模擬委託" : killSwitchOn ? "killSwitch 守住，送出暫停" : "送出閘門未開"}
        />
        <PaperHealthCell label="成交" ready={h.fillsReady} note={h.lastFillTs ? `最近成交 ${formatTime(h.lastFillTs)}` : "尚無成交"} />
        <PaperHealthCell label="部位" ready={h.portfolioReady} note={persistenceText} />
      </div>
      <div style={paperHealthFootStyle}>
        佇列 {h.queueDepth.toLocaleString("zh-TW")} 筆；此狀態只控制模擬交易，不觸碰凱基正式送單。
      </div>
    </div>
  );
}

function PaperHealthCell({ label, ready, note }: { label: string; ready: boolean; note: string }) {
  return (
    <div style={paperHealthCellStyle}>
      <span>{label}</span>
      <StatePill state={ready ? "LIVE" : "BLOCKED"} />
      <small>{note}</small>
    </div>
  );
}

function PaperPreviewTruthPanel({
  form,
  preview,
  validationReason,
  symbol,
  effectiveShares,
  estimatedNotional,
  demoCapital,
  lastPrice,
}: {
  form: FormState;
  preview: PreviewState;
  validationReason: string | null;
  symbol: string;
  effectiveShares: number;
  estimatedNotional: number | null;
  demoCapital: number;
  lastPrice: number | null;
}) {
  const result = preview.status === "live" || preview.status === "blocked" ? preview.result : null;
  const unitLabel = form.quantityUnit === "SHARE" ? "零股 / SHARE" : "整張 / LOT";
  const boardLabel = form.quantityUnit === "SHARE" ? "零股盤（1 股起，最多 999 股）" : "整股盤（1 張 = 1,000 股）";
  const riskLabel = result ? paperRiskDecisionLabel(result.riskCheck.decision) : validationReason ? "前端阻擋" : "尚未預覽";
  const quoteLabel = result?.quoteGate ? paperQuoteDecisionLabel(result.quoteGate.decision) : "尚未預覽";
  const quoteSource = result?.quoteGate?.selectedSource ? paperQuoteSourceLabel(result.quoteGate.selectedSource) : "尚未選定";
  const previewTime = result?.riskCheck.createdAt ? formatTime(result.riskCheck.createdAt) : "--";
  const reasons = guardReasonList(result);
  const quoteContext = result?.quoteGate?.quoteContext;
  const referencePrice = quoteContext?.last ?? lastPrice;
  const quoteUpdatedAt = quoteContext?.capturedAt ? formatTime(quoteContext.capturedAt) : "--";
  const warningText = form.quantityUnit === "LOT"
    ? "整張模式一定用張數 × 1,000 股計算；高價股測試請改零股。"
    : "零股模式送出資料會明確標記 quantity_unit=SHARE；1 股就是 1 股。";

  return (
    <div className="paper-preview-truth-panel" aria-label="模擬委託預覽真實狀態">
      <div style={truthPanelHeaderStyle}>
        <span style={paperBadgeStyle}>PAPER / PREVIEW ONLY</span>
        <span>此區只做風控與報價預覽，不建立 paper order，不送券商。</span>
      </div>
      <div style={truthPanelGridStyle}>
        <TruthCell label="股票" value={symbol.toUpperCase()} note="公司頁草稿" />
        <TruthCell label="方向 / 類型" value={`${sideLabel(form.side)} / ${orderTypeLabel(form.orderType)}`} note="不是投資建議" />
        <TruthCell label="單位" value={unitLabel} note={boardLabel} tone={form.quantityUnit === "LOT" ? "warn" : "ok"} />
        <TruthCell label="數量" value={`${Number(form.qty || 0).toLocaleString("zh-TW")} ${form.quantityUnit === "LOT" ? "張" : "股"}`} note={`實際 ${effectiveShares.toLocaleString("zh-TW")} 股`} />
        <TruthCell label="預估金額" value={estimatedNotional === null ? "--" : formatTwd(estimatedNotional)} note={`模擬資金 ${formatTwd(demoCapital)}`} tone={estimatedNotional !== null && estimatedNotional > demoCapital ? "bad" : "ok"} />
        <TruthCell label="參考價" value={referencePrice ? formatPrice(referencePrice) : "--"} note={quoteContext ? `報價更新 ${quoteUpdatedAt}` : "來自最新 K 線或手動限價；不作為成交價"} />
        <TruthCell label="風控結果" value={riskLabel} note={preview.status === "loading" ? "預覽中" : `預覽時間 ${previewTime}`} tone={result?.blocked || validationReason ? "bad" : result ? "ok" : "warn"} />
        <TruthCell label="報價狀態" value={quoteLabel} note={`${quoteSource} / ${quoteReadinessLabel(result?.quoteGate?.readiness)} / ${quoteFreshnessLabel(result?.quoteGate?.freshnessStatus)}`} tone={result?.quoteGate?.blocked ? "bad" : result?.quoteGate ? "ok" : "warn"} />
      </div>
      <div style={truthPanelFootStyle}>
        <TruthNote state={validationReason || result?.blocked ? "BLOCKED" : result ? "LIVE" : "EMPTY"} text={validationReason ?? (reasons[0] ?? warningText)} />
        <TruthNote state="EMPTY" text="FinMind 與 K 線只提供資料檢視，不當作成交價、fill price 或風控來源；正式成交仍等待後端 paper pipeline 與審計路徑。" />
      </div>
      {reasons.length > 1 && (
        <div style={truthReasonListStyle}>
          {reasons.slice(1, 5).map((reason) => (
            <div key={reason}>{reason}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function TruthCell({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const color = tone === "ok"
    ? "var(--tw-dn-bright, #2ecc71)"
    : tone === "bad"
      ? "var(--tw-up-bright, #ff4d5f)"
      : tone === "warn"
        ? "var(--gold-bright, #f0b429)"
        : "var(--night-ink, #d8d4c8)";
  return (
    <div style={truthCellStyle}>
      <span>{label}</span>
      <b style={{ color }}>{value}</b>
      <small>{note}</small>
    </div>
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
  const color = state === "LIVE" ? "var(--tw-dn-bright)"
    : state === "EMPTY" ? "var(--gold-bright)"
      : state === "LOADING" ? "var(--gold)"
        : "var(--tw-up-bright)";
  return <span className={`state-pill state-pill-${state.toLowerCase()}`} style={{ color, fontWeight: 700, letterSpacing: "0.10em" }}>{uiStateLabel(state)}</span>;
}

function TruthNote({ state, text }: { state: "LIVE" | "EMPTY" | "BLOCKED"; text: string }) {
  return (
    <div className={`truth-note truth-note-${state.toLowerCase()}`} style={truthNoteStyle}>
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
  return date.toLocaleTimeString("zh-TW", {
    hour12: false,
    timeZone: "Asia/Taipei",
  });
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--night-mid, #888)",
  display: "block",
  marginBottom: 5,
  fontFamily: "var(--sans-tc)",
  letterSpacing: 0,
};

const inputStyle: React.CSSProperties = {
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 13,
  minHeight: 38,
  padding: "9px 11px",
  width: "100%",
  boxSizing: "border-box",
};

const segmentedStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "nowrap",
  border: "1px solid var(--night-rule-strong, #333)",
  minHeight: 36,
  width: "100%",
  overflow: "hidden",
};

const segmentButtonStyle: React.CSSProperties = {
  flex: "1 1 70px",
  minWidth: 58,
  minHeight: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  padding: "7px 10px",
  fontFamily: "var(--sans-tc)",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.25,
  whiteSpace: "nowrap",
  wordBreak: "keep-all",
  cursor: "pointer",
};

const truthNoteStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: 10,
  alignItems: "flex-start",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
  lineHeight: 1.7,
  padding: "10px 11px",
  border: "1px solid var(--night-rule, #222)",
  background: "rgba(1,5,9,0.2)",
};

const paperHealthShellStyle: React.CSSProperties = {
  borderTop: "1px solid var(--night-rule-strong, #333)",
  borderBottom: "1px solid var(--night-rule, #222)",
  padding: "12px 0 14px",
  marginBottom: 14,
};

const paperHealthHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  letterSpacing: "0.08em",
  marginBottom: 10,
};

const paperHealthGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  border: "1px solid var(--night-rule, #222)",
};

const paperHealthCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 6,
  alignContent: "start",
  borderRight: "1px solid var(--night-rule, #222)",
  padding: "10px 12px",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  lineHeight: 1.45,
};

const paperHealthFootStyle: React.CSSProperties = {
  marginTop: 9,
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  lineHeight: 1.5,
};

const truthPanelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  color: "var(--night-mid, #888)",
  fontFamily: "var(--sans-tc)",
  fontSize: 11,
  lineHeight: 1.5,
  paddingBottom: 10,
};

const paperBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 24,
  padding: "3px 8px",
  border: "1px solid rgba(240,180,41,0.46)",
  background: "rgba(184,138,62,0.12)",
  color: "var(--gold-bright, #f0b429)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.04em",
};

const truthPanelGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
  border: "1px solid var(--night-rule, #222)",
  background: "rgba(1,5,9,0.16)",
};

const truthPanelFootStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  marginTop: 10,
};

const truthCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 5,
  alignContent: "start",
  borderRight: "1px solid var(--night-rule, #222)",
  borderBottom: "1px solid var(--night-rule, #222)",
  padding: "10px 12px",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  lineHeight: 1.35,
};

const truthReasonListStyle: React.CSSProperties = {
  marginTop: 10,
  display: "grid",
  gap: 7,
  color: "var(--tw-up-bright, #ff4d5f)",
  fontFamily: "var(--sans-tc)",
  fontSize: 11,
  lineHeight: 1.55,
};

const previewBoxStyle: React.CSSProperties = {
  borderTop: "1px solid var(--night-rule-strong, #333)",
  borderBottom: "1px solid var(--night-rule, #222)",
  padding: "14px 0 16px",
  marginBottom: 18,
};

const kvStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  borderTop: "1px solid var(--night-rule, #222)",
  padding: "14px 0",
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
  paddingTop: 12,
};

const ledgerHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  letterSpacing: "0.10em",
};

const orderRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 80px 70px",
  gap: 12,
  borderTop: "1px solid var(--night-rule, #222)",
  padding: "14px 0",
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
  padding: 32,
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 22,
  alignItems: "flex-start",
  borderBottom: "1px solid var(--night-rule-strong, #333)",
  paddingBottom: 24,
  marginBottom: 24,
};

const modalSourceStyle: React.CSSProperties = {
  marginTop: 8,
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
  lineHeight: 1.7,
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
  gap: 16,
  alignItems: "start",
  borderBottom: "1px solid var(--night-rule, #222)",
  padding: "18px 8px",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 12,
  lineHeight: 1.6,
};

const unitBadgeRowStyle: React.CSSProperties = {
  display: "inline-flex",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: 8,
};

const unitBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  minHeight: 28,
  alignItems: "center",
  padding: "0 10px",
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
  gap: 18,
  borderTop: "1px solid var(--night-rule-strong, #333)",
  marginTop: 26,
  paddingTop: 24,
};

const lotAckStyle: React.CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "flex-start",
  marginTop: 22,
  padding: 18,
  border: "1px solid rgba(226,184,92,0.35)",
  background: "rgba(226,184,92,0.08)",
  color: "var(--night-ink, #f3f4f6)",
  fontFamily: "var(--sans-tc)",
  fontSize: 13,
  lineHeight: 1.75,
};

const secondaryActionStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontWeight: 700,
  padding: "14px 18px",
  cursor: "pointer",
};

const primaryActionStyle: React.CSSProperties = {
  background: "var(--gold, #b8960c)",
  border: "1px solid var(--gold-bright, #f4c430)",
  color: "#080808",
  fontFamily: "var(--mono, monospace)",
  fontWeight: 800,
  padding: "14px 20px",
  cursor: "pointer",
};
