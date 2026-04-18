"use client";

import { useEffect, useState } from "react";

import type { RiskLimit } from "@iuf-trading-room/contracts";

import { upsertRiskLimit } from "@/lib/api";

type Props = {
  accountId: string;
  current: RiskLimit | null;
  onSaved: (limit: RiskLimit) => void;
};

// All numeric/text fields surface as strings while editing so users can clear
// a value without instantly tripping zod validation; we coerce on submit.
type FormState = {
  maxPerTradePct: string;
  maxDailyLossPct: string;
  maxSinglePositionPct: string;
  maxThemeCorrelatedPct: string;
  maxGrossExposurePct: string;
  maxOpenOrders: string;
  maxOrdersPerMinute: string;
  staleQuoteMs: string;
  tradingHoursStart: string;
  tradingHoursEnd: string;
  symbolWhitelist: string; // comma-separated
  symbolBlacklist: string; // comma-separated
  whitelistOnly: boolean;
};

function fromLimit(limit: RiskLimit | null): FormState {
  return {
    maxPerTradePct: String(limit?.maxPerTradePct ?? ""),
    maxDailyLossPct: String(limit?.maxDailyLossPct ?? ""),
    maxSinglePositionPct: String(limit?.maxSinglePositionPct ?? ""),
    maxThemeCorrelatedPct: String(limit?.maxThemeCorrelatedPct ?? ""),
    maxGrossExposurePct: String(limit?.maxGrossExposurePct ?? ""),
    maxOpenOrders: String(limit?.maxOpenOrders ?? ""),
    maxOrdersPerMinute: String(limit?.maxOrdersPerMinute ?? ""),
    staleQuoteMs: String(limit?.staleQuoteMs ?? ""),
    tradingHoursStart: limit?.tradingHoursStart ?? "09:00",
    tradingHoursEnd: limit?.tradingHoursEnd ?? "13:30",
    symbolWhitelist: (limit?.symbolWhitelist ?? []).join(", "),
    symbolBlacklist: (limit?.symbolBlacklist ?? []).join(", "),
    whitelistOnly: limit?.whitelistOnly ?? false
  };
}

function parseList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

function parseNumber(raw: string, label: string): number | string {
  if (raw === "") return `${label}：必填`;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return `${label}：需為 ≥0 的數字`;
  return n;
}

function parseInt32(raw: string, label: string): number | string {
  const v = parseNumber(raw, label);
  if (typeof v === "string") return v;
  if (!Number.isInteger(v) || v <= 0) return `${label}：需為正整數`;
  return v;
}

export function RiskLimitsConfig({ accountId, current, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => fromLimit(current));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Re-seed when the upstream limit changes (account switch, refresh).
  useEffect(() => {
    setForm(fromLimit(current));
    setSavedAt(null);
  }, [current]);

  const onChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onReset = () => {
    setForm(fromLimit(current));
    setError(null);
  };

  const onSave = async () => {
    setError(null);
    const numericFields: Array<[keyof FormState, string, "float" | "int"]> = [
      ["maxPerTradePct", "單筆風險上限", "float"],
      ["maxDailyLossPct", "單日最大損失", "float"],
      ["maxSinglePositionPct", "單一標的部位", "float"],
      ["maxThemeCorrelatedPct", "同主題相關曝險", "float"],
      ["maxGrossExposurePct", "總曝險上限", "float"],
      ["maxOpenOrders", "最大未結委託", "int"],
      ["maxOrdersPerMinute", "每分鐘委託數", "int"],
      ["staleQuoteMs", "報價過期 ms", "int"]
    ];

    const parsed: Record<string, number> = {};
    for (const [key, label, kind] of numericFields) {
      const raw = String(form[key]);
      const v = kind === "int" ? parseInt32(raw, label) : parseNumber(raw, label);
      if (typeof v === "string") {
        setError(v);
        return;
      }
      parsed[key] = v;
    }

    if (!/^\d{2}:\d{2}$/.test(form.tradingHoursStart) || !/^\d{2}:\d{2}$/.test(form.tradingHoursEnd)) {
      setError("交易時段需為 HH:MM 格式");
      return;
    }

    setPending(true);
    try {
      const res = await upsertRiskLimit({
        accountId,
        maxPerTradePct: parsed.maxPerTradePct,
        maxDailyLossPct: parsed.maxDailyLossPct,
        maxSinglePositionPct: parsed.maxSinglePositionPct,
        maxThemeCorrelatedPct: parsed.maxThemeCorrelatedPct,
        maxGrossExposurePct: parsed.maxGrossExposurePct,
        maxOpenOrders: parsed.maxOpenOrders,
        maxOrdersPerMinute: parsed.maxOrdersPerMinute,
        staleQuoteMs: parsed.staleQuoteMs,
        tradingHoursStart: form.tradingHoursStart,
        tradingHoursEnd: form.tradingHoursEnd,
        symbolWhitelist: parseList(form.symbolWhitelist),
        symbolBlacklist: parseList(form.symbolBlacklist),
        whitelistOnly: form.whitelistOnly
      });
      onSaved(res.data);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(fromLimit(current));

  return (
    <div style={{ display: "grid", gap: "0.85rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "0.75rem"
        }}
      >
        <NumField
          label="單筆風險上限 %"
          value={form.maxPerTradePct}
          onChange={(v) => onChange("maxPerTradePct", v)}
        />
        <NumField
          label="單日最大損失 %"
          value={form.maxDailyLossPct}
          onChange={(v) => onChange("maxDailyLossPct", v)}
          accent="amber"
        />
        <NumField
          label="單一標的部位 %"
          value={form.maxSinglePositionPct}
          onChange={(v) => onChange("maxSinglePositionPct", v)}
        />
        <NumField
          label="同主題曝險 %"
          value={form.maxThemeCorrelatedPct}
          onChange={(v) => onChange("maxThemeCorrelatedPct", v)}
        />
        <NumField
          label="總曝險上限 %"
          value={form.maxGrossExposurePct}
          onChange={(v) => onChange("maxGrossExposurePct", v)}
        />
        <NumField
          label="最大未結委託"
          value={form.maxOpenOrders}
          onChange={(v) => onChange("maxOpenOrders", v)}
        />
        <NumField
          label="每分鐘委託數"
          value={form.maxOrdersPerMinute}
          onChange={(v) => onChange("maxOrdersPerMinute", v)}
        />
        <NumField
          label="報價過期 ms"
          value={form.staleQuoteMs}
          onChange={(v) => onChange("staleQuoteMs", v)}
        />
        <TextField
          label="交易開始 HH:MM"
          value={form.tradingHoursStart}
          onChange={(v) => onChange("tradingHoursStart", v)}
        />
        <TextField
          label="交易結束 HH:MM"
          value={form.tradingHoursEnd}
          onChange={(v) => onChange("tradingHoursEnd", v)}
        />
      </div>

      <TextField
        label="白名單（逗號分隔）"
        value={form.symbolWhitelist}
        onChange={(v) => onChange("symbolWhitelist", v)}
        placeholder="2330, 2454, 2412"
      />
      <TextField
        label="黑名單（逗號分隔）"
        value={form.symbolBlacklist}
        onChange={(v) => onChange("symbolBlacklist", v)}
        placeholder="0050"
      />

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.85rem"
        }}
      >
        <input
          type="checkbox"
          checked={form.whitelistOnly}
          onChange={(e) => onChange("whitelistOnly", e.target.checked)}
        />
        <span>強制白名單模式（whitelistOnly）</span>
      </label>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={onSave}
          disabled={pending || !dirty}
          style={btnStyle("var(--phosphor)", !dirty || pending)}
        >
          {pending ? "[…]" : "[APPLY 儲存]"}
        </button>
        <button
          onClick={onReset}
          disabled={pending || !dirty}
          style={btnStyle("var(--amber)", !dirty || pending)}
        >
          [RESET]
        </button>
        {savedAt && !dirty && (
          <span
            style={{
              fontFamily: "var(--mono, monospace)",
              color: "var(--phosphor)",
              fontSize: "0.8rem"
            }}
          >
            ✓ 已套用 {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
        {dirty && (
          <span style={{ fontFamily: "var(--mono, monospace)", color: "var(--amber)", fontSize: "0.8rem" }}>
            ● 未儲存
          </span>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--amber)", fontFamily: "var(--mono, monospace)", fontSize: "0.85rem" }}>
          [ERR] {error}
        </p>
      )}

      <p style={{ color: "var(--dim)", fontFamily: "var(--mono, monospace)", fontSize: "0.75rem" }}>
        4 層配置（account / strategy / symbol / session）目前僅編輯 account 層；strategy / symbol / session 套用尚未開放。
      </p>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  accent
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accent?: "amber";
}) {
  return (
    <label
      style={{
        display: "grid",
        gap: "0.25rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.78rem"
      }}
    >
      <span style={{ color: accent === "amber" ? "var(--amber)" : "var(--dim)" }}>{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

function TextField({
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
    <label
      style={{
        display: "grid",
        gap: "0.25rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.78rem"
      }}
    >
      <span style={{ color: "var(--dim)" }}>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--phosphor)",
  border: "1px solid var(--line, #2a2a2a)",
  padding: "0.4rem 0.5rem",
  fontFamily: "var(--mono, monospace)",
  fontSize: "0.85rem"
};

const btnStyle = (color: string, dim: boolean): React.CSSProperties => ({
  padding: "0.4rem 0.85rem",
  background: "transparent",
  color,
  border: `1px solid ${color}`,
  borderRadius: 2,
  cursor: dim ? "default" : "pointer",
  opacity: dim ? 0.45 : 1,
  fontFamily: "var(--mono, monospace)",
  fontSize: "0.85rem",
  letterSpacing: "0.05em"
});
