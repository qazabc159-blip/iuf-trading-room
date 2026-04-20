"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  StrategyRiskLimit,
  StrategyRiskLimitUpsertInput,
  SymbolRiskLimit,
  SymbolRiskLimitUpsertInput
} from "@iuf-trading-room/contracts";

import {
  deleteStrategyRiskLimit,
  deleteSymbolRiskLimit,
  listStrategyRiskLimits,
  listSymbolRiskLimits,
  upsertStrategyRiskLimit,
  upsertSymbolRiskLimit
} from "@/lib/api";

type Props = {
  accountId: string;
};

// Minimal layer-overrides panel: lets the trader see, add, edit, and delete
// strategy- and symbol-level caps on top of the account-layer defaults.
// Each row is one override entry; a null field means "inherit". We don't
// render a giant form here — just the fields that actually override, so a
// clean entry looks like "maxPerTradePct=0.5%" rather than a wall of null.

export function RiskLayerOverrides({ accountId }: Props) {
  const [strategies, setStrategies] = useState<StrategyRiskLimit[]>([]);
  const [symbols, setSymbols] = useState<SymbolRiskLimit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, y] = await Promise.all([
        listStrategyRiskLimits(accountId),
        listSymbolRiskLimits(accountId)
      ]);
      setStrategies(s.data);
      setSymbols(y.data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [accountId]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const onUpsertStrategy = useCallback(
    async (payload: StrategyRiskLimitUpsertInput) => {
      setPending(true);
      try {
        await upsertStrategyRiskLimit(payload);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setPending(false);
      }
    },
    [refresh]
  );

  const onDeleteStrategy = useCallback(
    async (strategyId: string) => {
      setPending(true);
      try {
        await deleteStrategyRiskLimit({ accountId, strategyId });
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setPending(false);
      }
    },
    [accountId, refresh]
  );

  const onUpsertSymbol = useCallback(
    async (payload: SymbolRiskLimitUpsertInput) => {
      setPending(true);
      try {
        await upsertSymbolRiskLimit(payload);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setPending(false);
      }
    },
    [refresh]
  );

  const onDeleteSymbol = useCallback(
    async (symbol: string) => {
      setPending(true);
      try {
        await deleteSymbolRiskLimit({ accountId, symbol });
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setPending(false);
      }
    },
    [accountId, refresh]
  );

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {error && (
        <p
          style={{
            color: "var(--amber)",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.8rem"
          }}
        >
          [ERR] {error}
        </p>
      )}

      <StrategySection
        accountId={accountId}
        rows={strategies}
        pending={pending}
        onUpsert={onUpsertStrategy}
        onDelete={onDeleteStrategy}
      />

      <SymbolSection
        accountId={accountId}
        rows={symbols}
        pending={pending}
        onUpsert={onUpsertSymbol}
        onDelete={onDeleteSymbol}
      />

      <p
        style={{
          color: "var(--dim)",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.72rem"
        }}
      >
        ← STRAT / ← SYM 標籤代表該欄位由 strategy / symbol 層覆寫 account 層；欄位空白代表繼承下一層。
      </p>
    </div>
  );
}

// ── Strategy section ──────────────────────────────────────────────────

function StrategySection({
  accountId,
  rows,
  pending,
  onUpsert,
  onDelete
}: {
  accountId: string;
  rows: StrategyRiskLimit[];
  pending: boolean;
  onUpsert: (input: StrategyRiskLimitUpsertInput) => Promise<void>;
  onDelete: (strategyId: string) => Promise<void>;
}) {
  return (
    <div>
      <div
        style={{
          color: "var(--dim)",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.8rem",
          marginBottom: "0.5rem",
          display: "flex",
          justifyContent: "space-between"
        }}
      >
        <span>[STRATEGY LAYER · 共 {rows.length} 筆]</span>
        <span style={{ color: "var(--dim)", fontSize: "0.7rem" }}>
          enabled = 是否套用 · 空值 = 繼承 account 層
        </span>
      </div>

      {rows.length === 0 ? (
        <p
          style={{
            color: "var(--dim)",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.8rem"
          }}
        >
          [EMPTY] 尚無 strategy 層覆寫。
        </p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.78rem"
          }}
        >
          <thead>
            <tr style={{ color: "var(--dim)", textAlign: "left" }}>
              <th style={th}>strategyId</th>
              <th style={thRight}>perTrade%</th>
              <th style={thRight}>single%</th>
              <th style={thRight}>theme%</th>
              <th style={thRight}>gross%</th>
              <th style={thRight}>openOrd</th>
              <th style={thRight}>ord/min</th>
              <th style={th}>enabled</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                style={{ borderTop: "1px solid var(--line, #2a2a2a)" }}
              >
                <td style={td}>{row.strategyId}</td>
                <td style={tdRight}>{fmtNum(row.maxPerTradePct)}</td>
                <td style={tdRight}>{fmtNum(row.maxSinglePositionPct)}</td>
                <td style={tdRight}>{fmtNum(row.maxThemeCorrelatedPct)}</td>
                <td style={tdRight}>{fmtNum(row.maxGrossExposurePct)}</td>
                <td style={tdRight}>{fmtNum(row.maxOpenOrders)}</td>
                <td style={tdRight}>{fmtNum(row.maxOrdersPerMinute)}</td>
                <td
                  style={{
                    ...td,
                    color: row.enabled ? "var(--phosphor)" : "var(--dim)"
                  }}
                >
                  {row.enabled ? "ON" : "OFF"}
                </td>
                <td style={td}>
                  <button
                    disabled={pending}
                    onClick={() => onDelete(row.strategyId)}
                    style={ghostButtonStyle("var(--amber)", pending)}
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <StrategyAddForm accountId={accountId} pending={pending} onUpsert={onUpsert} />
    </div>
  );
}

function StrategyAddForm({
  accountId,
  pending,
  onUpsert
}: {
  accountId: string;
  pending: boolean;
  onUpsert: (input: StrategyRiskLimitUpsertInput) => Promise<void>;
}) {
  const [strategyId, setStrategyId] = useState("");
  const [maxPerTradePct, setMaxPerTradePct] = useState("");
  const [maxSinglePositionPct, setMaxSinglePositionPct] = useState("");
  const [enabled, setEnabled] = useState(true);

  const onSubmit = async () => {
    if (!strategyId.trim()) return;
    const payload: StrategyRiskLimitUpsertInput = {
      accountId,
      strategyId: strategyId.trim(),
      enabled,
      maxPerTradePct: maxPerTradePct === "" ? null : Number(maxPerTradePct),
      maxSinglePositionPct:
        maxSinglePositionPct === "" ? null : Number(maxSinglePositionPct)
    };
    await onUpsert(payload);
    setStrategyId("");
    setMaxPerTradePct("");
    setMaxSinglePositionPct("");
    setEnabled(true);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr 1fr auto auto",
        gap: "0.4rem",
        marginTop: "0.5rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.78rem",
        alignItems: "end"
      }}
    >
      <LabeledInput
        label="strategyId"
        value={strategyId}
        onChange={setStrategyId}
        placeholder="breakout_v1"
      />
      <LabeledInput
        label="perTrade%"
        value={maxPerTradePct}
        onChange={setMaxPerTradePct}
        placeholder="0.5"
      />
      <LabeledInput
        label="single%"
        value={maxSinglePositionPct}
        onChange={setMaxSinglePositionPct}
        placeholder="10"
      />
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",
          color: "var(--dim)"
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        enabled
      </label>
      <button
        disabled={pending || !strategyId.trim()}
        onClick={onSubmit}
        style={ghostButtonStyle("var(--phosphor)", pending || !strategyId.trim())}
      >
        [ADD / UPSERT]
      </button>
    </div>
  );
}

// ── Symbol section ────────────────────────────────────────────────────

function SymbolSection({
  accountId,
  rows,
  pending,
  onUpsert,
  onDelete
}: {
  accountId: string;
  rows: SymbolRiskLimit[];
  pending: boolean;
  onUpsert: (input: SymbolRiskLimitUpsertInput) => Promise<void>;
  onDelete: (symbol: string) => Promise<void>;
}) {
  return (
    <div>
      <div
        style={{
          color: "var(--dim)",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.8rem",
          marginBottom: "0.5rem",
          display: "flex",
          justifyContent: "space-between"
        }}
      >
        <span>[SYMBOL LAYER · 共 {rows.length} 筆]</span>
        <span style={{ color: "var(--dim)", fontSize: "0.7rem" }}>
          最小集合：只覆寫單筆與單一標的上限
        </span>
      </div>

      {rows.length === 0 ? (
        <p
          style={{
            color: "var(--dim)",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.8rem"
          }}
        >
          [EMPTY] 尚無 symbol 層覆寫。
        </p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.78rem"
          }}
        >
          <thead>
            <tr style={{ color: "var(--dim)", textAlign: "left" }}>
              <th style={th}>symbol</th>
              <th style={thRight}>perTrade%</th>
              <th style={thRight}>single%</th>
              <th style={th}>enabled</th>
              <th style={th}>notes</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                style={{ borderTop: "1px solid var(--line, #2a2a2a)" }}
              >
                <td style={td}>{row.symbol}</td>
                <td style={tdRight}>{fmtNum(row.maxPerTradePct)}</td>
                <td style={tdRight}>{fmtNum(row.maxSinglePositionPct)}</td>
                <td
                  style={{
                    ...td,
                    color: row.enabled ? "var(--phosphor)" : "var(--dim)"
                  }}
                >
                  {row.enabled ? "ON" : "OFF"}
                </td>
                <td style={{ ...td, color: "var(--dim)" }}>{row.notes || "—"}</td>
                <td style={td}>
                  <button
                    disabled={pending}
                    onClick={() => onDelete(row.symbol)}
                    style={ghostButtonStyle("var(--amber)", pending)}
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <SymbolAddForm accountId={accountId} pending={pending} onUpsert={onUpsert} />
    </div>
  );
}

function SymbolAddForm({
  accountId,
  pending,
  onUpsert
}: {
  accountId: string;
  pending: boolean;
  onUpsert: (input: SymbolRiskLimitUpsertInput) => Promise<void>;
}) {
  const [symbol, setSymbol] = useState("");
  const [maxPerTradePct, setMaxPerTradePct] = useState("");
  const [maxSinglePositionPct, setMaxSinglePositionPct] = useState("");
  const [enabled, setEnabled] = useState(true);

  const onSubmit = async () => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    const payload: SymbolRiskLimitUpsertInput = {
      accountId,
      symbol: normalized,
      enabled,
      maxPerTradePct: maxPerTradePct === "" ? null : Number(maxPerTradePct),
      maxSinglePositionPct:
        maxSinglePositionPct === "" ? null : Number(maxSinglePositionPct)
    };
    await onUpsert(payload);
    setSymbol("");
    setMaxPerTradePct("");
    setMaxSinglePositionPct("");
    setEnabled(true);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr auto auto",
        gap: "0.4rem",
        marginTop: "0.5rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.78rem",
        alignItems: "end"
      }}
    >
      <LabeledInput
        label="symbol"
        value={symbol}
        onChange={setSymbol}
        placeholder="2330"
      />
      <LabeledInput
        label="perTrade%"
        value={maxPerTradePct}
        onChange={setMaxPerTradePct}
        placeholder="0.3"
      />
      <LabeledInput
        label="single%"
        value={maxSinglePositionPct}
        onChange={setMaxSinglePositionPct}
        placeholder="5"
      />
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",
          color: "var(--dim)"
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        enabled
      </label>
      <button
        disabled={pending || !symbol.trim()}
        onClick={onSubmit}
        style={ghostButtonStyle("var(--phosphor)", pending || !symbol.trim())}
      >
        [ADD / UPSERT]
      </button>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "grid", gap: "0.2rem" }}>
      <span style={{ color: "var(--dim)", fontSize: "0.7rem" }}>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "transparent",
          color: "var(--phosphor)",
          border: "1px solid var(--line, #2a2a2a)",
          padding: "0.3rem 0.5rem",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.78rem"
        }}
      />
    </label>
  );
}

function fmtNum(v: number | null): string {
  return v === null ? "—" : String(v);
}

const th: React.CSSProperties = { padding: "0.3rem 0.5rem", fontWeight: "normal" };
const thRight: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "0.3rem 0.5rem" };
const tdRight: React.CSSProperties = { ...td, textAlign: "right" };

const ghostButtonStyle = (color: string, dim: boolean): React.CSSProperties => ({
  background: "transparent",
  color,
  border: `1px solid ${color}`,
  padding: "0.25rem 0.6rem",
  fontFamily: "var(--mono, monospace)",
  fontSize: "0.72rem",
  cursor: dim ? "default" : "pointer",
  opacity: dim ? 0.45 : 1,
  letterSpacing: "0.04em"
});
