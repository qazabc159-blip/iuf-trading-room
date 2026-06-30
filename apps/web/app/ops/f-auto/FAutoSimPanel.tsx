"use client";

/**
 * B1 — F-AUTO SIM 觀察面板（主 client component）
 *
 * Sections:
 *   1. SIM 帳戶部位   — GET /api/v1/paper/positions?source=sim
 *   2. SIM 帳戶資金   — GET /api/v1/paper/funds?source=sim
 *   3. S1 訊號/狀態   — GET /api/v1/internal/s1-sim/status
 *   4. S1 當日委託/成交 — GET /api/v1/kgi/sim/orders
 *   5. S1 訊號籃      — GET /api/v1/internal/s1-sim/basket?date=
 *   6. S1 EOD 報告    — GET /api/v1/internal/s1-sim/eod-report?date=
 *   7. Daily smoke    — GET /api/v1/internal/kgi/sim/daily-smoke-status
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { isKgiTradingHours } from "@/lib/kgi-trading-hours";
import {
  getFAutoPortfolio,
  getKgiSimOrders,
  getDailySmokeHistory,
  getS1SimStatus,
  getS1SimEodReport,
  getS1SimBasket,
  fmtTwd,
  fmtDatetime,
  type SimPosition,
  type SimFunds,
  type FAutoPortfolio,
  type KgiSimRawOrderItem,
  type KgiSimOrdersResult,
  type DailySmokeHistory,
  type S1SimStatus,
  type S1EodReport,
  type S1Basket,
} from "@/lib/fauto-sim-api";
import { KgiConnectionLight } from "./KgiConnectionLight";

type AsyncState<T> =
  | { phase: "loading" }
  | { phase: "empty" }
  | { phase: "error"; message: string }
  | { phase: "live"; data: T }
  | { phase: "pending_backend" };   // endpoint unavailable or still deploying

// ─── Polling constants ────────────────────────────────────────────────────────

/** Intraday poll: 09:00-13:30 TST — data changes frequently during session. */
const POLL_INTRADAY_MS = 45_000;
/** Off-hours poll: positions/funds don't change but smoke/status may still update. */
const POLL_OFFHOURS_MS = 5 * 60_000;

// ─── Auto-refresh hook ────────────────────────────────────────────────────────

/**
 * Drives periodic polling with:
 * - Intraday (09:00-13:30 TST) → 45s interval
 * - Off-hours / weekend → 5min interval
 * - document.hidden → pause; on visible → immediate refresh + restart timer
 * - `triggerRefresh()` for manual refresh button
 */
function useAutoRefresh(): {
  tick: number;
  triggerRefresh: () => void;
  lastRefreshedAt: Date | null;
} {
  const [tick, setTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerRefresh = useCallback(() => {
    setTick((t) => t + 1);
    setLastRefreshedAt(new Date());
  }, []);

  useEffect(() => {
    let alive = true;

    function scheduleNext() {
      if (!alive) return;
      const delay = isKgiTradingHours() ? POLL_INTRADAY_MS : POLL_OFFHOURS_MS;
      timeoutRef.current = setTimeout(() => {
        if (!alive) return;
        if (!document.hidden) {
          // Visible: fire refresh and reschedule
          triggerRefresh();
          scheduleNext();
        }
        // Hidden: don't reschedule — onVisibility will restart when tab comes back
      }, delay);
    }

    function onVisibility() {
      if (!document.hidden) {
        // Tab came back into view: cancel any pending timer, refresh immediately, restart
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        triggerRefresh();
        scheduleNext();
      }
    }

    scheduleNext();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [triggerRefresh]);

  return { tick, triggerRefresh, lastRefreshedAt };
}

// ─── Time formatter for refresh bar ──────────────────────────────────────────

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ─── Fetch hook with polling support + stale-data guard ──────────────────────

/**
 * Fetches data once on mount and on each `refreshTick` increment.
 *
 * Stale-data guard: if a background poll fails but we already have good data,
 * the last known live state is preserved — the screen is NOT cleared to an
 * error or loading state. First-load failures still show error/pending.
 */
function useFetch<T>(
  fetcher: () => Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }>,
  refreshTick: number,
  startsUnavailable = false,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(
    startsUnavailable ? { phase: "pending_backend" } : { phase: "loading" },
  );
  const lastGoodRef = useRef<T | null>(null);

  useEffect(() => {
    if (startsUnavailable) {
      setState({ phase: "pending_backend" });
      return;
    }
    let cancelled = false;
    // Silent background poll — don't flash "loading" if we already have data
    const hadGoodData = lastGoodRef.current !== null;
    if (!hadGoodData) {
      setState({ phase: "loading" });
    }
    fetcher().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 404 || result.status === 501) {
          if (!hadGoodData) setState({ phase: "pending_backend" });
          // else: keep showing last good data
        } else {
          if (!hadGoodData) setState({ phase: "error", message: `HTTP ${result.status}` });
          // else: silently keep last good data — don't replace live display with error
        }
        return;
      }
      const d = result.data;
      const isEmpty =
        d === null ||
        d === undefined ||
        (Array.isArray(d) && d.length === 0) ||
        (typeof d === "object" && Object.keys(d).length === 0);
      if (!isEmpty) lastGoodRef.current = d;
      setState(isEmpty ? { phase: "empty" } : { phase: "live", data: d });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, startsUnavailable]);

  return state;
}

// ─── Date selector (today / yesterday / D-2) ─────────────────────────────────

function toTpeDate(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
}

function portfolioPositionsState(
  state: AsyncState<FAutoPortfolio>,
  eodState: AsyncState<S1EodReport>,
): AsyncState<SimPosition[]> {
  if (state.phase !== "live") return state;
  const eodRows = eodState.phase === "live" && eodState.data.found
    ? new Map(eodState.data.positions.map((position) => [position.symbol, position]))
    : new Map<string, S1EodReport["positions"][number]>();
  const positions = state.data.positions.map((position) => ({
    ...(() => {
      const eod = eodRows.get(position.symbol);
      const lastPrice = position.last_price ?? eod?.lastPrice ?? null;
      return {
        avgCost: position.avg_cost ?? eod?.avgCost ?? null,
        unrealizedPnl: position.unrealized_pnl_twd ?? eod?.unrealizedPnlTwd ?? null,
        lastPrice,
        marketValue:
          position.market_value_twd ??
          (lastPrice == null ? null : lastPrice * position.shares),
      };
    })(),
    symbol: position.symbol,
    qty: position.shares,
    note: state.data.data_source,
  }));
  return positions.length > 0 ? { phase: "live", data: positions } : { phase: "empty" };
}

function portfolioFundsState(
  state: AsyncState<FAutoPortfolio>,
  eodState: AsyncState<S1EodReport>,
): AsyncState<SimFunds> {
  if (state.phase !== "live") return state;
  const eod = eodState.phase === "live" && eodState.data.found ? eodState.data : null;
  const marketValue = eod?.totalMarketValueTwd ?? state.data.total_market_value_twd;
  const cash = eod?.cashResidual ?? state.data.cash_residual_estimated_twd;
  return {
    phase: "live",
    data: {
      cashBalance: cash,
      availableFunds: cash,
      totalMarketValue: marketValue,
      totalEquity: marketValue == null ? null : marketValue + cash,
      currency: "TWD",
      fetchedAt: state.data.as_of,
      note: `持久化 S1 部位 / ${state.data.data_source} / 部位日 ${state.data.positions_date}`,
    },
  };
}

function FAutoSummary({
  portfolio,
  status,
  eod,
}: {
  portfolio: AsyncState<FAutoPortfolio>;
  status: AsyncState<S1SimStatus>;
  eod: AsyncState<S1EodReport>;
}) {
  const data = portfolio.phase === "live" ? portfolio.data : null;
  const statusData = status.phase === "live" ? status.data : null;
  const eodData = eod.phase === "live" && eod.data.found ? eod.data : null;
  const capital = data?.capital_twd ?? statusData?.configuredCapitalTwd ?? null;
  const marketValue = eodData?.totalMarketValueTwd ?? data?.total_market_value_twd ?? statusData?.eodMarketValueTwd ?? null;
  const cash = eodData?.cashResidual ?? data?.cash_residual_estimated_twd ?? (capital != null && marketValue != null ? capital - marketValue : null);
  const pnl = eodData?.totalUnrealizedPnlTwd ?? data?.total_unrealized_pnl_twd ?? statusData?.eodUnrealizedPnlTwd ?? null;
  const pnlPct = capital && pnl != null ? (pnl / capital) * 100 : null;
  const positionCount = data?.positions.length ?? statusData?.eodPositionCount ?? 0;

  return (
    <section className="_fauto-summary" aria-label="S1 F-AUTO 資產總覽">
      <div className="_fauto-summary-head">
        <div>
          <span className="_fauto-summary-kicker">S1 / F-AUTO / KGI SIM</span>
          <h2>自動交易觀察總覽</h2>
          <p>
            顯示 S1 runner 的持久化部位、收盤估值與稽核委託。休市或 gateway 暫停時仍保留最後可信狀態，
            不把查不到即時券商資料誤顯示成零持倉。
          </p>
        </div>
        <div className="_fauto-summary-actions">
          <Link href="/quant-strategies">策略規則</Link>
          <Link href="/reviews">每週復盤</Link>
        </div>
      </div>
      <div className="_fauto-summary-grid">
        <div><span>配置資金</span><strong>{fmtTwd(capital)}</strong><small>{data?.capital_source ?? statusData?.capitalSource ?? "--"}</small></div>
        <div><span>持倉市值</span><strong>{fmtTwd(marketValue)}</strong><small>{positionCount} 檔持倉</small></div>
        <div><span>現金餘額</span><strong>{fmtTwd(cash)}</strong><small>估值後可用餘額</small></div>
        <div className={pnlClass(pnl)}><span>未實現損益</span><strong>{fmtTwd(pnl)}</strong><small>{pnlPct == null ? "--" : `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`}</small></div>
        <div><span>部位日期</span><strong>{eodData?.date ?? data?.positions_date ?? statusData?.lastEodDate?.slice(0, 10) ?? "--"}</strong><small>{eodData?.dataSource ?? data?.data_source ?? statusData?.eodDataSource ?? "--"}</small></div>
      </div>
    </section>
  );
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function SimPositionsPanel({
  state,
  source,
}: {
  state: AsyncState<SimPosition[]>;
  source: string | null;
}) {
  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">SIM-POS</span>
        <span className="_fauto-panel-title">S1 SIM 持倉</span>
        <span className="_fauto-panel-sub">{source ?? "持久化部位"}</span>
      </div>
      <div className="_fauto-panel-body">
        {state.phase === "loading" && <PanelLoading />}
        {state.phase === "error" && <PanelError message={state.message} />}
        {state.phase === "empty" && <PanelEmpty label="目前無部位" />}
        {state.phase === "pending_backend" && <PanelPending label="部位資料" />}
        {state.phase === "live" && (
          <table className="_fauto-tbl">
            <thead>
              <tr>
                <th>代碼</th>
                <th className="_fauto-tbl-r">持倉量</th>
                <th className="_fauto-tbl-r">均成本</th>
                <th className="_fauto-tbl-r">現價</th>
                <th className="_fauto-tbl-r">未實現損益</th>
                <th className="_fauto-tbl-r">市值</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((pos) => (
                <tr key={pos.symbol}>
                  <td className="_fauto-symbol">{pos.symbol}</td>
                  <td className="_fauto-tbl-r">{pos.qty.toLocaleString("zh-TW")}</td>
                  <td className="_fauto-tbl-r">{pos.avgCost != null ? pos.avgCost.toFixed(2) : "--"}</td>
                  <td className="_fauto-tbl-r">{pos.lastPrice != null ? pos.lastPrice.toFixed(2) : "--"}</td>
                  <td className={`_fauto-tbl-r ${pnlClass(pos.unrealizedPnl)}`}>
                    {fmtTwd(pos.unrealizedPnl)}
                  </td>
                  <td className="_fauto-tbl-r">{fmtTwd(pos.marketValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SimFundsPanel({ state }: { state: AsyncState<SimFunds> }) {
  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">SIM-FUND</span>
        <span className="_fauto-panel-title">S1 SIM 資金</span>
        <span className="_fauto-panel-sub">配置資金 / 部位估值</span>
      </div>
      <div className="_fauto-panel-body">
        {state.phase === "loading" && <PanelLoading />}
        {state.phase === "error" && <PanelError message={state.message} />}
        {state.phase === "empty" && <PanelEmpty label="無資金資料" />}
        {state.phase === "pending_backend" && <PanelPending label="資金資料" />}
        {state.phase === "live" && (
          <div className="_fauto-kv-list">
            {([
              ["現金餘額", fmtTwd(state.data.cashBalance)],
              ["可用資金", fmtTwd(state.data.availableFunds)],
              ["持股市值", fmtTwd(state.data.totalMarketValue)],
              ["帳戶淨值", fmtTwd(state.data.totalEquity)],
              ["幣別", state.data.currency ?? "TWD"],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="_fauto-kv-row">
                <span className="_fauto-kv-label">{label}</span>
                <span className="_fauto-kv-value">{value}</span>
              </div>
            ))}
            {state.data.note && (
              <div className="_fauto-note">{state.data.note}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function S1StatusPanel({ state }: { state: AsyncState<S1SimStatus> }) {
  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">S1-STAT</span>
        <span className="_fauto-panel-title">S1 策略狀態</span>
        <span className="_fauto-panel-sub">訊號 / 委託 / 市場態勢</span>
      </div>
      <div className="_fauto-panel-body">
        {state.phase === "loading" && <PanelLoading />}
        {state.phase === "error" && <PanelError message={state.message} />}
        {state.phase === "empty" && <PanelEmpty label="S1 尚未執行" />}
        {state.phase === "pending_backend" && <PanelPending label="S1 狀態讀取端點" />}
        {state.phase === "live" && (
          <div className="_fauto-kv-list">
            <div className="_fauto-note">
              {state.data.automaticScheduler.enabled
                ? `自動排程已啟用：訊號 ${state.data.automaticScheduler.signalWindowTst ?? "--"}；委託 ${state.data.automaticScheduler.orderSubmitWindowTst ?? "--"}。下單窗若缺今日訊號籃，系統會先自動補訊號再送 KGI SIM；手動觸發只作備援。`
                : "自動排程未啟用；此狀態不符合正式 F-AUTO SIM 運作。"}
            </div>
            {([
              ["今日", state.data.todayTst ?? "--"],
              ["自動排程", state.data.automaticScheduler.enabled ? "啟用" : "未啟用"],
              ["排程模式", state.data.automaticScheduler.mode ?? "--"],
              ["訊號排程", state.data.automaticScheduler.signalWindowTst ?? "--"],
              ["委託排程", state.data.automaticScheduler.orderSubmitWindowTst ?? "--"],
              ["缺訊號自動補籃", state.data.automaticScheduler.signalCatchupBeforeOrder ? "啟用" : "未啟用"],
              ["手動觸發角色", state.data.automaticScheduler.manualTriggerRole === "owner_backup_only" ? "Owner 備援" : state.data.automaticScheduler.manualTriggerRole ?? "--"],
              ["S1 配置資金", state.data.configuredCapitalTwd != null ? fmtTwd(state.data.configuredCapitalTwd) : "--"],
              ["資金來源", state.data.capitalSource ?? "--"],
              ["市場態勢", state.data.regime ?? "--"],
              ["曝險比重", state.data.exposureWeight != null ? `${(state.data.exposureWeight * 100).toFixed(0)}%` : "--"],
              ["訊號視窗", state.data.signalWindowOpen ? "開啟" : "關閉"],
              ["下單視窗", state.data.orderSubmitWindowOpen ? "開啟" : "關閉"],
              ["EOD 視窗", state.data.eodWindowOpen ? "開啟" : "關閉"],
              ["KGI Gateway", state.data.gatewayUrlConfigured ? "已設定" : "未設定"],
              ["最後訊號", state.data.lastSignalDate ?? "--"],
              ["訊號籃", state.data.latestBasketSize != null ? `${state.data.latestBasketSize} 檔` : "--"],
              ["籃子產生", state.data.latestBasketGeneratedAt ? fmtDatetime(state.data.latestBasketGeneratedAt) : "--"],
              ["最後委託", state.data.lastOrderDate ? fmtDatetime(state.data.lastOrderDate) : "--"],
              ["最後 EOD", state.data.lastEodDate ? fmtDatetime(state.data.lastEodDate) : "--"],
              ["EOD 部位", state.data.eodPositionCount != null ? `${state.data.eodPositionCount} 檔` : "--"],
              ["EOD 市值", fmtTwd(state.data.eodMarketValueTwd)],
              ["EOD 未實現", fmtTwd(state.data.eodUnrealizedPnlTwd)],
              ["成功委託", state.data.ordersAccepted != null ? String(state.data.ordersAccepted) : "--"],
              ["失敗委託", state.data.ordersRejected != null ? String(state.data.ordersRejected) : "--"],
              ["資料來源", state.data.eodDataSource ?? "--"],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="_fauto-kv-row">
                <span className="_fauto-kv-label">{label}</span>
                <span className="_fauto-kv-value">{value}</span>
              </div>
            ))}
            {state.data.failsafeNotes && (
              <div className="_fauto-note">{state.data.failsafeNotes}</div>
            )}
            {state.data.basketSymbols.length > 0 && (
              <div className="_fauto-basket-chips">
                <span className="_fauto-basket-label">訊號清單</span>
                {state.data.basketSymbols.map((sym) => (
                  <span key={sym} className="_fauto-chip">{sym}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BasketPanel({
  state,
  date,
}: {
  state: AsyncState<S1Basket>;
  date: string;
}) {
  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">S1-BASKET</span>
        <span className="_fauto-panel-title">S1 訊號籃</span>
        <span className="_fauto-panel-sub">{date}</span>
      </div>
      <div className="_fauto-panel-body">
        {state.phase === "loading" && <PanelLoading />}
        {state.phase === "error" && <PanelError message={state.message} />}
        {state.phase === "pending_backend" && <PanelPending label="訊號籃讀取端點" />}
        {state.phase === "empty" && <PanelEmpty label="當日無訊號籃" />}
        {state.phase === "live" && !state.data.found && <PanelEmpty label="當日無訊號籃" />}
        {state.phase === "live" && state.data.found && (
          <>
            <div className="_fauto-kv-list" style={{ marginBottom: 12 }}>
              {([
                ["態勢", state.data.regime ?? "--"],
                ["曝險比重", state.data.exposureWeight != null ? `${(state.data.exposureWeight * 100).toFixed(0)}%` : "--"],
                ["產生時間", state.data.generatedAtTst ? fmtDatetime(state.data.generatedAtTst) : "--"],
                ["母體數", state.data.universeCount != null ? String(state.data.universeCount) : "--"],
                ["候選數", String(state.data.items.length)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="_fauto-kv-row">
                  <span className="_fauto-kv-label">{label}</span>
                  <span className="_fauto-kv-value">{value}</span>
                </div>
              ))}
            </div>
            {state.data.items.length > 0 ? (
              <table className="_fauto-tbl">
                <thead>
                  <tr>
                    <th>代碼</th>
                    <th className="_fauto-tbl-r">分數</th>
                    <th className="_fauto-tbl-r">股數</th>
                    <th className="_fauto-tbl-r">目標金額</th>
                    <th> sizing </th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.slice(0, 12).map((item) => (
                    <tr key={item.symbol}>
                      <td className="_fauto-symbol">{item.symbol}</td>
                      <td className="_fauto-tbl-r">{item.score != null ? item.score.toFixed(3) : "--"}</td>
                      <td className="_fauto-tbl-r">{item.shares != null ? item.shares.toLocaleString("zh-TW") : "--"}</td>
                      <td className="_fauto-tbl-r">{fmtTwd(item.targetNotionalTwd)}</td>
                      <td className="_fauto-ts">{item.sizingNote ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <PanelEmpty label="訊號籃沒有候選股票" />
            )}
            {state.data.failsafeNotes && (
              <div className="_fauto-note" style={{ marginTop: 8 }}>{state.data.failsafeNotes}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SimOrdersPanel({ state }: { state: AsyncState<KgiSimOrdersResult> }) {
  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">SIM-ORD</span>
        <span className="_fauto-panel-title">委託 / 成交確認</span>
        <span className="_fauto-panel-sub">KGI SIM 稽核歷程</span>
      </div>
      <div className="_fauto-panel-body">
        {state.phase === "loading" && <PanelLoading />}
        {state.phase === "error" && <PanelError message={state.message} />}
        {state.phase === "empty" && <PanelEmpty label="尚無 S1 委託稽核紀錄" />}
        {state.phase === "pending_backend" && <PanelPending label="委託記錄" />}
        {state.phase === "live" && (
          <>
            {state.data.reconciliation && (
              <div className="_fauto-recon-card">
                <div className="_fauto-recon-head">
                  <span className={`_fauto-recon-pill _fauto-recon-${state.data.reconciliation.closureState}`}>
                    {closureStateLabel(state.data.reconciliation.closureState)}
                  </span>
                  <span className="_fauto-ts">
                    對帳時間 {fmtDatetime(state.data.reconciliation.fetchedAt ?? state.data.fetchedAt)}
                  </span>
                </div>
                <div className="_fauto-recon-grid">
                  <div><span>策略帳本</span><strong>{state.data.reconciliation.auditOrderCount}</strong><small>筆委託</small></div>
                  <div><span>券商回報</span><strong>{state.data.reconciliation.brokerReportConfirmedCount}</strong><small>筆已對上</small></div>
                  <div><span>成交確認</span><strong>{state.data.reconciliation.filledCount}</strong><small>筆成交/部分成交</small></div>
                  <div><span>待確認</span><strong>{state.data.reconciliation.unconfirmedCount}</strong><small>筆等待回報</small></div>
                </div>
                <div className="_fauto-recon-sources">
                  <span>券商事件 {state.data.reconciliation.evidence.orderEventRows} 筆 / {fetchStateLabel(state.data.reconciliation.fetch.orderEvents)}</span>
                  <span>委託回報 {state.data.reconciliation.evidence.tradeReportRows} 筆 / {fetchStateLabel(state.data.reconciliation.fetch.tradeReports)}</span>
                  <span>成交明細 {state.data.reconciliation.evidence.dealRows} 筆 / {fetchStateLabel(state.data.reconciliation.fetch.deals)}</span>
                </div>
                {state.data.reconciliation.fetch.errors.length > 0 && (
                  <div className="_fauto-note">
                    券商資料源錯誤：{state.data.reconciliation.fetch.errors.map((err) => `${err.source}: ${err.message}`).join(" / ")}
                  </div>
                )}
                {state.data.note && <div className="_fauto-note">{state.data.note}</div>}
              </div>
            )}
            {state.data.orders.length > 0 ? (
              <table className="_fauto-tbl">
                <thead>
                  <tr>
                    <th>代碼</th>
                    <th>方向</th>
                    <th className="_fauto-tbl-r">委託 / 成交</th>
                    <th className="_fauto-tbl-r">成交均價</th>
                    <th>狀態</th>
                    <th>確認來源</th>
                    <th className="_fauto-tbl-r">確認時間</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.orders.slice(0, 30).map((ord, i) => (
                    <tr key={ord.tradeId ?? `ord-${i}`}>
                      <td className="_fauto-symbol">{ord.symbol}</td>
                      <td className={ord.side === "buy" ? "_fauto-side-buy" : "_fauto-side-sell"}>
                        {ord.side === "buy" ? "買進" : "賣出"}
                      </td>
                      <td className="_fauto-tbl-r">
                        {ord.requestedQty.toLocaleString("zh-TW")} / {ord.filledQty.toLocaleString("zh-TW")}
                        <span className="_fauto-unit">股</span>
                        {ord.remainingQty > 0 && (
                          <span className="_fauto-unit"> 餘 {ord.remainingQty.toLocaleString("zh-TW")}</span>
                        )}
                      </td>
                      <td className="_fauto-tbl-r">
                        {ord.avgFillPrice != null ? ord.avgFillPrice.toFixed(2) : "--"}
                      </td>
                      <td>
                        <span className={`_fauto-ord-status _fauto-ord-${ord.status.toLowerCase()}`}>
                          {orderStatusLabel(ord.status)}
                        </span>
                      </td>
                      <td className="_fauto-ts">
                        {ord.settlementConfirmed ? sourceLabel(ord.settlementSource) : "待券商回報"}
                      </td>
                      <td className="_fauto-tbl-r _fauto-ts">{fmtDatetime(ord.confirmedAt ?? ord.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <PanelEmpty label="尚無 S1 委託稽核紀錄" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EodReportPanel({
  state,
  date,
}: {
  state: AsyncState<S1EodReport>;
  date: string;
}) {
  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">S1-EOD</span>
        <span className="_fauto-panel-title">S1 EOD 報告</span>
        <span className="_fauto-panel-sub">{date}</span>
      </div>
      <div className="_fauto-panel-body">
        {state.phase === "loading" && <PanelLoading />}
        {state.phase === "error" && <PanelError message={state.message} />}
        {state.phase === "empty" && <PanelEmpty label="當日無 EOD 報告" />}
        {state.phase === "pending_backend" && <PanelPending label="EOD 報告讀取端點" />}
        {state.phase === "live" && !state.data.found && <PanelEmpty label="當日無 EOD 報告" />}
        {state.phase === "live" && state.data.found && (
          <>
            <div className="_fauto-kv-list" style={{ marginBottom: 12 }}>
              {([
                ["態勢", state.data.regime ?? "--"],
                ["產生時間", state.data.generatedAtTst ? fmtDatetime(state.data.generatedAtTst) : "--"],
                ["總未實現損益", fmtTwd(state.data.totalUnrealizedPnlTwd)],
                ["總市值", fmtTwd(state.data.totalMarketValueTwd)],
                ["現金剩餘", fmtTwd(state.data.cashResidual)],
                ["資料來源", state.data.dataSource ?? "--"],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="_fauto-kv-row">
                  <span className="_fauto-kv-label">{label}</span>
                  <span className="_fauto-kv-value">{value}</span>
                </div>
              ))}
            </div>
            {state.data.positions.length > 0 && (
              <table className="_fauto-tbl">
                <thead>
                  <tr>
                    <th>代碼</th>
                    <th className="_fauto-tbl-r">持倉量</th>
                    <th className="_fauto-tbl-r">均成本</th>
                    <th className="_fauto-tbl-r">收盤價</th>
                    <th className="_fauto-tbl-r">未實現損益</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.positions.map((pos) => (
                    <tr key={pos.symbol}>
                      <td className="_fauto-symbol">{pos.symbol}</td>
                      <td className="_fauto-tbl-r">{pos.shares.toLocaleString("zh-TW")}</td>
                      <td className="_fauto-tbl-r">{pos.avgCost != null ? pos.avgCost.toFixed(2) : "--"}</td>
                      <td className="_fauto-tbl-r">{pos.lastPrice != null ? pos.lastPrice.toFixed(2) : "--"}</td>
                      <td className={`_fauto-tbl-r ${pnlClass(pos.unrealizedPnlTwd)}`}>
                        {fmtTwd(pos.unrealizedPnlTwd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {state.data.failsafeNotes && (
              <div className="_fauto-note" style={{ marginTop: 8 }}>{state.data.failsafeNotes}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SmokeHistoryPanel({ state }: { state: AsyncState<DailySmokeHistory> }) {
  const statusLabel = (status: string | null | undefined) => {
    if (status === "pass") return "通過";
    if (status === "fail") return "未通過";
    if (status === "partial") return "部分通過";
    if (status === "skip") return "跳過";
    return "待執行";
  };
  const statusClass = (status: string | null | undefined) =>
    status === "pass"
      ? "_fauto-green"
      : status === "partial"
        ? "_fauto-amber"
        : status === "fail"
          ? "_fauto-red"
          : "";

  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">SMOKE-7D</span>
        <span className="_fauto-panel-title">每日健診歷程</span>
        <span className="_fauto-panel-sub">近 7 日</span>
      </div>
      <div className="_fauto-panel-body">
        {state.phase === "loading" && <PanelLoading />}
        {state.phase === "error" && <PanelError message={state.message} />}
        {state.phase === "empty" && <PanelEmpty label="尚無健診紀錄" />}
        {state.phase === "pending_backend" && <PanelPending label="健診紀錄" />}
        {state.phase === "live" && (
          <>
            <div className="_fauto-kv-list" style={{ marginBottom: 10 }}>
              <div className="_fauto-kv-row">
                <span className="_fauto-kv-label">最近執行</span>
                <span className="_fauto-kv-value">{state.data.lastRunAt ? fmtDatetime(state.data.lastRunAt) : "--"}</span>
              </div>
              <div className="_fauto-kv-row">
                <span className="_fauto-kv-label">最近結果</span>
                <span className={`_fauto-kv-value ${statusClass(state.data.lastRunStatus)}`}>
                  {statusLabel(state.data.lastRunStatus)}
                </span>
              </div>
              <div className="_fauto-kv-row">
                <span className="_fauto-kv-label">正式下單稽核</span>
                <span className="_fauto-kv-value">
                  {state.data.lastProdBrokerAuditCount != null
                    ? state.data.lastProdBrokerAuditCount === 0
                      ? "0 筆 (正常)"
                      : `${state.data.lastProdBrokerAuditCount} 筆 (!)`
                    : "--"}
                </span>
              </div>
            </div>
            {state.data.history.length > 0 && (
              <table className="_fauto-tbl">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>結果</th>
                    <th className="_fauto-tbl-r">正式稽核</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.history.map((entry) => (
                    <tr key={entry.date}>
                      <td className="_fauto-ts">{entry.date === "--" ? "--" : fmtDatetime(entry.date)}</td>
                      <td>
                        <span className={`_fauto-smoke-badge ${entry.status === "pass" ? "_fauto-smoke-pass" : entry.status === "fail" ? "_fauto-smoke-fail" : entry.status === "partial" ? "_fauto-smoke-partial" : "_fauto-smoke-skip"}`}>
                          {statusLabel(entry.status)}
                        </span>
                      </td>
                      <td className="_fauto-tbl-r">
                        {entry.lastProdBrokerAuditCount != null ? entry.lastProdBrokerAuditCount : "--"}
                      </td>
                      <td className="_fauto-ts">{entry.note ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Shared micro-components ──────────────────────────────────────────────────

function PanelLoading() {
  return <div className="_fauto-panel-loading">資料載入中…</div>;
}

function PanelEmpty({ label }: { label: string }) {
  return <div className="_fauto-panel-empty">{label}</div>;
}

function PanelError({ message }: { message: string }) {
  return <div className="_fauto-panel-err">無法讀取資料 / {message}</div>;
}

function PanelPending({ label }: { label: string }) {
  return (
    <div className="_fauto-panel-pending">
      <span className="_fauto-pending-dot" />
      {label} — 尚未部署、權限未開或暫無回應
    </div>
  );
}

function pnlClass(value: number | null | undefined): string {
  if (value == null) return "";
  return value >= 0 ? "_fauto-green" : "_fauto-red";
}

function orderStatusLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === "FILLED") return "已成交";
  if (s === "PARTIALLY_FILLED") return "部分成交";
  if (s === "ACCEPTED" || s === "CONFIRMED") return "已送出 / 成交待確認";
  if (s === "UNCONFIRMED") return "已送出 / 尚未對帳";
  if (s === "PENDING") return "處理中";
  if (s === "REJECTED") return "已拒絕";
  if (s === "CANCELLED") return "已取消";
  return status;
}

function sourceLabel(source: string | null | undefined): string {
  if (source === "deal") return "成交明細";
  if (source === "order_event") return "券商事件";
  if (source === "trade_report") return "委託回報";
  if (source === "submission_only") return "送出紀錄";
  return "--";
}

function closureStateLabel(state: string): string {
  if (state === "broker_confirmed") return "券商已完整對帳";
  if (state === "partially_confirmed") return "部分已對帳";
  if (state === "awaiting_broker_report") return "等待券商回報";
  if (state === "gateway_unavailable") return "Gateway 暫不可讀";
  if (state === "no_strategy_orders") return "尚無策略委託";
  return state;
}

function fetchStateLabel(state: string): string {
  if (state === "ok") return "可讀";
  if (state === "error") return "讀取錯誤";
  return state;
}

// ─── Date selector ────────────────────────────────────────────────────────────

function DateSelector({
  selected,
  onChange,
}: {
  selected: number;
  onChange: (offset: number) => void;
}) {
  const labels = ["今日", "昨日", "D-2"] as const;
  return (
    <div className="_fauto-date-sel">
      {labels.map((label, offset) => (
        <button
          key={label}
          type="button"
          className={`_fauto-date-btn ${selected === offset ? "_fauto-date-btn-active" : ""}`}
          onClick={() => onChange(offset)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function FAutoSimPanel() {
  const [dateOffset, setDateOffset] = useState(0);
  const selectedDate = toTpeDate(dateOffset);

  // Auto-refresh driver: polls based on trading hours, pauses when tab is hidden
  const { tick, triggerRefresh, lastRefreshedAt } = useAutoRefresh();

  // ── live API fetches (all re-triggered on each tick) ──────────────────────
  const portfolioState = useFetch(getFAutoPortfolio, tick);
  const ordersState = useFetch(getKgiSimOrders, tick);
  const smokeState = useFetch(getDailySmokeHistory, tick);
  // S1 read-only endpoints: 404/501 → visible pending state; stale-data guard applies
  const s1StatusState = useFetch(getS1SimStatus, tick, false);

  // EOD and basket use separate date-driven effects
  const eodLastGoodRef = useRef<S1EodReport | null>(null);
  const basketLastGoodRef = useRef<S1Basket | null>(null);
  const [eodState, setEodState] = useState<AsyncState<S1EodReport>>({ phase: "pending_backend" });
  const [basketState, setBasketState] = useState<AsyncState<S1Basket>>({ phase: "pending_backend" });

  const positionsState = portfolioPositionsState(portfolioState, eodState);
  const fundsState = portfolioFundsState(portfolioState, eodState);
  const portfolioSource = portfolioState.phase === "live"
    ? `${portfolioState.data.data_source} / ${portfolioState.data.positions_date}`
    : null;
  const basketDate = portfolioState.phase === "live"
    ? portfolioState.data.positions_date
    : s1StatusState.phase === "live" && s1StatusState.data.lastSignalDate
      ? s1StatusState.data.lastSignalDate
      : selectedDate;

  // EOD follows the selected review date + tick (auto-poll)
  useEffect(() => {
    let cancelled = false;
    const hadGoodData = eodLastGoodRef.current !== null;
    if (!hadGoodData) setEodState({ phase: "loading" });
    getS1SimEodReport(selectedDate).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 404 || result.status === 501) {
          if (!hadGoodData) setEodState({ phase: "pending_backend" });
        } else if (result.status === 400) {
          if (!hadGoodData) setEodState({ phase: "empty" });
        } else {
          if (!hadGoodData) setEodState({ phase: "error", message: `HTTP ${result.status}` });
          // else: keep last good data silently
        }
        return;
      }
      eodLastGoodRef.current = result.data;
      setEodState({ phase: "live", data: result.data });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, tick]);

  // Basket follows the latest persisted S1 position date + tick (auto-poll)
  useEffect(() => {
    let cancelled = false;
    const hadGoodData = basketLastGoodRef.current !== null;
    if (!hadGoodData) setBasketState({ phase: "loading" });
    getS1SimBasket(basketDate).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 404 || result.status === 501) {
          if (!hadGoodData) setBasketState({ phase: "pending_backend" });
        } else if (result.status === 400) {
          if (!hadGoodData) setBasketState({ phase: "empty" });
        } else {
          if (!hadGoodData) setBasketState({ phase: "error", message: `HTTP ${result.status}` });
          // else: keep last good data silently
        }
        return;
      }
      basketLastGoodRef.current = result.data;
      setBasketState({ phase: "live", data: result.data });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basketDate, tick]);

  const refreshIntervalLabel = isKgiTradingHours() ? "45 秒自動刷新" : "5 分鐘自動刷新";
  const dataAsOf = portfolioState.phase === "live" ? portfolioState.data.as_of : null;

  return (
    <div className="_fauto-root">
      {/* CSS block */}
      <style>{FAUTO_CSS}</style>

      {/* Top strip: connection light + date selector */}
      <div className="_fauto-top-strip">
        <KgiConnectionLight refreshTick={tick} />
        <DateSelector selected={dateOffset} onChange={setDateOffset} />
      </div>

      {/* Refresh status bar */}
      <div className="_fauto-refresh-bar">
        <span className="_fauto-refresh-ts">
          最後刷新：
          {lastRefreshedAt ? fmtTime(lastRefreshedAt) : "頁面載入時"}
        </span>
        {dataAsOf && (
          <span className="_fauto-refresh-ts _fauto-refresh-as-of">
            資料截至：{fmtDatetime(dataAsOf)}
          </span>
        )}
        <span className="_fauto-refresh-interval">{refreshIntervalLabel}</span>
        <button
          type="button"
          className="_fauto-refresh-btn"
          onClick={triggerRefresh}
          aria-label="手動重整所有面板"
        >
          重整
        </button>
      </div>

      <FAutoSummary portfolio={portfolioState} status={s1StatusState} eod={eodState} />

      {/* Main grid */}
      <div className="_fauto-grid">
        <SimPositionsPanel state={positionsState} source={portfolioSource} />
        <SimFundsPanel state={fundsState} />
        <S1StatusPanel state={s1StatusState} />
        <SimOrdersPanel state={ordersState} />
        <BasketPanel state={basketState} date={basketDate} />
        <EodReportPanel state={eodState} date={selectedDate} />
        <SmokeHistoryPanel state={smokeState} />
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const FAUTO_CSS = `
/* F-AUTO SIM panel styles */
._fauto-root { width: 100%; }

._fauto-top-strip {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

._fauto-summary {
  border: 1px solid rgba(200,148,63,0.34);
  border-radius: 6px;
  background: rgba(8,11,16,0.82);
  margin-bottom: 14px;
  overflow: hidden;
}
._fauto-summary-head {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(220,228,240,0.09);
}
._fauto-summary-kicker {
  display: block;
  color: #c8943f;
  font: 800 10px/1 var(--mono, monospace);
  letter-spacing: 0.1em;
  margin-bottom: 7px;
}
._fauto-summary h2 {
  color: #eef2f7;
  font-size: 20px;
  margin: 0 0 6px;
}
._fauto-summary p {
  color: rgba(180,193,211,0.72);
  font-size: 12px;
  line-height: 1.65;
  margin: 0;
  max-width: 760px;
}
._fauto-summary-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
._fauto-summary-actions a {
  border: 1px solid rgba(200,148,63,0.36);
  border-radius: 4px;
  color: #e2b85c;
  font: 800 11px/1 var(--mono, monospace);
  padding: 9px 11px;
  text-decoration: none;
  white-space: nowrap;
}
._fauto-summary-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
._fauto-summary-grid > div {
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid rgba(220,228,240,0.08);
}
._fauto-summary-grid > div:last-child { border-right: none; }
._fauto-summary-grid span,
._fauto-summary-grid small {
  display: block;
  color: rgba(145,160,181,0.66);
  font: 700 10px/1.4 var(--mono, monospace);
}
._fauto-summary-grid strong {
  display: block;
  color: #e7ecf3;
  font: 800 18px/1.2 var(--mono, monospace);
  margin: 6px 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
._fauto-summary-grid ._fauto-green strong,
._fauto-summary-grid ._fauto-green small { color: #56d99b; }
._fauto-summary-grid ._fauto-red strong,
._fauto-summary-grid ._fauto-red small { color: #ff6b77; }
@media (max-width: 1100px) {
  ._fauto-summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  ._fauto-summary-grid > div { border-bottom: 1px solid rgba(220,228,240,0.08); }
}
@media (max-width: 680px) {
  ._fauto-summary-head { flex-direction: column; }
  ._fauto-summary-grid { grid-template-columns: 1fr 1fr; }
}

._fauto-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
}
@media (max-width: 1100px) { ._fauto-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 680px)  { ._fauto-grid { grid-template-columns: 1fr; } }

/* Panel chrome */
._fauto-panel {
  background: rgba(8,11,16,0.70);
  border: 1px solid rgba(220,228,240,0.10);
  border-radius: 4px;
  overflow: hidden;
}
._fauto-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid rgba(220,228,240,0.07);
  background: rgba(255,255,255,0.02);
}
._fauto-panel-code {
  font-size: 9px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.08em;
  color: rgba(145,160,181,0.45);
  text-transform: uppercase;
}
._fauto-panel-title {
  font-size: 13px;
  font-weight: 700;
  color: #e7ecf3;
}
._fauto-panel-sub {
  font-size: 11px;
  color: rgba(145,160,181,0.55);
  margin-left: auto;
  font-family: var(--mono, monospace);
}
._fauto-panel-body { padding: 12px 16px; }
._fauto-panel-loading,
._fauto-panel-empty,
._fauto-panel-err,
._fauto-panel-pending {
  padding: 16px 0;
  font-size: 12px;
  color: rgba(145,160,181,0.55);
  text-align: center;
  font-style: italic;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
._fauto-panel-err { color: #ff6b77; font-style: normal; }
._fauto-panel-pending { color: rgba(200,148,63,0.70); font-style: normal; }

/* Pending dot */
._fauto-pending-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(200,148,63,0.70);
}

/* KV list */
._fauto-kv-list { display: grid; gap: 0; }
._fauto-kv-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid rgba(220,228,240,0.05);
}
._fauto-kv-row:last-child { border-bottom: none; }
._fauto-kv-label {
  font-size: 11px;
  font-family: var(--mono, monospace);
  color: rgba(200,148,63,0.85);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
._fauto-kv-value {
  font-size: 12px;
  color: rgba(220,228,240,0.80);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono, monospace);
}

/* Tables */
._fauto-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-family: var(--mono, monospace);
}
._fauto-tbl th {
  text-align: left;
  color: rgba(145,160,181,0.55);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 4px 6px 6px;
  border-bottom: 1px solid rgba(220,228,240,0.09);
}
._fauto-tbl td {
  padding: 6px 6px;
  border-bottom: 1px solid rgba(220,228,240,0.04);
  color: rgba(220,228,240,0.75);
  vertical-align: middle;
}
._fauto-tbl tr:last-child td { border-bottom: none; }
._fauto-tbl-r { text-align: right; }
._fauto-symbol { color: #e2b85c; font-weight: 700; }
._fauto-ts { color: rgba(145,160,181,0.55); font-size: 10px; }
._fauto-unit { color: rgba(145,160,181,0.45); font-size: 10px; margin-left: 2px; }
._fauto-side-buy  { color: #ff6b77; font-weight: 700; }
._fauto-side-sell { color: #4adb88; font-weight: 700; }
._fauto-green { color: #4adb88; }
._fauto-red   { color: #ff6b77; }
._fauto-amber { color: #f4bd55; }

/* Reconciliation */
._fauto-recon-card {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid rgba(200,148,63,0.18);
  background: linear-gradient(135deg, rgba(200,148,63,0.07), rgba(8,11,16,0.45));
}
._fauto-recon-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
._fauto-recon-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border: 1px solid rgba(244,189,85,0.36);
  color: #f4bd55;
  font-size: 10px;
  font-family: var(--mono, monospace);
  font-weight: 800;
}
._fauto-recon-broker_confirmed {
  border-color: rgba(74,219,136,0.35);
  color: #4adb88;
}
._fauto-recon-partially_confirmed {
  border-color: rgba(244,189,85,0.42);
  color: #f4bd55;
}
._fauto-recon-awaiting_broker_report,
._fauto-recon-gateway_unavailable {
  border-color: rgba(255,107,119,0.35);
  color: #ff6b77;
}
._fauto-recon-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-bottom: 10px;
  background: rgba(220,228,240,0.08);
}
._fauto-recon-grid > div {
  background: rgba(8,11,16,0.74);
  padding: 9px 10px;
}
._fauto-recon-grid span,
._fauto-recon-grid small {
  display: block;
  color: rgba(145,160,181,0.62);
  font-size: 10px;
}
._fauto-recon-grid strong {
  display: block;
  margin: 2px 0;
  color: #e6edf7;
  font-size: 20px;
  line-height: 1.1;
  font-family: var(--mono, monospace);
}
._fauto-recon-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
._fauto-recon-sources span {
  border: 1px solid rgba(220,228,240,0.10);
  background: rgba(12,17,24,0.72);
  color: rgba(220,228,240,0.72);
  padding: 4px 7px;
  font-size: 10px;
  font-family: var(--mono, monospace);
}
@media (max-width: 720px) {
  ._fauto-recon-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  ._fauto-recon-head { align-items: flex-start; flex-direction: column; }
}

/* Order status badges */
._fauto-ord-status {
  display: inline-block;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 2px;
}
._fauto-ord-filled    { background: rgba(46,204,113,0.10);  color: #4adb88; }
._fauto-ord-accepted,
._fauto-ord-confirmed { background: rgba(200,148,63,0.10);  color: #e2b85c; }
._fauto-ord-pending   { background: rgba(145,160,181,0.08); color: #91a0b5; }
._fauto-ord-rejected,
._fauto-ord-cancelled { background: rgba(230,57,70,0.10);   color: #ff6b77; }

/* Smoke badges */
._fauto-smoke-badge {
  display: inline-block;
  font-size: 10px;
  font-family: var(--mono, monospace);
  padding: 2px 6px;
  border-radius: 2px;
  margin-right: 4px;
}
._fauto-smoke-pass { background: rgba(46,204,113,0.10); color: #4adb88; }
._fauto-smoke-fail { background: rgba(230,57,70,0.10);  color: #ff6b77; }
._fauto-smoke-partial { background: rgba(244,189,85,0.10); color: #f4bd55; }
._fauto-smoke-skip { background: rgba(145,160,181,0.08); color: #91a0b5; }

/* Basket chips */
._fauto-basket-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(220,228,240,0.07);
}
._fauto-basket-label {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.55);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-right: 4px;
}
._fauto-chip {
  font-size: 11px;
  font-family: var(--mono, monospace);
  font-weight: 700;
  color: #e2b85c;
  background: rgba(200,148,63,0.10);
  border: 1px solid rgba(200,148,63,0.20);
  border-radius: 2px;
  padding: 1px 5px;
}

/* Note */
._fauto-note {
  font-size: 11px;
  color: rgba(145,160,181,0.55);
  font-style: italic;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(220,228,240,0.05);
}

/* Connection light block */
._fauto-conn-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(8,11,16,0.65);
  border: 1px solid rgba(220,228,240,0.10);
  border-radius: 4px;
  padding: 12px 16px;
  min-width: 280px;
}
._fauto-conn-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
._fauto-conn-label {
  font-size: 10px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.55);
}
._fauto-conn-lights {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
._fauto-conn-status-stack {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
._fauto-conn-dot-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
._fauto-conn-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
._fauto-dot-green {
  background: #4adb88;
  box-shadow: 0 0 6px rgba(46,204,113,0.60);
}
._fauto-dot-red {
  background: #ff6b77;
  box-shadow: 0 0 6px rgba(230,57,70,0.55);
}
._fauto-conn-dot-lbl {
  font-size: 11px;
  font-family: var(--mono, monospace);
  color: rgba(220,228,240,0.70);
}
._fauto-conn-badge {
  font-size: 10px;
  font-family: var(--mono, monospace);
  padding: 2px 7px;
  border-radius: 2px;
}
._fauto-conn-badge-green { background: rgba(46,204,113,0.12); color: #4adb88; }
._fauto-conn-badge-amber { background: rgba(200,148,63,0.12); color: #e2b85c; }
._fauto-conn-badge-red { background: rgba(230,57,70,0.12); color: #ff6b77; }
._fauto-conn-detail {
  max-width: 560px;
  font-size: 11px;
  line-height: 1.55;
  color: rgba(145,160,181,0.72);
}
._fauto-conn-loading  { font-size: 11px; color: rgba(145,160,181,0.45); font-style: italic; }
._fauto-conn-forbidden { font-size: 11px; color: rgba(200,148,63,0.65); }
._fauto-conn-err      { font-size: 11px; color: #ff6b77; }
._fauto-conn-smoke {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
._fauto-conn-smoke-label {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.45);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-right: 2px;
}
._fauto-conn-smoke-ts {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.40);
  margin-left: auto;
}
._fauto-conn-last-order {
  display: flex;
  align-items: center;
  gap: 8px;
}
._fauto-conn-last-order-val {
  font-size: 11px;
  font-family: var(--mono, monospace);
  color: rgba(220,228,240,0.65);
}

/* Date selector */
._fauto-date-sel {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(8,11,16,0.65);
  border: 1px solid rgba(220,228,240,0.10);
  border-radius: 4px;
  padding: 10px 14px;
}
._fauto-date-btn {
  font-size: 11px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 2px;
  border: 1px solid rgba(220,228,240,0.12);
  background: transparent;
  color: rgba(145,160,181,0.65);
  cursor: pointer;
  transition: all 0.12s;
}
._fauto-date-btn:hover { background: rgba(255,255,255,0.04); }
._fauto-date-btn-active {
  background: rgba(200,148,63,0.12);
  border-color: rgba(200,148,63,0.30);
  color: #e2b85c;
}

/* Refresh status bar */
._fauto-refresh-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin-bottom: 14px;
  background: rgba(8,11,16,0.50);
  border: 1px solid rgba(220,228,240,0.07);
  border-radius: 4px;
}
._fauto-refresh-ts {
  font-size: 11px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.55);
  white-space: nowrap;
}
._fauto-refresh-as-of {
  color: rgba(200,148,63,0.60);
}
._fauto-refresh-interval {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.35);
  letter-spacing: 0.04em;
  margin-left: auto;
}
._fauto-refresh-btn {
  font-size: 11px;
  font-family: var(--mono, monospace);
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 4px 12px;
  border-radius: 2px;
  border: 1px solid rgba(200,148,63,0.30);
  background: rgba(200,148,63,0.08);
  color: #e2b85c;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
}
._fauto-refresh-btn:hover {
  background: rgba(200,148,63,0.16);
  border-color: rgba(200,148,63,0.50);
}
._fauto-refresh-btn:active {
  background: rgba(200,148,63,0.24);
}
`;
