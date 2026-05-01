import { api } from "@/lib/radar-api";
import type { KillMode } from "@/lib/radar-types";

export const dynamic = "force-dynamic";

const MODES: { mode: KillMode; sub: string; tone: "gold" | "up" | "muted" }[] = [
  { mode: "ARMED", sub: "live order path remains governed by backend risk gates", tone: "gold" },
  { mode: "SAFE", sub: "block new orders, allow trim after backend approval", tone: "muted" },
  { mode: "PEEK", sub: "read-only execution desk", tone: "muted" },
  { mode: "FROZEN", sub: "hard lock all order paths", tone: "up" },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function MobileKillPage() {
  let current: KillMode | null = null;
  let blockedDetail = "Kill-switch write contract is not approved for frontend use.";

  try {
    const session = await api.session();
    current = session.killMode;
  } catch (error) {
    blockedDetail = `Unable to read session kill mode. ${errorText(error)}`;
  }

  return (
    <main>
      <header className="mobile-head">
        <div>
          <div className="tg soft">IUF TR / MOBILE KILL</div>
          <h1>Kill Switch</h1>
        </div>
        <div className="tg session-pill up">BLOCKED</div>
      </header>

      <section className="mobile-section">
        <div className="mobile-section-head">
          <span className="tg gold">CUR / MODE</span>
          <span className="tg soft">READ ONLY</span>
        </div>
        <div style={{ padding: 18, borderBottom: "1px solid var(--night-rule)" }}>
          <div className="tg soft">CURRENT</div>
          <div className="kill-current">{current ?? "UNKNOWN"}</div>
        </div>
        <div style={{ display: "grid", gap: 10, padding: 14 }}>
          {MODES.map((item) => {
            const active = item.mode === current;
            return (
              <button
                key={item.mode}
                disabled
                title="BLOCKED: backend kill-switch write contract is not approved."
                className={`kill-mode ${active ? "active" : ""}`}
              >
                <span>
                  <span className={`tg ${active ? "gold" : item.tone}`}>{item.mode}</span>
                  <span className="tc soft">{item.sub}</span>
                </span>
                <span className="tg soft">{active ? "CURRENT" : "BLOCKED"}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mobile-section">
        <div className="mobile-section-head">
          <span className="tg up">BLOCKED / OWNER</span>
          <span className="tg soft">Jason + Bruce</span>
        </div>
        <div style={{ padding: 18 }}>
          <p className="tc soft" style={{ margin: 0, lineHeight: 1.8 }}>
            This page does not change kill mode. Frontend mock toggles were removed because a fake safety switch is worse than no switch.
          </p>
          <div className="terminal-note" style={{ marginTop: 12 }}>
            BLOCKED: {blockedDetail} Required before enablement: backend governance route, audit log, 4-layer risk regression, and operator approval.
          </div>
        </div>
      </section>
    </main>
  );
}
