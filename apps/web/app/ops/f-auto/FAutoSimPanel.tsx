"use client";

/**
 * B1 — F-AUTO SIM 觀察面板（主 client component）
 *
 * Sections:
 *   1. SIM 帳戶部位   — GET /api/v1/paper/positions?source=sim
 *   2. SIM 帳戶資金   — GET /api/v1/paper/funds?source=sim
 *   3. S1 訊號/狀態   — GET /api/v1/internal/s1-sim/status  (Jason pending → graceful)
 *   4. S1 當日委託/成交 — GET /api/v1/kgi/sim/orders
 *   5. S1 EOD 報告    — GET /api/v1/internal/s1-sim/eod-report?date= (Jason pending)
 *   6. Daily smoke    — GET /api/v1/internal/kgi/sim/daily-smoke-status
 */

import { useEffect, useState } from "react";
import {
  getSimPositions,
  getSimFunds,
  getKgiSimOrders,
  getDailySmokeHistory,
  getS1SimStatus,
  getS1SimEodReport,
  fmtTwd,
  fmtDatetime,
  type SimPosition,
  type SimFunds,
  type KgiSimRawOrderItem,
  type DailySmokeHistory,
  type S1SimStatus,
  type S1EodReport,
} from "@/lib/fauto-sim-api";
import { KgiConnectionLight } from "./KgiConnectionLight";

type AsyncState<T> =
  | { phase: "loading" }
  | { phase: "empty" }
  | { phase: "error"; message: string }
  | { phase: "live"; data: T }
  | { phase: "pending_backend" };   // for Jason-pending endpoints

function useFetch<T>(
  fetcher: () => Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }>,
  isJasonPending = false,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(
    isJasonPending ? { phase: "pending_backend" } : { phase: "loading" },
  );

  useEffect(() => {
    if (isJasonPending) {
      setState({ phase: "pending_backend" });
      return;
    }
    let cancelled = false;
    setState({ phase: "loading" });
    fetcher().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 404 || result.status === 501) {
          setState({ phase: "pending_backend" });
        } else {
          setState({ phase: "error", message: `HTTP ${result.status}` });
        }
        return;
      }
      const d = result.data;
      const isEmpty =
        d === null ||
        d === undefined ||
        (Array.isArray(d) && d.length === 0) ||
        (typeof d === "object" && Object.keys(d).length === 0);
      setState(isEmpty ? { phase: "empty" } : { phase: "live", data: d });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJasonPending]);

  return state;
}

// ─── Date selector (today / yesterday / D-2) ─────────────────────────────────

function toTpeDate(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function SimPositionsPanel({ state }: { state: AsyncState<SimPosition[]> }) {
  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">SIM-POS</span>
        <span className="_fauto-panel-title">SIM 部位</span>
        <span className="_fauto-panel-sub">KGI SIM 重建倉位</span>
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
        <span className="_fauto-panel-title">SIM 資金</span>
        <span className="_fauto-panel-sub">KGI SIM 重建餘額</span>
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
        {state.phase === "pending_backend" && <PanelPending label="S1 狀態（Jason 補 endpoint 後啟用）" />}
        {state.phase === "live" && (
          <div className="_fauto-kv-list">
            {([
              ["市場態勢", state.data.regime ?? "--"],
              ["曝險比重", state.data.exposureWeight != null ? `${(state.data.exposureWeight * 100).toFixed(0)}%` : "--"],
              ["最後訊號", state.data.lastSignalDate ?? "--"],
              ["最後委託", state.data.lastOrderDate ?? "--"],
              ["最後 EOD", state.data.lastEodDate ?? "--"],
              ["成功委託", state.data.ordersAccepted != null ? String(state.data.ordersAccepted) : "--"],
              ["失敗委託", state.data.ordersAttempted != null && state.data.ordersAccepted != null
                ? String(state.data.ordersAttempted - state.data.ordersAccepted) : "--"],
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

function SimOrdersPanel({ state }: { state: AsyncState<KgiSimRawOrderItem[]> }) {
  return (
    <div className="_fauto-panel">
      <div className="_fauto-panel-head">
        <span className="_fauto-panel-code">SIM-ORD</span>
        <span className="_fauto-panel-title">當日委託 / 成交</span>
        <span className="_fauto-panel-sub">KGI SIM 委託歷程</span>
      </div>
      <div className="_fauto-panel-body">
        {state.phase === "loading" && <PanelLoading />}
        {state.phase === "error" && <PanelError message={state.message} />}
        {state.phase === "empty" && <PanelEmpty label="今日尚無委託" />}
        {state.phase === "pending_backend" && <PanelPending label="委託記錄" />}
        {state.phase === "live" && (
          <table className="_fauto-tbl">
            <thead>
              <tr>
                <th>代碼</th>
                <th>方向</th>
                <th className="_fauto-tbl-r">數量</th>
                <th className="_fauto-tbl-r">價格</th>
                <th>狀態</th>
                <th className="_fauto-tbl-r">時間</th>
              </tr>
            </thead>
            <tbody>
              {state.data.slice(0, 30).map((ord, i) => (
                <tr key={ord.tradeId ?? `ord-${i}`}>
                  <td className="_fauto-symbol">{ord.symbol}</td>
                  <td className={ord.side === "buy" ? "_fauto-side-buy" : "_fauto-side-sell"}>
                    {ord.side === "buy" ? "買進" : "賣出"}
                  </td>
                  <td className="_fauto-tbl-r">
                    {ord.effectiveQtyShares.toLocaleString("zh-TW")}
                    <span className="_fauto-unit">{ord.quantityUnit === "LOT" ? "張" : "股"}</span>
                  </td>
                  <td className="_fauto-tbl-r">
                    {ord.price != null ? ord.price.toFixed(2) : "市價"}
                  </td>
                  <td>
                    <span className={`_fauto-ord-status _fauto-ord-${ord.status.toLowerCase()}`}>
                      {orderStatusLabel(ord.status)}
                    </span>
                  </td>
                  <td className="_fauto-tbl-r _fauto-ts">{fmtDatetime(ord.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        {state.phase === "pending_backend" && <PanelPending label="EOD 報告（Jason 補 endpoint 後啟用）" />}
        {state.phase === "live" && (
          <>
            <div className="_fauto-kv-list" style={{ marginBottom: 12 }}>
              {([
                ["態勢", state.data.regime ?? "--"],
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
                <span className={`_fauto-kv-value ${state.data.lastRunStatus === "pass" ? "_fauto-green" : "_fauto-red"}`}>
                  {state.data.lastRunStatus ?? "--"}
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
                      <td className="_fauto-ts">{entry.date}</td>
                      <td>
                        <span className={`_fauto-smoke-badge ${entry.status === "pass" ? "_fauto-smoke-pass" : entry.status === "fail" ? "_fauto-smoke-fail" : "_fauto-smoke-skip"}`}>
                          {entry.status === "pass" ? "通過" : entry.status === "fail" ? "失敗" : entry.status === "pending" ? "待執行" : "跳過"}
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
      {label} — 等待後端 endpoint 上線
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
  if (s === "ACCEPTED" || s === "CONFIRMED") return "已接受";
  if (s === "PENDING") return "處理中";
  if (s === "REJECTED") return "已拒絕";
  if (s === "CANCELLED") return "已取消";
  return status;
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

  const posState = useFetch(getSimPositions);
  const fundsState = useFetch(getSimFunds);
  const ordersState = useFetch(getKgiSimOrders);
  const smokeState = useFetch(getDailySmokeHistory);

  // Jason-pending endpoints — will 404 until Jason adds them
  const s1StatusState = useFetch(getS1SimStatus, false);
  const [eodState, setEodState] = useState<AsyncState<S1EodReport>>({ phase: "pending_backend" });

  // Reload EOD when date changes
  useEffect(() => {
    let cancelled = false;
    setEodState({ phase: "loading" });
    getS1SimEodReport(selectedDate).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 404 || result.status === 501) {
          setEodState({ phase: "pending_backend" });
        } else if (result.status === 400) {
          setEodState({ phase: "empty" });
        } else {
          setEodState({ phase: "error", message: `HTTP ${result.status}` });
        }
        return;
      }
      setEodState({ phase: "live", data: result.data });
    });
    return () => { cancelled = true; };
  }, [selectedDate]);

  return (
    <div className="_fauto-root">
      {/* CSS block */}
      <style>{FAUTO_CSS}</style>

      {/* Top strip: connection light + date selector */}
      <div className="_fauto-top-strip">
        <KgiConnectionLight />
        <DateSelector selected={dateOffset} onChange={setDateOffset} />
      </div>

      {/* Main grid */}
      <div className="_fauto-grid">
        <SimPositionsPanel state={posState} />
        <SimFundsPanel state={fundsState} />
        <S1StatusPanel state={s1StatusState} />
        <SimOrdersPanel state={ordersState} />
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
`;
