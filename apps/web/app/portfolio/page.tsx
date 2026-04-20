"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import {
  cancelTradingOrder,
  getBrokerStatus,
  getKillSwitch,
  getMarketDataDecisionSummary,
  getRiskLimit,
  getTradingAccounts,
  getTradingBalance,
  getTradingOrders,
  getTradingPositions,
  setKillSwitch
} from "@/lib/api";
import type {
  Balance,
  BrokerAccount,
  BrokerConnectionStatus,
  KillSwitchState,
  MarketDataDecisionSummary,
  MarketDataDecisionSummaryItem,
  Order,
  Position,
  RiskLimit
} from "@iuf-trading-room/contracts";

import { clearIdeaHandoff, readIdeaHandoff, type IdeaHandoff } from "@/lib/idea-handoff";
import { MODE_DECISION_HINT } from "@/lib/quote-vocab";

import { ExecutionTimeline } from "./execution-timeline";
import { OrderTicket } from "./order-ticket";
import { RiskLayerOverrides } from "./risk-layer-overrides";
import { RiskLimitsConfig } from "./risk-limits-config";
import { StrategyContextCard } from "./strategy-context-card";
import { useExecutionStream } from "./use-execution-stream";

// bullish / bearish map to buy / sell; neutral leaves the side alone so the
// trader must pick deliberately. Kept colocated here (not in idea-handoff.ts)
// because this is the specific rule for "what's safe to auto-fill into the
// order ticket", which is a UX call, not a data contract.
function directionToSide(
  direction: IdeaHandoff["direction"]
): "buy" | "sell" | undefined {
  if (direction === "bullish") return "buy";
  if (direction === "bearish") return "sell";
  return undefined;
}

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
  return (
    <Suspense fallback={null}>
      <PortfolioPageInner />
    </Suspense>
  );
}

function PortfolioPageInner() {
  const searchParams = useSearchParams();
  const incomingSymbol = searchParams.get("symbol")?.trim() || undefined;
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
  const [ideaHandoff, setIdeaHandoff] = useState<IdeaHandoff | null>(null);

  // Pull the handoff out of sessionStorage once we know which symbol the URL
  // is asking for — readIdeaHandoff validates the symbol match so stale
  // payloads from a previous /ideas click never attach to the wrong ticker.
  useEffect(() => {
    setIdeaHandoff(readIdeaHandoff(incomingSymbol));
  }, [incomingSymbol]);

  const onDismissHandoff = useCallback(() => {
    clearIdeaHandoff();
    setIdeaHandoff(null);
  }, []);

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

  const quoteMode: "paper" | "execution" = isPaper ? "paper" : "execution";
  const [marketData, setMarketData] = useState<MarketDataDecisionSummary | null>(null);
  const [marketDataError, setMarketDataError] = useState<string | null>(null);
  const [marketDataNonce, setMarketDataNonce] = useState(0);
  const refreshMarketData = useCallback(() => {
    setMarketDataNonce((n) => n + 1);
  }, []);
  useEffect(() => {
    if (watchedSymbols.length === 0) {
      setMarketData(null);
      setMarketDataError(null);
      return;
    }
    let cancelled = false;
    getMarketDataDecisionSummary({
      symbols: watchedSymbolsKey,
      includeStale: true,
      limit: watchedSymbols.length
    })
      .then((res) => {
        if (cancelled) return;
        setMarketData(res.data);
        setMarketDataError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[portfolio] decision-summary failed:", err);
        setMarketDataError((err as Error).message || "decision-summary 失敗");
      });
    return () => {
      cancelled = true;
    };
  }, [watchedSymbolsKey, watchedSymbols.length, quoteMode, marketDataNonce]);

  // Build a quick lookup map so the positions table / orders rows can badge
  // their readiness without re-scanning items[] per row.
  const quoteBySymbol = useMemo(() => {
    const map = new Map<string, MarketDataDecisionSummaryItem>();
    if (marketData) {
      for (const item of marketData.items) map.set(item.symbol, item);
    }
    return map;
  }, [marketData]);

  return (
    <AppShell eyebrow="持倉部位" title="帳戶 · 部位 · 風控">
      <ModeBanner
        isPaper={isPaper}
        broker={brokerLabel}
        connected={status?.connected ?? false}
        streamStatus={streamStatus}
      />

      <MarketDataBanner
        data={marketData}
        error={marketDataError}
        symbolCount={watchedSymbols.length}
        mode={quoteMode}
        onRefresh={refreshMarketData}
      />

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
          {ideaHandoff && (
            <div style={{ marginBottom: "1rem" }}>
              <StrategyContextCard handoff={ideaHandoff} onDismiss={onDismissHandoff} />
            </div>
          )}
          <OrderTicket
            accountId={accountId}
            quoteMode={quoteMode}
            initialSymbol={incomingSymbol}
            initialSide={ideaHandoff ? directionToSide(ideaHandoff.direction) : undefined}
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
                  <th style={th}>報價</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const item = quoteBySymbol.get(p.symbol) ?? null;
                  return (
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
                      <td style={td}>
                        <ReadinessBadge item={item} mode={quoteMode} />
                      </td>
                    </tr>
                  );
                })}
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
          <OrdersTable
            orders={openOrders}
            quoteBySymbol={quoteBySymbol}
            quoteMode={quoteMode}
            canCancel
            onCancel={onCancelOrder}
            busy={mutating}
          />
        )}
      </section>

      {filledOrders.length > 0 && (
        <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
          <p className="ascii-head" data-idx="05">
            [05] 最近成交／取消（最多 10 筆）
          </p>
          <OrdersTable
            orders={filledOrders}
            quoteBySymbol={quoteBySymbol}
            quoteMode={quoteMode}
          />
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
          [07] 風控層覆寫 · Strategy / Symbol
        </p>
        {activeAccount ? (
          <RiskLayerOverrides accountId={activeAccount.id} />
        ) : (
          <p style={{ color: "var(--dim)", fontFamily: "var(--mono, monospace)" }}>
            等待帳戶載入…
          </p>
        )}
      </section>

      <section className="hud-frame" style={{ padding: "1.5rem", marginTop: "1rem" }}>
        <p className="ascii-head" data-idx="08">
          [08] Kill Switch
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
        <p className="ascii-head" data-idx="09">
          [09] Execution Timeline
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

function formatAge(generatedAt: string): string {
  const diffMs = Date.now() - new Date(generatedAt).getTime();
  if (diffMs < 0 || !Number.isFinite(diffMs)) return "";
  if (diffMs < 10_000) return "剛剛";
  if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s 前`;
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m 前`;
  return `${Math.round(diffMs / 3_600_000)}h 前`;
}

function MarketDataBanner({
  data,
  error,
  symbolCount,
  mode,
  onRefresh
}: {
  data: MarketDataDecisionSummary | null;
  error: string | null;
  symbolCount: number;
  mode: "paper" | "execution";
  onRefresh: () => void;
}) {
  if (symbolCount === 0) return null;

  if (error) {
    return (
      <section
        className="hud-frame"
        style={{
          padding: "0.5rem 1.25rem",
          marginBottom: "1rem",
          borderColor: "var(--amber)",
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
          <span style={{ color: "var(--amber)", letterSpacing: "0.08em", fontWeight: 600 }}>
            [QUOTE FEED · ERROR]
          </span>
          <span style={{ color: "var(--dim)" }}>
            watching {symbolCount} 個標的 · {error}
          </span>
        </div>
        <button
          onClick={onRefresh}
          style={{
            padding: "0.25rem 0.75rem",
            background: "transparent",
            color: "var(--amber)",
            border: "1px solid var(--amber)",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.75rem",
            cursor: "pointer"
          }}
        >
          [RETRY]
        </button>
      </section>
    );
  }

  const summary = data?.summary;
  const modeSummary = summary
    ? mode === "paper"
      ? summary.paper
      : summary.execution
    : null;
  const block = modeSummary?.block ?? 0;
  const review = modeSummary?.review ?? 0;
  const allow = modeSummary?.allow ?? 0;
  const accent =
    block > 0
      ? "var(--danger, #ff4d4d)"
      : review > 0
        ? "var(--amber)"
        : "var(--phosphor)";
  const label =
    block > 0
      ? "QUOTE FEED · BLOCK"
      : review > 0
        ? "QUOTE FEED · REVIEW"
        : "QUOTE FEED · ALLOW";
  const modeLabel = mode === "paper" ? "PAPER" : mode === "execution" ? "LIVE" : "STRATEGY";

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
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "baseline",
          flexWrap: "wrap",
          flexDirection: "column"
        }}
      >
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ color: accent, letterSpacing: "0.08em", fontWeight: 600 }}>
            [{label} · {modeLabel}]
          </span>
          <span style={{ color: "var(--dim)" }}>
            watching {symbolCount} 個標的
            {data ? ` · 更新於 ${formatAge(data.generatedAt)}` : "…"}
          </span>
        </div>
        {summary && (block > 0 || review > 0) && (
          <span style={{ color: "var(--dim)", fontSize: "0.72rem" }}>
            {block > 0
              ? MODE_DECISION_HINT.block
              : MODE_DECISION_HINT.review}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        {summary && (
          <>
            <Tally label="allow" value={allow} color="var(--phosphor)" />
            <Tally label="review" value={review} color="var(--amber)" />
            <Tally label="block" value={block} color="var(--danger, #ff4d4d)" />
            <Tally label="usable" value={modeSummary?.usable ?? 0} color="var(--dim)" />
            <Tally label="safe" value={modeSummary?.safe ?? 0} color="var(--dim)" />
          </>
        )}
        <button
          onClick={onRefresh}
          title="重新拉 decision-summary"
          style={{
            padding: "0.2rem 0.6rem",
            background: "transparent",
            color: "var(--dim)",
            border: "1px solid var(--line, #2a2a2a)",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.72rem",
            cursor: "pointer"
          }}
        >
          ↻
        </button>
      </div>
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

const READINESS_BADGE: Record<
  MarketDataDecisionSummaryItem["readiness"],
  { color: string; label: string }
> = {
  ready: { color: "var(--phosphor)", label: "●READY" },
  degraded: { color: "var(--amber)", label: "●DEGRADED" },
  blocked: { color: "var(--danger, #ff4d4d)", label: "●BLOCKED" }
};

function ReadinessBadge({
  item,
  mode
}: {
  item: MarketDataDecisionSummaryItem | null;
  mode: "paper" | "execution";
}) {
  if (!item) {
    return <span style={{ color: "var(--dim)", fontSize: "0.75rem" }}>— 無報價</span>;
  }
  const badge = READINESS_BADGE[item.readiness];
  const source = item.selectedSource ?? "none";
  const modeDecision = mode === "paper" ? item.paper : item.execution;
  // Pick the most salient reason to surface inline; full list is in OrderTicket
  // QuoteReadinessCard when the symbol is active.
  const stale =
    item.staleReason && item.staleReason !== "none" ? item.staleReason : null;
  const fallback =
    item.fallbackReason && item.fallbackReason !== "none" ? item.fallbackReason : null;
  const detail = stale ?? fallback ?? null;
  const title = [
    `${mode}.decision=${modeDecision.decision}`,
    `readiness=${item.readiness}`,
    `source=${source}`,
    `freshness=${item.freshnessStatus}`,
    `primary=${item.primaryReason}`,
    stale ? `stale=${stale}` : null,
    fallback ? `fallback=${fallback}` : null,
    ...item.reasons.map((r) => `· ${r}`)
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        gap: "0.4rem",
        alignItems: "baseline",
        color: badge.color,
        fontSize: "0.72rem",
        letterSpacing: "0.04em"
      }}
    >
      <span>{badge.label}</span>
      <span style={{ color: "var(--dim)" }}>{source}</span>
      <span style={{ color: modeDecision.safe ? "var(--phosphor)" : "var(--amber)" }}>
        {modeDecision.decision.toUpperCase()}
      </span>
      {detail && (
        <span style={{ color: "var(--amber)", fontSize: "0.7rem" }}>· {detail}</span>
      )}
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
  quoteBySymbol,
  quoteMode,
  canCancel = false,
  onCancel,
  busy
}: {
  orders: Order[];
  quoteBySymbol: Map<string, MarketDataDecisionSummaryItem>;
  quoteMode: "paper" | "execution";
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
            <th style={th}>報價</th>
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
              <td style={td}>
                <ReadinessBadge item={quoteBySymbol.get(o.symbol) ?? null} mode={quoteMode} />
              </td>
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
