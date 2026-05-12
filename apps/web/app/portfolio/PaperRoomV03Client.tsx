"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";

import type { CompanyRealtimeQuote, OhlcvBar } from "@/lib/api";
import {
  cancelPaperOrder,
  formatPaperOrderError,
  isCancellablePaperOrder,
  listPaperOrders,
  previewPaperOrder,
  submitPaperOrder,
  type KgiLivePosition,
  type KgiPositionsResponse,
  type PaperFillLedgerRow,
  type PaperHealthState,
  type PaperOrderInput,
  type PaperOrderState,
  type PaperPortfolioPosition,
} from "@/lib/paper-orders-api";
import {
  estimateTaiwanStockNotional,
  quantityUnitDescription,
  quantityUnitLabel,
  toTaiwanStockShareCount,
  validateTaiwanStockQuantity,
  type TaiwanStockQuantityUnit,
} from "@/lib/order-units";
import {
  paperGateReasonLabel,
  paperRiskGuardLabel,
  paperRiskMessageLabel,
} from "@/lib/paper-order-vocab";

import styles from "./paper-room-v03.module.css";

const PAPER_CAPITAL_TWD = 20_000;

export type PaperCandidateV03 = {
  symbol: string;
  name: string;
  score: number;
  confidence: number;
  signalCount: number;
  decision: "allow" | "review" | "block";
  theme: string;
};

type PortfolioState =
  | { state: "LIVE"; positions: PaperPortfolioPosition[]; updatedAt: string }
  | { state: "EMPTY"; positions: PaperPortfolioPosition[]; updatedAt: string; reason: string }
  | { state: "BLOCKED"; positions: PaperPortfolioPosition[]; updatedAt: string; reason: string };

type FillsState =
  | { state: "LIVE"; fills: PaperFillLedgerRow[]; updatedAt: string }
  | { state: "EMPTY"; fills: PaperFillLedgerRow[]; updatedAt: string; reason: string }
  | { state: "BLOCKED"; fills: PaperFillLedgerRow[]; updatedAt: string; reason: string };

type OrdersState =
  | { state: "LIVE"; orders: PaperOrderState[]; updatedAt: string }
  | { state: "EMPTY"; orders: PaperOrderState[]; updatedAt: string; reason: string }
  | { state: "BLOCKED"; orders: PaperOrderState[]; updatedAt: string; reason: string };

type HealthState =
  | { state: "LIVE"; health: PaperHealthState; updatedAt: string }
  | { state: "BLOCKED"; health: null; updatedAt: string; reason: string };

type KgiState =
  | { state: "LIVE"; data: KgiPositionsResponse; updatedAt: string }
  | { state: "UNAVAILABLE"; data: KgiPositionsResponse; updatedAt: string; reason: string }
  | { state: "BLOCKED"; data: null; updatedAt: string; reason: string };

type MarketState =
  | {
      state: "LIVE";
      symbol: string;
      companyName: string;
      bars: OhlcvBar[];
      quote: CompanyRealtimeQuote | null;
      updatedAt: string;
      source: string;
    }
  | {
      state: "EMPTY" | "BLOCKED";
      symbol: string;
      companyName: string;
      bars: OhlcvBar[];
      quote: CompanyRealtimeQuote | null;
      updatedAt: string;
      source: string;
      reason: string;
    };

type Props = {
  portfolioState: PortfolioState;
  fillsState: FillsState;
  ordersState: OrdersState;
  healthState: HealthState;
  kgiState: KgiState;
  marketState: MarketState;
  candidates: PaperCandidateV03[];
};

type WatchItem = {
  symbol: string;
  name: string;
  meta: string;
  group: "my" | "signals" | "paper";
  price: number | null;
  changePct: number | null;
};

type TicketSide = PaperOrderInput["side"];
type TicketOrderType = PaperOrderInput["orderType"];
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

function formatTwd(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `NT$${value.toLocaleString("zh-TW", { maximumFractionDigits: digits })}`;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function formatPct(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "待報價";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function sideLabel(side: string) {
  return side === "buy" ? "買進" : "賣出";
}

function orderTypeLabel(orderType: string) {
  if (orderType === "market") return "市價";
  if (orderType === "limit") return "限價";
  if (orderType === "stop") return "停損";
  return "停損限價";
}

function orderStatusLabel(status: string) {
  if (status === "FILLED") return "已成交";
  if (status === "REJECTED") return "已拒絕";
  if (status === "CANCELLED") return "已撤單";
  if (status === "ACCEPTED") return "已接受";
  if (status === "PENDING") return "待處理";
  return status;
}

function fillNotional(fill: PaperFillLedgerRow) {
  const shares = fill.quantity_unit === "LOT" ? fill.fillQty * 1000 : fill.fillQty;
  return shares * fill.fillPrice;
}

function positionCost(position: PaperPortfolioPosition) {
  if (position.avgCostPerShare === null || position.netQtyShares <= 0) return null;
  return position.avgCostPerShare * position.netQtyShares;
}

function gateLabel(health: PaperHealthState | null) {
  if (!health) return "待檢查";
  if (health.previewReady && health.submitReady) return "Paper 可預覽 / 可送出";
  if (health.previewReady) return "Paper 可預覽";
  return "Paper 待開啟";
}

function latestClose(bars: OhlcvBar[]) {
  return bars.at(-1)?.close ?? null;
}

function previousClose(bars: OhlcvBar[]) {
  return bars.length >= 2 ? bars.at(-2)?.close ?? null : null;
}

function changePctFromBars(bars: OhlcvBar[]) {
  const last = latestClose(bars);
  const prev = previousClose(bars);
  if (!last || !prev) return null;
  return ((last - prev) / prev) * 100;
}

function previewGuardList(result: Awaited<ReturnType<typeof previewPaperOrder>> | null) {
  if (!result) return [];
  const guards =
    result.riskCheck?.guards
      ?.filter((guard) => guard.decision === "block" || guard.decision === "warn")
      .map((guard) => `${paperRiskGuardLabel(guard.guard)}：${paperRiskMessageLabel(guard.message) || guard.message}`) ?? [];
  const quoteReasons = result.quoteGate?.reasons?.map((reason) => `報價：${paperGateReasonLabel(reason)}`) ?? [];
  return [...guards, ...quoteReasons];
}

function buildWatchItems(
  portfolio: PaperPortfolioPosition[],
  candidates: PaperCandidateV03[],
  market: MarketState,
): WatchItem[] {
  const rows = new Map<string, WatchItem>();
  const seedPrice = market.quote?.lastPrice ?? latestClose(market.bars);
  const seedChange = changePctFromBars(market.bars);

  rows.set(market.symbol, {
    symbol: market.symbol,
    name: market.companyName,
    meta: market.source,
    group: "my",
    price: seedPrice,
    changePct: seedChange,
  });

  for (const position of portfolio) {
    if (!rows.has(position.symbol)) {
      rows.set(position.symbol, {
        symbol: position.symbol,
        name: position.symbol,
        meta: `${position.netQtyShares.toLocaleString("zh-TW")} 股 · 模擬持倉`,
        group: "my",
        price: null,
        changePct: null,
      });
    }
  }

  for (const candidate of candidates) {
    const existing = rows.get(candidate.symbol);
    const item: WatchItem = {
      symbol: candidate.symbol,
      name: candidate.name,
      meta: `${candidate.theme} · ${candidate.signalCount} 訊號`,
      group: candidate.decision === "allow" ? "paper" : "signals",
      price: existing?.price ?? null,
      changePct: existing?.changePct ?? null,
    };
    rows.set(candidate.symbol, existing ? { ...item, group: existing.group } : item);
  }

  return [...rows.values()].slice(0, 18);
}

function chartPoints(bars: OhlcvBar[]) {
  const visible = bars.slice(-80);
  if (visible.length === 0) return { bars: visible, min: 0, max: 1 };
  const lows = visible.map((bar) => bar.low);
  const highs = visible.map((bar) => bar.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = Math.max((max - min) * 0.08, 1);
  return { bars: visible, min: min - pad, max: max + pad };
}

function makeLinePath(bars: OhlcvBar[], min: number, max: number) {
  if (bars.length === 0) return "";
  return bars.map((bar, index) => {
    const x = bars.length === 1 ? 500 : (index / (bars.length - 1)) * 1000;
    const y = 300 - ((bar.close - min) / (max - min || 1)) * 260;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function makeAreaPath(bars: OhlcvBar[], min: number, max: number) {
  const line = makeLinePath(bars, min, max);
  if (!line) return "";
  return `${line} L1000 320 L0 320 Z`;
}

function kgiStatusLabel(kgi: KgiState) {
  if (kgi.state === "LIVE") return "唯讀可用";
  if (kgi.state === "UNAVAILABLE") {
    if (kgi.data.status === "ok") return "無持倉";
    if (kgi.data.status === "gateway_not_authenticated") return "待登入";
    return "暫不可用";
  }
  return "暫停";
}

export function PaperRoomV03Client({
  candidates,
  fillsState,
  healthState,
  kgiState,
  marketState,
  ordersState,
  portfolioState,
}: Props) {
  const health = healthState.state === "LIVE" ? healthState.health : null;
  const [activeGroup, setActiveGroup] = useState<WatchItem["group"]>("my");
  const [selectedSymbol, setSelectedSymbol] = useState(marketState.symbol);
  const [timeframe, setTimeframe] = useState("1d");
  const [ledgerTab, setLedgerTab] = useState<"orders" | "fills" | "positions" | "kgi">("orders");
  const [side, setSide] = useState<TicketSide>("buy");
  const [orderType, setOrderType] = useState<TicketOrderType>("limit");
  const [quantityUnit, setQuantityUnit] = useState<TaiwanStockQuantityUnit>("SHARE");
  const [qty, setQty] = useState("1");
  const initialPrice = marketState.quote?.lastPrice ?? latestClose(marketState.bars);
  const [price, setPrice] = useState(initialPrice ? String(initialPrice) : "");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [orders, setOrders] = useState<PaperOrderState[]>(ordersState.orders);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const submitInFlight = useRef(false);
  const [draftKey, setDraftKey] = useState<string | null>(null);

  const watchItems = useMemo(() => buildWatchItems(portfolioState.positions, candidates, marketState), [candidates, marketState, portfolioState.positions]);
  const filteredWatch = watchItems.filter((item) => item.group === activeGroup || (activeGroup === "my" && item.symbol === marketState.symbol));
  const selectedWatch = watchItems.find((item) => item.symbol === selectedSymbol) ?? watchItems[0];
  const selectedHasMarket = selectedSymbol === marketState.symbol;
  const bars = selectedHasMarket ? marketState.bars : [];
  const chart = chartPoints(bars);
  const linePath = makeLinePath(chart.bars, chart.min, chart.max);
  const areaPath = makeAreaPath(chart.bars, chart.min, chart.max);
  const hoverBar = hoverIndex === null ? chart.bars.at(-1) ?? null : chart.bars[hoverIndex] ?? null;
  const last = marketState.quote?.lastPrice ?? latestClose(bars);
  const changePct = selectedHasMarket ? changePctFromBars(bars) : selectedWatch?.changePct ?? null;
  const up = (changePct ?? 0) >= 0;

  const parsed = useMemo(() => {
    const q = Number(qty);
    const p = Number(price);
    const needsPrice = orderType !== "market";
    const qtyReason = validateTaiwanStockQuantity(q, quantityUnit);
    const validQty = qtyReason === null;
    const validPrice = !needsPrice || (Number.isFinite(p) && p > 0);
    const estimatedNotional = validQty && validPrice
      ? estimateTaiwanStockNotional(needsPrice ? p : (last ?? p), q, quantityUnit)
      : null;
    const capExceeded = estimatedNotional !== null && estimatedNotional > PAPER_CAPITAL_TWD;
    return { q, p, needsPrice, qtyReason, validQty, validPrice, estimatedNotional, capExceeded };
  }, [last, orderType, price, qty, quantityUnit]);

  const input = useMemo<PaperOrderInput | null>(() => {
    if (!parsed.validQty || !parsed.validPrice || parsed.capExceeded) return null;
    return {
      symbol: selectedSymbol,
      side,
      orderType,
      qty: parsed.q,
      quantity_unit: quantityUnit,
      price: orderType === "market" ? null : parsed.p,
    };
  }, [orderType, parsed.capExceeded, parsed.p, parsed.q, parsed.validPrice, parsed.validQty, quantityUnit, selectedSymbol, side]);

  const validationReason = !parsed.validQty
    ? parsed.qtyReason ?? "數量必須是正整數。"
    : !parsed.validPrice
      ? "限價單需要有效價格。"
      : parsed.capExceeded
        ? `超過模擬資金 ${PAPER_CAPITAL_TWD.toLocaleString("zh-TW")} 元。`
        : null;

  const clearDraft = () => {
    setPreview({ status: "idle" });
    setSubmit({ status: "idle" });
    setDraftKey(null);
    setMessage(null);
  };

  const refreshOrders = async () => {
    try {
      const next = await listPaperOrders();
      setOrders(next.slice().reverse());
    } catch (error) {
      setMessage(formatPaperOrderError(error));
    }
  };

  const handlePreview = async () => {
    if (!input) return;
    setPreview({ status: "loading" });
    setSubmit({ status: "idle" });
    const stableKey = draftKey ?? `paper-room-${input.symbol}-${input.side}-${input.orderType}-${input.quantity_unit}-${input.qty}-${input.price ?? "MKT"}-${Date.now()}`;
    setDraftKey(stableKey);
    try {
      const result = await previewPaperOrder(input, stableKey);
      setPreview(result.blocked ? { status: "blocked", result } : { status: "live", result });
    } catch (error) {
      setPreview({ status: "error", message: formatPaperOrderError(error) });
    }
  };

  const handleSubmit = async () => {
    if (submitInFlight.current || !input || preview.status !== "live" || preview.result.blocked || !health?.submitReady) return;
    submitInFlight.current = true;
    setSubmit({ status: "loading" });
    try {
      const state = await submitPaperOrder(input, draftKey ?? undefined);
      setSubmit(state.intent.status === "REJECTED" ? { status: "blocked", state } : { status: "live", state });
      setDraftKey(null);
      await refreshOrders();
    } catch (error) {
      setSubmit({ status: "error", message: formatPaperOrderError(error) });
    } finally {
      submitInFlight.current = false;
    }
  };

  const handleCancel = async (orderId: string) => {
    setMessage(null);
    try {
      await cancelPaperOrder(orderId, "operator_cancelled_from_paper_room");
      await refreshOrders();
    } catch (error) {
      setMessage(formatPaperOrderError(error));
    }
  };

  const onChartMove = (clientX: number, rect: DOMRect) => {
    if (chart.bars.length === 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (chart.bars.length - 1)));
  };

  const filteredOrders = orders.filter((order) => order.intent.symbol === selectedSymbol || ledgerTab !== "orders");
  const previewGuards = preview.status === "live" || preview.status === "blocked" ? previewGuardList(preview.result) : [];
  const canSubmit = preview.status === "live" && !preview.result.blocked && !!health?.submitReady;

  return (
    <div className={styles.page}>
      <div className={styles.bgGrid} />
      <div className={styles.topBar}>
        <div className={styles.brand}><i /><span>IUF</span><b>· 情報—決策—倉位</b></div>
        <nav>
          <Link href="/market-intel">市場情報</Link>
          <Link href="/ideas">策略想法</Link>
          <b>模擬交易室</b>
        </nav>
        <div className={styles.operator}>操盤員 <b>IUF-01</b></div>
      </div>

      <div className={styles.safeBar}>
        <span><i />PAPER MODE ACTIVE</span>
        <span className={styles.locked}><i />REAL ORDER DISABLED</span>
        <span className={styles.readOnly}><i />KGI READ-ONLY</span>
        <span className={styles.isolated}><i />SAFE · PAPER ISOLATED</span>
                  <b>本頁所有委託只走模擬通道，不會送出真實委託。</b>
      </div>

      <main className={styles.room}>
        <aside className={styles.leftPane}>
          <div className={styles.panelHead}><h3>觀察清單</h3><span>{watchItems.length} 檔</span></div>
          <label className={styles.search}><span>⌕</span><input placeholder="輸入代碼或名稱搜尋" /></label>
          <div className={styles.watchTabs}>
            {([
              ["my", "自選"],
              ["signals", "今日訊號"],
              ["paper", "Paper 候選"],
            ] as const).map(([value, label]) => (
              <button className={activeGroup === value ? styles.activeTab : ""} key={value} type="button" onClick={() => setActiveGroup(value)}>
                {label}<span>{watchItems.filter((item) => item.group === value).length}</span>
              </button>
            ))}
          </div>
          <div className={styles.watchList}>
            {filteredWatch.length > 0 ? filteredWatch.map((item) => (
              <button
                className={`${styles.watchRow} ${selectedSymbol === item.symbol ? styles.selectedWatch : ""}`}
                key={`${item.group}-${item.symbol}`}
                type="button"
                onClick={() => {
                  setSelectedSymbol(item.symbol);
                  clearDraft();
                }}
              >
                <span className={styles.watchSymbol}>{item.symbol}</span>
                <div><b>{item.name}</b><small>{item.meta}</small></div>
                <strong>
                  {formatNumber(item.price, 2)}
                  <em className={(item.changePct ?? 0) >= 0 ? styles.up : styles.down}>{formatPct(item.changePct)}</em>
                </strong>
              </button>
            )) : (
              <div className={styles.emptyBox}>目前沒有此分組的候選。</div>
            )}
          </div>
        </aside>

        <section className={styles.centerPane}>
          <div className={styles.symbolHead}>
            <div>
              <div className={styles.symbolLine}>
                <span>{selectedSymbol}</span>
                <div>
                  <h1>{selectedWatch?.name ?? marketState.companyName}</h1>
                  <p>{selectedHasMarket ? marketState.source : "此檔 K 線待接入；先保留 Paper ticket hook"}</p>
                </div>
              </div>
            </div>
            <div className={styles.priceBlock}>
              <b className={up ? styles.up : styles.down}>{formatNumber(last, 2)}</b>
              <span className={up ? styles.up : styles.down}>{formatPct(changePct)}</span>
            </div>
            <div className={styles.statGrid}>
              <div><span>開</span><b>{formatNumber(hoverBar?.open, 2)}</b></div>
              <div><span>高</span><b>{formatNumber(hoverBar?.high, 2)}</b></div>
              <div><span>低</span><b>{formatNumber(hoverBar?.low, 2)}</b></div>
              <div><span>收</span><b>{formatNumber(hoverBar?.close, 2)}</b></div>
              <div><span>量</span><b>{formatNumber(hoverBar?.volume, 0)}</b></div>
            </div>
          </div>

          <div className={styles.chartPanel}>
            <div className={styles.chartTools}>
              <div className={styles.timeframes}>
                {["1m", "5m", "15m", "1d", "1w"].map((tf) => (
                  <button className={timeframe === tf ? styles.activeTab : ""} key={tf} type="button" onClick={() => setTimeframe(tf)}>
                    {tf}
                  </button>
                ))}
              </div>
                <span>{timeframe === "1d" ? "日 K / 可用資料" : "盤中週期待資料接線"}</span>
              <b>{hoverBar?.dt ?? marketState.updatedAt}</b>
            </div>
            <div className={styles.chartWrap}>
              {chart.bars.length > 0 ? (
                <svg
                  className={styles.chart}
                  onMouseLeave={() => setHoverIndex(null)}
                  onMouseMove={(event) => onChartMove(event.clientX, event.currentTarget.getBoundingClientRect())}
                  preserveAspectRatio="none"
                  viewBox="0 0 1000 360"
                >
                  <defs>
                    <linearGradient id="paper-room-area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(46,204,113,.40)" />
                      <stop offset="100%" stopColor="rgba(46,204,113,0)" />
                    </linearGradient>
                  </defs>
                  {[70, 140, 210, 280, 320].map((y) => <line className={styles.gridLine} key={y} x1="0" x2="1000" y1={y} y2={y} />)}
                  <path className={styles.areaPath} d={areaPath} />
                  <path className={styles.linePath} d={linePath} />
                  {chart.bars.map((bar, index) => {
                    const x = chart.bars.length === 1 ? 500 : (index / (chart.bars.length - 1)) * 1000;
                    const volHeight = Math.min(46, Math.max(3, (bar.volume / Math.max(...chart.bars.map((b) => b.volume || 1))) * 46));
                    return <rect className={bar.close >= bar.open ? styles.volUp : styles.volDown} height={volHeight} key={`${bar.dt}-${index}`} width="5" x={x} y={330 - volHeight} />;
                  })}
                  {hoverBar && hoverIndex !== null && (
                    <g>
                      <line className={styles.crosshair} x1={(hoverIndex / Math.max(chart.bars.length - 1, 1)) * 1000} x2={(hoverIndex / Math.max(chart.bars.length - 1, 1)) * 1000} y1="0" y2="340" />
                    </g>
                  )}
                </svg>
              ) : (
                <div className={styles.emptyChart}>{selectedHasMarket && "reason" in marketState ? marketState.reason : "此檔 K 線尚未接入，保留交易室版位。"}</div>
              )}
              {hoverBar && (
                <div className={styles.tooltip}>
                  <div><span>日期</span><b>{hoverBar.dt}</b></div>
                  <div><span>開</span><b>{formatNumber(hoverBar.open, 2)}</b></div>
                  <div><span>高</span><b>{formatNumber(hoverBar.high, 2)}</b></div>
                  <div><span>低</span><b>{formatNumber(hoverBar.low, 2)}</b></div>
                  <div><span>收</span><b>{formatNumber(hoverBar.close, 2)}</b></div>
                  <div><span>量</span><b>{formatNumber(hoverBar.volume, 0)}</b></div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.ledger}>
            <div className={styles.ledgerTabs}>
              {([
                ["orders", "委託"],
                ["fills", "成交"],
                ["positions", "部位"],
                ["kgi", "KGI 唯讀"],
              ] as const).map(([value, label]) => (
                <button className={ledgerTab === value ? styles.activeTab : ""} key={value} type="button" onClick={() => setLedgerTab(value)}>{label}</button>
              ))}
            </div>
            {message && <div className={styles.message}>{message}</div>}
            {ledgerTab === "orders" && (
              <table>
                <thead><tr><th>狀態</th><th>代號</th><th>方向</th><th>類型</th><th>數量</th><th>價格</th><th /></tr></thead>
                <tbody>
                  {filteredOrders.length > 0 ? filteredOrders.slice(0, 12).map((order) => (
                    <tr key={order.intent.id}>
                      <td>{orderStatusLabel(order.intent.status)}</td>
                      <td>{order.intent.symbol}</td>
                      <td className={order.intent.side === "buy" ? styles.up : styles.down}>{sideLabel(order.intent.side)}</td>
                      <td>{orderTypeLabel(order.intent.orderType)}</td>
                      <td>{order.intent.qty} {order.intent.quantity_unit === "LOT" ? "張" : "股"}</td>
                      <td>{formatNumber(order.intent.price, 2)}</td>
                      <td>{isCancellablePaperOrder(order.intent.status) && <button type="button" onClick={() => handleCancel(order.intent.id)}>撤單</button>}</td>
                    </tr>
                  )) : <tr><td colSpan={7}>目前沒有模擬委託。</td></tr>}
                </tbody>
              </table>
            )}
            {ledgerTab === "fills" && (
              <table>
                <thead><tr><th>時間</th><th>代號</th><th>方向</th><th>數量</th><th>成交價</th><th>金額</th></tr></thead>
                <tbody>
                  {fillsState.fills.length > 0 ? fillsState.fills.slice(0, 12).map((fill) => (
                    <tr key={`${fill.orderId}-${fill.fillTime}`}>
                      <td>{formatTime(fill.fillTime)}</td>
                      <td>{fill.symbol}</td>
                      <td className={fill.side === "buy" ? styles.up : styles.down}>{sideLabel(fill.side)}</td>
                      <td>{fill.fillQty} {fill.quantity_unit === "LOT" ? "張" : "股"}</td>
                      <td>{formatNumber(fill.fillPrice, 2)}</td>
                      <td>{formatTwd(fillNotional(fill))}</td>
                    </tr>
                  )) : <tr><td colSpan={6}>{fillsState.state === "BLOCKED" ? fillsState.reason : "目前沒有模擬成交。"}</td></tr>}
                </tbody>
              </table>
            )}
            {ledgerTab === "positions" && (
              <table>
                <thead><tr><th>代號</th><th>股數</th><th>平均成本</th><th>估算投入</th><th>狀態</th></tr></thead>
                <tbody>
                  {portfolioState.positions.length > 0 ? portfolioState.positions.map((position) => (
                    <tr key={position.symbol}>
                      <td>{position.symbol}</td>
                      <td>{position.netQtyShares.toLocaleString("zh-TW")} 股</td>
                      <td>{formatNumber(position.avgCostPerShare, 2)}</td>
                      <td>{formatTwd(positionCost(position))}</td>
                      <td>{position.note ?? "持倉中"}</td>
                    </tr>
                  )) : <tr><td colSpan={5}>{portfolioState.state === "BLOCKED" ? portfolioState.reason : "目前沒有模擬持倉。"}</td></tr>}
                </tbody>
              </table>
            )}
            {ledgerTab === "kgi" && (
              <table>
                <thead><tr><th>狀態</th><th>代號</th><th>股數</th><th>現價</th><th>未實現</th></tr></thead>
                <tbody>
                  {kgiState.state === "LIVE" && kgiState.data.positions.length > 0 ? kgiState.data.positions.map((position: KgiLivePosition) => (
                    <tr key={position.symbol}>
                      <td>唯讀</td>
                      <td>{position.symbol}</td>
                      <td>{position.netQtyShares.toLocaleString("zh-TW")} 股</td>
                      <td>{formatNumber(position.lastPrice, 2)}</td>
                      <td className={position.unrealizedPnl >= 0 ? styles.up : styles.down}>{formatTwd(position.unrealizedPnl)}</td>
                    </tr>
                  )) : <tr><td colSpan={5}>{kgiState.state === "BLOCKED" ? kgiState.reason : kgiStatusLabel(kgiState)}</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className={styles.rightPane}>
          <div className={styles.ticket}>
            <div className={styles.panelHead}><h3>Paper Order Ticket</h3><span>Real disabled</span></div>
            <div className={styles.ticketGrid}>
              <label>股票<input value={selectedSymbol} readOnly /></label>
              <div className={styles.segment}>
                <button className={side === "buy" ? styles.activeBuy : ""} type="button" onClick={() => { setSide("buy"); clearDraft(); }}>買進</button>
                <button className={side === "sell" ? styles.activeSell : ""} type="button" onClick={() => { setSide("sell"); clearDraft(); }}>賣出</button>
              </div>
              <div className={styles.segment}>
                <button className={orderType === "limit" ? styles.activeTab : ""} type="button" onClick={() => { setOrderType("limit"); clearDraft(); }}>限價</button>
                <button className={orderType === "market" ? styles.activeTab : ""} type="button" onClick={() => { setOrderType("market"); clearDraft(); }}>市價</button>
              </div>
              <div className={styles.segment}>
                <button className={quantityUnit === "SHARE" ? styles.activeTab : ""} type="button" onClick={() => { setQuantityUnit("SHARE"); setQty("1"); clearDraft(); }}>零股</button>
                <button className={quantityUnit === "LOT" ? styles.activeTab : ""} type="button" onClick={() => { setQuantityUnit("LOT"); setQty("1"); clearDraft(); }}>整張</button>
              </div>
              <label>{quantityUnitLabel(quantityUnit)}數量<input min={1} type="number" value={qty} onChange={(event) => { setQty(event.target.value); clearDraft(); }} /></label>
              <small>{quantityUnitDescription(quantityUnit)} · 實際 {Number.isFinite(Number(qty)) ? toTaiwanStockShareCount(Number(qty), quantityUnit).toLocaleString("zh-TW") : "--"} 股</small>
              {orderType !== "market" && (
                <label>限價<input min={0.01} step={0.01} type="number" value={price} onChange={(event) => { setPrice(event.target.value); clearDraft(); }} /></label>
              )}
              <div className={styles.notional}>
                <span>預估金額</span>
                <b>{formatTwd(parsed.estimatedNotional)}</b>
              </div>
              {validationReason && <div className={styles.formError}>{validationReason}</div>}
              <button className={styles.previewButton} disabled={!input || preview.status === "loading"} type="button" onClick={handlePreview}>
                {preview.status === "loading" ? "預覽中" : "Paper Preview"}
              </button>
              <button className={styles.submitButton} disabled={!canSubmit || submit.status === "loading"} type="button" onClick={handleSubmit}>
                {submit.status === "loading" ? "送出中" : "送出 Paper 委託"}
              </button>
            </div>
          </div>

          <div className={styles.riskGate}>
            <div className={styles.panelHead}><h3>Risk Gate</h3><span>{gateLabel(health)}</span></div>
            <div className={styles.gateRows}>
              <div><span>Paper 模式</span><b className={styles.ok}>啟用</b></div>
              <div><span>真實下單</span><b className={styles.bad}>鎖定</b></div>
              <div><span>KGI</span><b className={styles.warn}>{kgiStatusLabel(kgiState)}</b></div>
              <div><span>Preview</span><b className={health?.previewReady ? styles.ok : styles.warn}>{health?.previewReady ? "可用" : "待檢查"}</b></div>
            </div>
            <div className={styles.previewResult}>
              {preview.status === "idle" && <p>先按 Paper Preview，通過後才可送出模擬委託。</p>}
              {preview.status === "error" && <p className={styles.bad}>{preview.message}</p>}
              {preview.status === "blocked" && <p className={styles.bad}>預覽未通過：{previewGuards[0] ?? "風控未通過。"}</p>}
              {preview.status === "live" && <p className={styles.ok}>預覽通過。{previewGuards.length > 0 ? `提醒：${previewGuards[0]}` : "可送出 Paper 委託。"}</p>}
              {submit.status === "live" && <p className={styles.ok}>Paper 委託已建立：{orderStatusLabel(submit.state.intent.status)}</p>}
              {submit.status === "blocked" && <p className={styles.warn}>Paper 委託被拒絕：{submit.state.intent.reason ?? "未通過。"}</p>}
              {submit.status === "error" && <p className={styles.bad}>{submit.message}</p>}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
