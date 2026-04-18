"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import {
  cancelTradingOrder,
  getBrokerStatus,
  getEffectiveQuotes,
  getKillSwitch,
  getRiskLimit,
  getTradingAccounts,
  getTradingBalance,
  getTradingOrders,
  getTradingPositions,
  setKillSwitch,
  type EffectiveQuotesResponse
} from "@/lib/api";
import type {
  Balance,
  BrokerAccount,
  BrokerConnectionStatus,
  KillSwitchState,
  Order,
  Position,
  RiskLimit
} from "@iuf-trading-room/contracts";

import { ExecutionTimeline } from "./execution-timeline";
import { OrderTicket } from "./order-ticket";
import { RiskLimitsConfig } from "./risk-limits-config";
import { useExecutionStream } from "./use-execution-stream";

// SSE is authoritative — this polling is just a belt-and-suspenders fallback
// in case the stream drops without firing the error branch (e.g. a proxy
// closes the socket cleanly after an idle timeout).
const FALLBACK_REFRESH_MS = 30_000;

function formatMoney(value: number, currency = "TWD") {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function formatPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatQty(value: number) {
  return new Intl.NumberFormat("zh-TW").format(value);
}

const KILL_SWITCH_MODES: Array<{
  mode: KillSwitchState["mode"];
  label: string;
  color: string;
}> = [
  { mode: "trading", label: "TRADING", color: "var(--phosphor)" },
  { mode: "liquidate_only", label: "LIQUIDATE ONLY", color: "var(--amber)" },
  { mode: "halted", label: "HALTED", color: "var(--danger, #ff4d4d)" },
  { mode: "paper_only", label: "PAPER ONLY", color: "var(--dim)" }
];

const OPEN_STATUSES = new Set(["pending", "submitted", "acknowledged", "partial"]);

export default function PortfolioPage() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<BrokerConnectionStatus | null>(null);
  const [killSwitch, setKillSwitchState] = useState<KillSwitchState | null>(null);
  const [riskLimit, setRiskLimit] = useState<RiskLimit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const refresh = useCallback(
    async (id: string) => {
      try {
        const [b, p, o, st, k, rl] = await Promise.all([
          getTradingBalance(id),
          getTradingPositions(id),
          getTradingOrders({ accountId: id }),
          getBrokerStatus(id),
          getKillSwitch(id),
          getRiskLimit(id)
        ]);
        setBalance(b.data);
        setPositions(p.data);
        setOrders(o.data);
        setStatus(st.data);
        setKillSwitchState(k.data);
        setRiskLimit(rl.data);
        setLoadError(null);
      } catch (err) {
        setLoadError((err as Error).message);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getTradingAccounts();
        if (cancelled) return;
        setAccounts(res.data);
        const first = res.data[0]?.id ?? null;
        setAccountId(first);
        if (first) await refresh(first);
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!accountId) return;
    const interval = setInterval(() => {
      refresh(accountId).catch(() => undefined);
    }, FALLBACK_REFRESH_MS);
    return () => clearInterval(interval);
  }, [accountId, refresh]);

  const onExecutionEvent = useCallback(() => {
    if (accountId) refresh(accountId).catch(() => undefined);
  }, [accountId, refresh]);

  const { events: executionEvents, status: streamStatus } = useExecutionStream(
    Boolean(accountId),
    onExecutionEvent
  );

  const onToggleKillSwitch = useCallback(
    async (mode: KillSwitchState["mode"]) => {
      if (!accountId) return;
      setMutating(true);
      try {
        await setKillSwitch({
          accountId,
          mode,
          reason: mode === "trading" ? "" : "manual toggle",
          engagedBy: "operator"
        });
        await refresh(accountId);
      } catch (err) {
        setLoadError((err as Error).message);
      } finally {
        setMutating(false);
      }
    },
    [accountId, refresh]
  );

  const onCancelOrder = useCallback(
    async (orderId: string) => {
      if (!accountId) return;
      setMutating(true);
      try {
        await cancelTradingOrder(accountId, { orderId, reason: "manual cancel" });
        await refresh(accountId);
      } catch (err) {
        setLoadError((err as Error).message);
      } finally {
        setMutating(false);
      }
    },
    [accountId, refresh]
  );

  const openOrders = useMemo(
    () => orders.filter((o) => OPEN_STATUSES.has(o.status)),
    [orders]
  );
  const filledOrders = useMemo(
    () => orders.filter((o) => !OPEN_STATUSES.has(o.status)).slice(0, 10),
    [orders]
  );

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null,
    [accounts, accountId]
  );
  const isPaper = activeAccount?.isPaper ?? true;
  const brokerLabel = activeAccount?.broker ?? "paper";

  // Symbols we care about for live quote readiness: every symbol the trader
  // already has skin in (open positions or working orders). Dedupe + sort so
  // the effect dep is stable across re-renders that don't actually change the
  // set.
  const watchedSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of positions) set.add(p.symbol);
    for (const o of openOrders) set.add(o.symbol);
    return [...set].sort();
  }, [positions, openOrders]);
  const watchedSymbolsKey = watchedSymbols.join(",");

  const [marketData, setMarketData] = useState<EffectiveQuotesResponse | null>(null);
  useEffect(() => {
    if (watchedSymbols.length === 0) {
      setMarketData(null);
      return;
    }
    let cancelled = false;
    getEffectiveQuotes({
      symbols: watchedSymbolsKey,
      includeStale: true,
      limit: watchedSymbols.length
    })
      .then((res) => {
        if (!cancelled) setMarketData(res.data);
      })
      .catch((err) => {
        if (!cancelled) console.warn("[portfolio] getEffectiveQuotes failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [watchedSymbolsKey, watchedSymbols.length]);

  return (
    <AppShell eyebrow="持倉部位" title="帳戶 · 部位 · 風控">
      <ModeBanner
        isPaper={isPaper}
        broker={brokerLabel}
        connected={status?.connected ?? false}
        streamStatus={streamStatus}
      />

      <MarketDataBanner data={marketData} symbolCount={watchedSymbols.length} />

      {loadError && (
        <section
          className="hud-frame"
          style={{ padding: "1rem", marginBottom: "1rem", borderColor: "var(--amber)" }}
        >
          <p style={{ color: "var(--amber)", fontFamily: "var(--mono, monospace)" }}>
            [ERR] {loadError}
          </p>
        </section>
      )}

      <section className="hud-frame" style={{ padding: "1.5rem" }}>
        <p className="ascii-head" data-idx="01">
          [01] 帳戶總覽{" "}
          {accounts.length > 0 && (
            <span style={{ color: "var(--dim)", marginLeft: "0.5rem" }}>
              {accounts.length === 1
                ? `(${accounts[0].accountNo} · ${accounts[0].isPaper ? "PAPER" : "LIVE"})`
                : `${accounts.length} accounts`}
            </span>
          )}
        </p>
        {!balance ? (
          <p className="loading-text" style={{ fontFamily: "var(--mono, monospace)" }}>
            [LOAD] 讀取帳戶資料中…
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "0.75rem",
              fontFamily: "var(--mono, monospace)"
            }}
          >
            <Stat label="總權益" value={formatMoney(balance.equity, balance.currency)} accent="phosphor" />
            <Stat label="現金" value={formatMoney(balance.cash, balance.currency)} />
            <Stat
              label="市值"
              value={formatMoney(balance.marketValue, balance.currency)}
            />
            <Stat
              label="未實現損益"
              value={formatMoney(balance.unrealizedPnl, balance.currency)}
              accent={balance.unrealizedPnl >= 0 ? "phosphor" : "amber"}
            />
            <Stat
              label="今日已實現"
              value={formatMoney(balance.realizedPnlToday, balance.currency)}
              accent={balance.realizedPnlToday >= 0 ? "phosphor" : "amber"}
            />
            <Stat
              label="連線"
              value={status?.connected ? "ONLINE" : "OFFLINE"}
              accent={status?.connected ? "phosphor" : "amber"}
            />
          </div>
        )}
      </section>

      {accountId && (
        <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
          <p className="ascii-head" data-idx="02">
            [02] 下單台
          </p>
          <OrderTicket
            accountId={accountId}
            onSubmitted={() => refresh(accountId).catch(() => undefined)}
          />
        </section>
      )}

      <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <p className="ascii-head" data-idx="03">
          [03] 部位（{positions.length}）
        </p>
        {positions.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--mono, monospace)",
              color: "var(--dim)",
              padding: "1rem 0"
            }}
          >
            [EMPTY] 尚無持倉。送出訂單後會在這裡顯示即時 mark-to-market。
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "var(--mono, monospace)",
                fontSize: "0.9rem"
              }}
            >
              <thead>
                <tr style={{ color: "var(--dim)", textAlign: "left" }}>
                  <th style={th}>代號</th>
                  <th style={thRight}>數量</th>
                  <th style={thRight}>均價</th>
                  <th style={thRight}>現價</th>
                  <th style={thRight}>市值</th>
                  <th style={thRight}>未實現損益</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.symbol} style={{ borderTop: "1px solid var(--line, #2a2a2a)" }}>
                    <td style={td}>{p.symbol}</td>
                    <td style={tdRight}>{formatQty(p.quantity)}</td>
                    <td style={tdRight}>{p.avgPrice.toFixed(2)}</td>
                    <td style={tdRight}>{p.marketPrice?.toFixed(2) ?? "—"}</td>
                    <td style={tdRight}>
                      {p.marketValue !== null ? formatMoney(p.marketValue) : "—"}
                    </td>
                    <td
                      style={{
                        ...tdRight,
                        color:
                          p.unrealizedPnl === null
                            ? "var(--dim)"
                            : p.unrealizedPnl >= 0
                              ? "var(--phosphor)"
                              : "var(--amber)"
                      }}
                    >
                      {p.unrealizedPnl === null
                        ? "—"
                        : `${formatMoney(p.unrealizedPnl)} (${formatPct(p.unrealizedPnlPct)})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <p className="ascii-head" data-idx="04">
          [04] 開放中委託（{openOrders.length}）
        </p>
        {openOrders.length === 0 ? (
          <p style={{ fontFamily: "var(--mono, monospace)", color: "var(--dim)" }}>
            [EMPTY] 沒有未結委託。
          </p>
        ) : (
          <OrdersTable orders={openOrders} canCancel onCancel={onCancelOrder} busy={mutating} />
        )}
      </section>

      {filledOrders.length > 0 && (
        <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
          <p className="ascii-head" data-idx="05">
            [05] 最近成交／取消（最多 10 筆）
          </p>
          <OrdersTable orders={filledOrders} />
        </section>
      )}

      <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <p className="ascii-head" data-idx="06">
          [06] 風控上限 {riskLimit ? "" : "(載入中)"}
        </p>
        {activeAccount ? (
          <RiskLimitsConfig
            accountId={activeAccount.id}
            current={riskLimit}
            onSaved={(updated) => setRiskLimit(updated)}
          />
        ) : (
          <p style={{ color: "var(--dim)", fontFamily: "var(--mono, monospace)" }}>
            等待帳戶載入…
          </p>
        )}
      </section>

      <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <p className="ascii-head" data-idx="07">
          [07] Kill Switch
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            fontFamily: "var(--mono, monospace)"
          }}
        >
          {KILL_SWITCH_MODES.map((m) => {
            const active = killSwitch?.mode === m.mode;
            return (
              <button
                key={m.mode}
                disabled={mutating || active}
                onClick={() => onToggleKillSwitch(m.mode)}
                style={{
                  padding: "0.5rem 1rem",
                  background: active ? m.color : "transparent",
                  color: active ? "var(--bg, #0a0a0a)" : m.color,
                  border: `1px solid ${m.color}`,
                  borderRadius: 2,
                  cursor: mutating || active ? "default" : "pointer",
                  fontFamily: "var(--mono, monospace)",
                  fontSize: "0.85rem",
                  letterSpacing: "0.05em"
                }}
              >
                [{m.label}]
              </button>
            );
          })}
        </div>
        {killSwitch && killSwitch.engaged && (
          <p
            style={{
              marginTop: "0.75rem",
              fontFamily: "var(--mono, monospace)",
              color: "var(--amber)",
              fontSize: "0.85rem"
            }}
          >
            [ENGAGED] {killSwitch.reason || "—"} · by{" "}
            {killSwitch.engagedBy ?? "—"} · {killSwitch.engagedAt ?? ""}
          </p>
        )}
      </section>

      <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <p className="ascii-head" data-idx="08">
          [08] Execution Timeline
        </p>
        <ExecutionTimeline events={executionEvents} status={streamStatus} />
      </section>
    </AppShell>
  );
}

const th: React.CSSProperties = { padding: "0.4rem 0.5rem", fontWeight: "normal" };
const thRight: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "0.4rem 0.5rem" };
const tdRight: React.CSSProperties = { ...td, textAlign: "right" };

function ModeBanner({
  isPaper,
  broker,
  connected,
  streamStatus
}: {
  isPaper: boolean;
  broker: string;
  connected: boolean;
  streamStatus: "connecting" | "live" | "reconnecting" | "error";
}) {
  const accent = isPaper ? "var(--amber)" : "var(--phosphor)";
  const label = isPaper ? "PAPER MODE" : "LIVE BROKER";
  const note = isPaper
    ? "模擬資金 · 任何送單只進 in-memory paper broker，不會觸及真實券商"
    : `已連線 ${broker.toUpperCase()} · 真實下單會直達券商`;
  const streamLabel: Record<typeof streamStatus, string> = {
    connecting: "● CONNECTING",
    live: "● LIVE",
    reconnecting: "● RECONNECTING",
    error: "● STREAM ERROR"
  };
  const streamColor =
    streamStatus === "live"
      ? "var(--phosphor)"
      : streamStatus === "reconnecting"
        ? "var(--amber)"
        : streamStatus === "error"
          ? "var(--danger, #ff4d4d)"
          : "var(--dim)";
  return (
    <section
      className="hud-frame"
      style={{
        padding: "0.75rem 1.25rem",
        marginBottom: "1rem",
        borderColor: accent,
        borderWidth: 2,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem 1.5rem",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: "var(--mono, monospace)"
      }}
    >
      <div style={{ display: "flex", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
        <span
          style={{
            color: accent,
            fontSize: "1.05rem",
            letterSpacing: "0.1em",
            fontWeight: 600
          }}
        >
          [{label}]
        </span>
        <span style={{ color: "var(--dim)", fontSize: "0.85rem" }}>{note}</span>
      </div>
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem" }}>
        <span
          style={{
            color: connected ? "var(--phosphor)" : "var(--amber)"
          }}
        >
          BROKER {connected ? "ONLINE" : "OFFLINE"}
        </span>
        <span style={{ color: streamColor }}>{streamLabel[streamStatus]}</span>
      </div>
    </section>
  );
}

function MarketDataBanner({
  data,
  symbolCount
}: {
  data: EffectiveQuotesResponse | null;
  symbolCount: number;
}) {
  if (symbolCount === 0) return null;
  const summary = data?.summary;
  const blocked = summary?.blocked ?? 0;
  const degraded = summary?.degraded ?? 0;
  const ready = summary?.ready ?? 0;
  const accent =
    blocked > 0
      ? "var(--danger, #ff4d4d)"
      : degraded > 0
        ? "var(--amber)"
        : "var(--phosphor)";
  const label =
    blocked > 0
      ? "QUOTE FEED · BLOCKED"
      : degraded > 0
        ? "QUOTE FEED · DEGRADED"
        : "QUOTE FEED · READY";

  return (
    <section
      className="hud-frame"
      style={{
        padding: "0.5rem 1.25rem",
        marginBottom: "1rem",
        borderColor: accent,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem 1.5rem",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.8rem"
      }}
    >
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
        <span style={{ color: accent, letterSpacing: "0.08em", fontWeight: 600 }}>
          [{label}]
        </span>
        <span style={{ color: "var(--dim)" }}>
          watching {symbolCount} 個標的
          {data ? ` · 更新於 ${new Date(data.generatedAt).toLocaleTimeString("zh-TW", { hour12: false })}` : "…"}
        </span>
      </div>
      {summary && (
        <div style={{ display: "flex", gap: "1rem" }}>
          <Tally label="ready" value={ready} color="var(--phosphor)" />
          <Tally label="degraded" value={degraded} color="var(--amber)" />
          <Tally label="blocked" value={blocked} color="var(--danger, #ff4d4d)" />
          <Tally label="paper-usable" value={summary.paperUsable} color="var(--dim)" />
        </div>
      )}
    </section>
  );
}

function Tally({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ color: "var(--dim)" }}>
      {label} <span style={{ color, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: "phosphor" | "amber";
}) {
  const color =
    accent === "amber"
      ? "var(--amber)"
      : accent === "phosphor"
        ? "var(--phosphor)"
        : "var(--fg, #eee)";
  return (
    <div>
      <div style={{ color: "var(--dim)", fontSize: "0.75rem" }}>{label}</div>
      <div style={{ color, fontSize: "1.1rem", marginTop: "0.15rem" }}>{value}</div>
    </div>
  );
}

function OrdersTable({
  orders,
  canCancel = false,
  onCancel,
  busy
}: {
  orders: Order[];
  canCancel?: boolean;
  onCancel?: (id: string) => void;
  busy?: boolean;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.85rem"
        }}
      >
        <thead>
          <tr style={{ color: "var(--dim)", textAlign: "left" }}>
            <th style={th}>時間</th>
            <th style={th}>代號</th>
            <th style={th}>方向</th>
            <th style={thRight}>數量</th>
            <th style={thRight}>價格</th>
            <th style={thRight}>成交</th>
            <th style={th}>狀態</th>
            {canCancel && <th style={th}></th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} style={{ borderTop: "1px solid var(--line, #2a2a2a)" }}>
              <td style={td}>{new Date(o.createdAt).toLocaleTimeString("zh-TW")}</td>
              <td style={td}>{o.symbol}</td>
              <td
                style={{
                  ...td,
                  color: o.side === "buy" ? "var(--phosphor)" : "var(--amber)"
                }}
              >
                {o.side === "buy" ? "買" : "賣"} {o.type}
              </td>
              <td style={tdRight}>{formatQty(o.quantity)}</td>
              <td style={tdRight}>{o.price?.toFixed(2) ?? "MKT"}</td>
              <td style={tdRight}>
                {formatQty(o.filledQuantity)}
                {o.avgFillPrice && ` @${o.avgFillPrice.toFixed(2)}`}
              </td>
              <td style={td}>{o.status}</td>
              {canCancel && (
                <td style={td}>
                  <button
                    disabled={busy}
                    onClick={() => onCancel?.(o.id)}
                    style={{
                      background: "transparent",
                      color: "var(--amber)",
                      border: "1px solid var(--amber)",
                      padding: "0.2rem 0.5rem",
                      fontFamily: "var(--mono, monospace)",
                      fontSize: "0.75rem",
                      cursor: busy ? "default" : "pointer"
                    }}
                  >
                    取消
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
