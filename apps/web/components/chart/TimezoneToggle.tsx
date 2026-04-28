"use client";
/**
 * TimezoneToggle — Timezone selector for K-line chart (W3 C-δ)
 * Ported from sandbox v0.7.0-w3
 * Fires window CustomEvent "iuf:timezone" for CommandPalette → StockDetailPanel decoupled dispatch
 */

export type ChartTimezone = "Asia/Taipei" | "UTC" | "America/New_York";

const TZ_OPTIONS: { label: string; value: ChartTimezone }[] = [
  { label: "TST", value: "Asia/Taipei" },
  { label: "UTC", value: "UTC" },
  { label: "ET",  value: "America/New_York" },
];

interface TimezoneToggleProps {
  value: ChartTimezone;
  onChange: (v: ChartTimezone) => void;
}

export function TimezoneToggle({ value, onChange }: TimezoneToggleProps) {
  return (
    <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
      {TZ_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              background: "none",
              border: "none",
              borderBottom: active
                ? "2px solid var(--gold)"
                : "2px solid transparent",
              color: active ? "var(--night-ink)" : "var(--night-mid)",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: active ? 700 : 400,
              letterSpacing: "0.12em",
              padding: "6px 8px",
              cursor: "pointer",
              transition: "color 100ms ease-out, border-color 100ms ease-out",
            }}
            onMouseEnter={(e) => {
              if (!active) {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--night-ink)";
                (e.currentTarget as HTMLButtonElement).style.borderBottomColor = "var(--night-rule-strong)";
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--night-mid)";
                (e.currentTarget as HTMLButtonElement).style.borderBottomColor = "transparent";
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
