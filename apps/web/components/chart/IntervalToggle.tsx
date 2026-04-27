"use client";
/**
 * IntervalToggle — K-line interval selector (W3 §1.1)
 * Ported from sandbox v0.7.0-w3
 * SegControl style: 2px gold bottom-line, no outer container border
 */

export type KLineInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "D" | "W" | "M";

const INTERVALS: KLineInterval[] = ["1m", "5m", "15m", "1h", "4h", "D", "W", "M"];

interface IntervalToggleProps {
  value: KLineInterval;
  onChange: (v: KLineInterval) => void;
}

export function IntervalToggle({ value, onChange }: IntervalToggleProps) {
  return (
    <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
      {INTERVALS.map((iv) => {
        const active = iv === value;
        return (
          <button
            key={iv}
            onClick={() => onChange(iv)}
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
              padding: "6px 10px",
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
            {iv}
          </button>
        );
      })}
    </div>
  );
}
