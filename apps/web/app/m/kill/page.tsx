"use client";

import { useState } from "react";
import { api } from "@/lib/radar-api";
import type { KillMode } from "@/lib/radar-types";

const MODES: { mode: KillMode; sub: string; tone: "gold" | "up" | "muted" }[] = [
  { mode: "ARMED", sub: "live orders allowed", tone: "gold" },
  { mode: "SAFE", sub: "block new orders, allow trim", tone: "muted" },
  { mode: "PEEK", sub: "read-only execution desk", tone: "muted" },
  { mode: "FROZEN", sub: "hard lock all order paths", tone: "up" },
];

export default function MobileKillPage() {
  const [current, setCurrent] = useState<KillMode>("ARMED");
  const [target, setTarget] = useState<KillMode | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!target) return;
    setPending(true);
    try {
      await api.killMode(target);
      setCurrent(target);
      setTarget(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <header className="mobile-head">
        <div>
          <div className="tg soft">IUF TR / MOBILE KILL</div>
          <h1>Kill Switch</h1>
        </div>
        <div className="tg session-pill up">EXEC LAYER</div>
      </header>

      <section className="mobile-section">
        <div className="mobile-section-head">
          <span className="tg gold">CUR / MODE</span>
          <span className="tg soft">TAP TO ARM STATE</span>
        </div>
        <div style={{ padding: 18, borderBottom: "1px solid var(--night-rule)" }}>
          <div className="tg soft">CURRENT</div>
          <div className="kill-current">{current}</div>
        </div>
        <div style={{ display: "grid", gap: 10, padding: 14 }}>
          {MODES.map((item) => {
            const active = item.mode === current;
            return (
              <button
                key={item.mode}
                disabled={active}
                onClick={() => setTarget(item.mode)}
                className={`kill-mode ${active ? "active" : ""}`}
              >
                <span>
                  <span className={`tg ${active ? "gold" : item.tone}`}>{item.mode}</span>
                  <span className="tc soft">{item.sub}</span>
                </span>
                <span className="tg soft">{active ? "CURRENT" : "SET"}</span>
              </button>
            );
          })}
        </div>
      </section>

      {target && (
        <div className="confirm-sheet" onClick={() => !pending && setTarget(null)}>
          <div className="confirm-panel" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-section-head">
              <span className="tg up">CONFIRM / MODE CHANGE</span>
              <span className="tg soft">NO BACKEND IN MOCK</span>
            </div>
            <div style={{ padding: 18 }}>
              <div className="tg soft">TRANSITION</div>
              <div className="kill-transition">
                <span>{current}</span>
                <span className="soft">-&gt;</span>
                <span className="up">{target}</span>
              </div>
              <p className="tc soft" style={{ marginTop: 12 }}>
                This action changes the visible execution safety mode for the mobile desk.
              </p>
            </div>
            <div className="confirm-actions">
              <button onClick={() => setTarget(null)} disabled={pending}>CANCEL</button>
              <button onClick={confirm} disabled={pending}>{pending ? "APPLYING" : "CONFIRM"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
