"use client";

export type KillMode = "ARMED" | "SAFE" | "PEEK" | "FROZEN";

const MODES: { mode: KillMode; label: string; sub: string; tone: "ok" | "warn" | "block" | "danger" }[] = [
  { mode: "ARMED", label: "ARMED", sub: "backend risk gates decide order eligibility", tone: "ok" },
  { mode: "SAFE", label: "SAFE", sub: "write path blocked until governance route is approved", tone: "warn" },
  { mode: "PEEK", label: "PEEK", sub: "read-only execution desk", tone: "block" },
  { mode: "FROZEN", label: "FROZEN", sub: "requires audited backend kill-switch state", tone: "danger" },
];

function toneColor(t: "ok" | "warn" | "block" | "danger") {
  return t === "ok" ? "var(--gold-bright)"
       : t === "warn" ? "var(--gold)"
       : t === "block" ? "var(--exec-mid)"
       : "var(--tw-up-bright)";
}

export function KillSwitch({ mode }: { mode: KillMode; onChange?: (m: KillMode) => void }) {
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Kill mode read-only"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          border: "1px solid var(--exec-rule-strong)",
        }}
      >
        {MODES.map((m, i) => {
          const on = m.mode === mode;
          return (
            <button
              key={m.mode}
              role="radio"
              aria-checked={on}
              disabled
              title="BLOCKED: frontend kill-switch writes are disabled until backend governance, audit, and risk regression are approved."
              style={{
                padding: "14px 12px",
                background: on ? "rgba(184,138,62,0.18)" : "transparent",
                color: on ? "var(--gold-bright)" : "var(--exec-ink)",
                borderLeft: i === 0 ? "none" : "1px solid var(--exec-rule)",
                borderTop: on ? "2px solid var(--gold)" : "2px solid transparent",
                cursor: "not-allowed",
                fontFamily: "var(--mono)",
                letterSpacing: "0.18em",
                textAlign: "left",
                opacity: on ? 1 : 0.7,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: toneColor(m.tone), fontSize: 12, fontWeight: 700 }}>{m.label}</span>
                <span style={{ color: on ? "var(--gold)" : "var(--exec-soft)", fontSize: 9.5 }}>
                  {on ? "CURRENT" : "BLOCKED"}
                </span>
              </div>
              <div style={{ fontFamily: "var(--serif-tc)", fontSize: 12.5, color: "var(--exec-mid)", marginTop: 4, letterSpacing: 0 }}>
                {m.sub}
              </div>
            </button>
          );
        })}
      </div>
      <div className="terminal-note" style={{ marginTop: 12 }}>
        BLOCKED: kill-switch writes are intentionally unavailable in the frontend. Owner: Jason + Bruce. Required:
        backend governance route, audit log, 4-layer risk regression, and operator approval.
      </div>
    </>
  );
}
