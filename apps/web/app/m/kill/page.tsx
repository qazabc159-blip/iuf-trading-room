import { getKillSwitch } from "@/lib/api";

export const dynamic = "force-dynamic";

const ACCOUNT_ID = "paper-default";
const MODES = [
  { mode: "trading", sub: "normal paper routing after backend risk gates", tone: "gold" },
  { mode: "paper_only", sub: "demote strategy logic to paper-only", tone: "muted" },
  { mode: "liquidate_only", sub: "closing orders only after backend approval", tone: "muted" },
  { mode: "halted", sub: "hard block new orders", tone: "up" },
] as const;

type KillState = Awaited<ReturnType<typeof getKillSwitch>>["data"];
type LoadState =
  | { state: "LIVE"; data: KillState | null; updatedAt: string; source: string }
  | { state: "BLOCKED"; data: KillState | null; updatedAt: string; source: string; reason: string };

async function loadKill(): Promise<LoadState> {
  const source = `GET /api/v1/risk/kill-switch?accountId=${ACCOUNT_ID}`;
  const updatedAt = new Date().toISOString();
  try {
    const envelope = await getKillSwitch(ACCOUNT_ID);
    return {
      state: "LIVE",
      data: envelope.data,
      updatedAt: envelope.data.updatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: null,
      updatedAt,
      source,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function stateTone(state: LoadState["state"]) {
  return state === "LIVE" ? "up" : "down";
}

export default async function MobileKillPage() {
  const result = await loadKill();
  const current = result.data?.mode ?? "unknown";

  return (
    <main>
      <header className="mobile-head">
        <div>
          <div className="tg soft">IUF TR / MOBILE KILL</div>
          <h1>Kill Switch</h1>
          <div className="tg soft" style={{ marginTop: 8 }}>{result.source}</div>
        </div>
        <div className={`tg session-pill ${stateTone(result.state)}`}>{result.state}</div>
      </header>

      <section className="mobile-section">
        <div className="mobile-section-head">
          <span className="tg gold">CUR / MODE</span>
          <span className="tg soft">READ ONLY</span>
        </div>
        <div style={{ padding: 18, borderBottom: "1px solid var(--night-rule)" }}>
          <div className="tg soft">CURRENT</div>
          <div className="kill-current">{current.toUpperCase()}</div>
          <div className="tg soft" style={{ marginTop: 8 }}>updated {formatTime(result.updatedAt)}</div>
          {result.data?.reason && <div className="tc soft" style={{ marginTop: 8 }}>{result.data.reason}</div>}
        </div>
        <div style={{ display: "grid", gap: 10, padding: 14 }}>
          {MODES.map((item) => {
            const active = item.mode === current;
            return (
              <button
                key={item.mode}
                disabled
                title="BLOCKED: frontend kill-switch writes are disabled until backend governance, audit, and risk regression are approved."
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
            This page reads the real kill-switch state but does not change it.
          </p>
          <div className="terminal-note" style={{ marginTop: 12 }}>
            BLOCKED: {result.state === "BLOCKED" ? result.reason : "write path requires backend governance route, audit log, 4-layer risk regression, and operator approval."}
          </div>
        </div>
      </section>
    </main>
  );
}
