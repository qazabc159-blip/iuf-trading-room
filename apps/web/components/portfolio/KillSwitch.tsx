"use client";

export type KillMode = "ARMED" | "SAFE" | "PEEK" | "FROZEN";

const MODES: { mode: KillMode; label: string; sub: string; tone: "ok" | "warn" | "block" | "danger" }[] = [
  { mode: "ARMED", label: "可交易", sub: "後端風控與模擬交易閘門共同判斷委託資格", tone: "ok" },
  { mode: "SAFE", label: "只減倉", sub: "僅保留降低曝險的操作，避免新增風險", tone: "warn" },
  { mode: "PEEK", label: "唯讀", sub: "只檢視部位、委託與風控狀態", tone: "block" },
  { mode: "FROZEN", label: "凍結", sub: "缺少可信風控狀態時，前端一律保守鎖住", tone: "danger" },
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
        aria-label="交易模式唯讀狀態"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
          border: "1px solid var(--exec-rule-strong)",
        }}
      >
        {MODES.map((m, i) => {
          const on = m.mode === mode;
          return (
            <div
              key={m.mode}
              role="radio"
              aria-checked={on}
              title="目前僅顯示狀態；切換交易模式需要後端治理、稽核紀錄與風控回歸測試通過。"
              style={{
                minWidth: 0,
                padding: "clamp(14px, 4vw, 18px)",
                background: on ? "rgba(184,138,62,0.18)" : "transparent",
                color: on ? "var(--gold-bright)" : "var(--exec-ink)",
                borderLeft: i === 0 ? "none" : "1px solid var(--exec-rule)",
                borderTop: on ? "2px solid var(--gold)" : "2px solid transparent",
                fontFamily: "var(--sans-tc)",
                letterSpacing: 0,
                textAlign: "left",
                opacity: on ? 1 : 0.7,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 8px" }}>
                <span style={{ color: toneColor(m.tone), fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>{m.label}</span>
                <span style={{ color: on ? "var(--gold)" : "var(--exec-soft)", fontSize: 10, whiteSpace: "nowrap" }}>
                  {on ? "目前" : "未啟用"}
                </span>
              </div>
              <div style={{ fontFamily: "var(--sans-tc)", fontSize: 12.5, color: "var(--exec-mid)", marginTop: 8, lineHeight: 1.7, letterSpacing: 0 }}>
                {m.sub}
              </div>
            </div>
          );
        })}
      </div>
      <div className="terminal-note" style={{ marginTop: 12 }}>
        交易模式目前由後端控管，前端只顯示狀態；正式切換需完成治理路由、稽核紀錄與四層風控驗證。
      </div>
    </>
  );
}
