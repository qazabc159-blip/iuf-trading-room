"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getKgiTicks,
  type FinMindKBarRow,
  type KgiTickEntry,
} from "@/lib/api";

const MAX_TICKS = 20;

type TickPanelState =
  | { status: "loading" }
  | { status: "live"; ticks: KgiTickEntry[]; fetchedAt: string }
  | { status: "aggregate"; reason: string; fetchedAt: string }
  | { status: "empty"; reason: string; fetchedAt: string }
  | { status: "blocked"; reason: string; fetchedAt: string };

function formatTime(value: string | null | undefined) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 5);
  return date.toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatKbarTime(row: FinMindKBarRow) {
  const minute = row.minute || "";
  if (/^\d{2}:\d{2}/.test(minute)) return minute.slice(0, 5);
  return `${row.date} ${minute}`.trim();
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW");
}

function tickTone(tick: KgiTickEntry) {
  const pct = tick.pct_chg;
  const chg = tick.price_chg;
  if (typeof pct === "number" && Number.isFinite(pct)) {
    if (pct > 0) return "up";
    if (pct < 0) return "down";
  }
  if (typeof chg === "number" && Number.isFinite(chg)) {
    if (chg > 0) return "up";
    if (chg < 0) return "down";
  }
  if (tick.chg_type === 1) return "up";
  if (tick.chg_type === 3) return "down";
  return "muted";
}

function kbarTone(row: FinMindKBarRow) {
  if (row.close > row.open) return "up";
  if (row.close < row.open) return "down";
  return "muted";
}

function statusCopy(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/401|403|OWNER_ONLY|unauth/i.test(msg)) {
    return "目前登入權限不足，無法讀取 KGI 唯讀逐筆；下方改用正式 FinMind 分K成交摘要。";
  }
  if (/SYMBOL_NOT_ALLOWED/i.test(msg)) {
    return "此股票尚未列入 KGI 唯讀逐筆覆蓋清單；下方改用正式 FinMind 分K成交摘要。";
  }
  if (/GATEWAY|unreachable|timeout|fetch/i.test(msg)) {
    return "KGI 唯讀逐筆暫時無法連線；下方改用正式 FinMind 分K成交摘要。";
  }
  return "KGI 唯讀逐筆暫時沒有回傳；下方改用正式 FinMind 分K成交摘要。";
}

function rowsFromKbar(kbarRows: FinMindKBarRow[]) {
  return [...kbarRows]
    .filter((row) => Number.isFinite(row.close) && Number.isFinite(row.volume))
    .sort((a, b) => {
      const left = `${a.date} ${a.minute}`;
      const right = `${b.date} ${b.minute}`;
      return right.localeCompare(left);
    })
    .slice(0, MAX_TICKS);
}

export function TickStreamPanel({
  symbol,
  kbarRows,
  kbarState,
  kbarReason,
}: {
  symbol: string;
  kbarRows: FinMindKBarRow[];
  kbarState: "LIVE" | "EMPTY" | "BLOCKED";
  kbarReason: string;
}) {
  const [state, setState] = useState<TickPanelState>({ status: "loading" });
  const aggregateRows = useMemo(() => rowsFromKbar(kbarRows), [kbarRows]);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    getKgiTicks(symbol, MAX_TICKS)
      .then((result) => {
        if (!active) return;
        const ticks = (result?.ticks ?? []).filter((tick) => {
          const price = tick.close;
          return typeof price === "number" && Number.isFinite(price);
        });
        if (ticks.length > 0) {
          setState({ status: "live", ticks, fetchedAt: new Date().toISOString() });
          return;
        }
        if (aggregateRows.length > 0) {
          setState({
            status: "aggregate",
            reason: "KGI 逐筆尚未回傳，先顯示正式 FinMind 分K成交摘要；這不是逐筆 tick，不混充。",
            fetchedAt: new Date().toISOString(),
          });
          return;
        }
        setState({
          status: "empty",
          reason: kbarState === "BLOCKED" ? kbarReason : "目前沒有可顯示的 KGI 逐筆或 FinMind 分K成交資料。",
          fetchedAt: new Date().toISOString(),
        });
      })
      .catch((err) => {
        if (!active) return;
        if (aggregateRows.length > 0) {
          setState({
            status: "aggregate",
            reason: statusCopy(err),
            fetchedAt: new Date().toISOString(),
          });
          return;
        }
        setState({ status: "blocked", reason: statusCopy(err), fetchedAt: new Date().toISOString() });
      });

    return () => {
      active = false;
    };
  }, [aggregateRows, kbarReason, kbarState, symbol]);

  const badge =
    state.status === "live" ? "LIVE" :
    state.status === "aggregate" ? "分K摘要" :
    state.status === "loading" ? "讀取中" :
    state.status === "empty" ? "無資料" :
    "暫停";
  const badgeClass =
    state.status === "live" ? "badge-green" :
    state.status === "aggregate" ? "badge-yellow" :
    state.status === "loading" ? "badge-blue" :
    state.status === "empty" ? "badge-yellow" :
    "badge-red";

  return (
    <section className="panel hud-frame company-intel-panel company-secondary-status-panel company-tick-console">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">逐筆</span> 成交明細
        <span className="dim" style={{ fontSize: 11, marginLeft: 10 }}>
          KGI 逐筆 / FinMind 分K摘要
        </span>
      </h3>

      <div className="source-line" style={{ marginBottom: 10 }}>
        <span className={`badge ${badgeClass}`}>{badge}</span>
        <span className="tg soft">標的：{symbol}</span>
        <span className="tg soft">
          {state.status === "live"
            ? `KGI 逐筆 ${state.ticks.length} 筆`
            : state.status === "aggregate"
              ? `FinMind 分K ${aggregateRows.length} 筆`
              : "等待資料"}
        </span>
      </div>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="state-reason">正在讀取 KGI 逐筆；若沒有回傳，會自動切到正式 FinMind 分K成交摘要。</span>
        </div>
      )}

      {(state.status === "blocked" || state.status === "empty") && (
        <div className="state-panel">
          <span className={`badge ${state.status === "blocked" ? "badge-red" : "badge-yellow"}`}>
            {state.status === "blocked" ? "暫停" : "無資料"}
          </span>
          <span className="state-reason">{state.reason}</span>
        </div>
      )}

      {state.status === "aggregate" && (
        <>
          <div className="state-panel" style={{ marginBottom: 10 }}>
            <span className="badge badge-yellow">分K摘要</span>
            <span className="state-reason">{state.reason}</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>開</th>
                  <th>高</th>
                  <th>低</th>
                  <th>收</th>
                  <th>量</th>
                </tr>
              </thead>
              <tbody>
                {aggregateRows.map((row) => (
                  <tr key={`${row.date}-${row.minute}`}>
                    <td>{formatKbarTime(row)}</td>
                    <td>{formatPrice(row.open)}</td>
                    <td>{formatPrice(row.high)}</td>
                    <td>{formatPrice(row.low)}</td>
                    <td className={kbarTone(row)}>{formatPrice(row.close)}</td>
                    <td>{formatVolume(row.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {state.status === "live" && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>時間</th>
                <th>成交價</th>
                <th>漲跌</th>
                <th>量</th>
              </tr>
            </thead>
            <tbody>
              {state.ticks.slice(0, MAX_TICKS).map((tick, index) => (
                <tr key={`${tick.datetime ?? tick._received_at ?? index}-${index}`}>
                  <td>{formatTime(tick.datetime ?? tick._received_at)}</td>
                  <td className={tickTone(tick)}>{formatPrice(tick.close)}</td>
                  <td className={tickTone(tick)}>
                    {typeof tick.price_chg === "number" && Number.isFinite(tick.price_chg)
                      ? `${tick.price_chg > 0 ? "+" : ""}${formatPrice(tick.price_chg)}`
                      : "--"}
                  </td>
                  <td>{formatVolume(tick.volume ?? tick.total_volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
