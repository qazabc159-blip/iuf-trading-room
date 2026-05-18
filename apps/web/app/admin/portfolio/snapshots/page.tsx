"use client";

import { useEffect, useState, useCallback } from "react";

const CSS = `
  ._snap-shell {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 960px) {
    ._snap-shell { grid-template-columns: 1fr; }
  }
  ._snap-sidebar {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    overflow: hidden;
    background: rgba(0,0,0,0.2);
  }
  ._snap-sidebar-head {
    padding: 8px 12px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.07);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  ._snap-row {
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    transition: background 0.1s;
  }
  ._snap-row:last-child { border-bottom: none; }
  ._snap-row:hover { background: rgba(255,255,255,0.04); }
  ._snap-row.selected { background: rgba(255,184,0,0.1); border-left: 2px solid #ffb800; }
  ._snap-row-id {
    font-size: 11px;
    font-family: var(--mono, monospace);
    color: #ffb800;
    margin-bottom: 3px;
  }
  ._snap-row-meta {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  ._snap-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
  }
  ._snap-main { display: flex; flex-direction: column; gap: 10px; }
  ._snap-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  ._snap-table th {
    text-align: left;
    padding: 6px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  ._snap-table td {
    padding: 7px 10px;
    color: rgba(255,255,255,0.75);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-family: var(--mono, monospace);
  }
  ._snap-table tr:last-child td { border-bottom: none; }
  ._snap-table tr:hover td { background: rgba(255,255,255,0.02); }
  ._snap-diff-added { color: #4caf50; }
  ._snap-diff-removed { color: #ef5350; }
  ._snap-diff-changed { color: #ffb800; }
  ._snap-toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
  }
  ._snap-toolbar-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }
  ._snap-input {
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    color: rgba(255,255,255,0.8);
    font-family: var(--mono, monospace);
    width: 200px;
  }
  ._snap-btn {
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid rgba(255,184,0,0.3);
    background: rgba(255,184,0,0.1);
    color: #ffb800;
    transition: background 0.1s;
  }
  ._snap-btn:hover { background: rgba(255,184,0,0.2); }
  ._snap-btn:disabled { opacity: 0.5; cursor: default; }
  ._snap-empty {
    padding: 24px;
    text-align: center;
    color: rgba(255,255,255,0.3);
    font-size: 12px;
    line-height: 1.7;
  }
  ._snap-phase-note {
    padding: 10px 14px;
    background: rgba(255,184,0,0.06);
    border: 1px solid rgba(255,184,0,0.2);
    border-radius: 6px;
    font-size: 11px;
    color: rgba(255,184,0,0.8);
    margin-bottom: 10px;
  }
`;

type SnapshotEntry = {
  id: string;
  trigger: string;
  note: string | null;
  positions: Array<{ ticker: string; shares: number; avgCost: number; sector?: string; lastPrice?: number }>;
  parentId: string | null;
  createdAt: string;
};

type DiffEntry = {
  fromSnapshotId: string;
  toSnapshotId: string;
  added: Array<{ ticker: string; shares: number; avgCost: number }>;
  removed: Array<{ ticker: string; shares: number; avgCost: number }>;
  changed: Array<{ ticker: string; fromShares: number; toShares: number; fromAvgCost: number; toAvgCost: number }>;
};

function fmtDT(iso: string) {
  try { return new Date(iso).toLocaleString("zh-TW", { hour12: false }); } catch { return iso; }
}

function triggerBadgeStyle(trigger: string) {
  if (trigger === "strategy_run") return { background: "rgba(33,150,243,0.15)", color: "#42a5f5", border: "1px solid rgba(33,150,243,0.3)" };
  if (trigger === "eod_auto") return { background: "rgba(156,39,176,0.15)", color: "#ce93d8", border: "1px solid rgba(156,39,176,0.3)" };
  if (trigger === "rollback") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" };
  // manual
  return { background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" };
}

async function apiFetch<T>(path: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const res = await fetch(`${base}${path}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json() as { data: T };
  return json.data;
}

export default function PortfolioSnapshotsPage() {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"ok" | "pending" | "error">("ok");

  const [selected, setSelected] = useState<SnapshotEntry | null>(null);
  const [diffFrom, setDiffFrom] = useState("");
  const [diffTo, setDiffTo] = useState("");
  const [diff, setDiff] = useState<DiffEntry | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ snapshots: SnapshotEntry[]; nextCursor: string | null }>("/api/v1/portfolio/snapshots?limit=20")
      .then((d) => {
        if (!cancelled) {
          setSnapshots(d.snapshots ?? []);
          setLoading(false);
          setPhase("ok");
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setLoading(false);
          // 404 or 500 → likely Phase A migration pending
          setPhase(err.message === "404" ? "pending" : "error");
        }
      });
    return () => { cancelled = true; };
  }, []);

  const loadDiff = useCallback(() => {
    if (!diffFrom || !diffTo) return;
    let cancelled = false;
    setDiffLoading(true);
    setDiffError("");
    setDiff(null);
    const qs = new URLSearchParams({ from: diffFrom, to: diffTo }).toString();
    apiFetch<DiffEntry>(`/api/v1/portfolio/snapshots/diff?${qs}`)
      .then((d) => { if (!cancelled) { setDiff(d); setDiffLoading(false); } })
      .catch((err: Error) => { if (!cancelled) { setDiffError(err.message); setDiffLoading(false); } });
    return () => { cancelled = true; };
  }, [diffFrom, diffTo]);

  return (
    <>
      <style>{CSS}</style>
      <main className="page-frame">
        <header className="page-head">
          <div className="page-title">
            <span className="tg page-code">管理</span>
            <h1>Portfolio 快照瀏覽器</h1>
            <span className="tc">Trading-as-Git / Phase A</span>
          </div>
          <div className="tg meta-strip">
            <span>Owner only</span>
            <span>快照即版本控管</span>
          </div>
        </header>
        <div className="terminal-note">
          Trading-as-Git — 每次部位變動建立快照；可查看任意兩版本間的 diff；read-only 瀏覽。
        </div>

        {phase === "pending" && (
          <div className="_snap-phase-note">
            Phase A DB migration (0037) 尚待 apply — 等楊董 14:00 執行 migration 後端點自動可用。PR #645 merged 後 Bruce deploy。
          </div>
        )}

        <div className="_snap-shell">
          {/* Sidebar: snapshot list */}
          <div className="_snap-sidebar">
            <div className="_snap-sidebar-head">
              <span>快照列表</span>
              <span>{snapshots.length} 個</span>
            </div>
            {loading && <div className="_snap-empty">載入中…</div>}
            {!loading && phase !== "ok" && (
              <div className="_snap-empty">
                {phase === "pending" ? "等 DB migration apply" : "資料同步中"}
              </div>
            )}
            {!loading && phase === "ok" && snapshots.length === 0 && (
              <div className="_snap-empty">尚無快照紀錄</div>
            )}
            {snapshots.map((s) => (
              <div
                key={s.id}
                className={`_snap-row${selected?.id === s.id ? " selected" : ""}`}
                onClick={() => setSelected(s)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelected(s)}
              >
                <div className="_snap-row-id">{s.id.slice(0, 12)}…</div>
                <div className="_snap-row-meta">
                  <span className="_snap-badge" style={triggerBadgeStyle(s.trigger)}>{s.trigger}</span>
                  <span>{fmtDT(s.createdAt)}</span>
                </div>
                {s.note && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>{s.note.slice(0, 50)}</div>}
              </div>
            ))}
          </div>

          {/* Main: detail + diff */}
          <div className="_snap-main">
            {/* Selected snapshot detail */}
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="tg panel-code">管理</span>
                  <span className="tg muted"> / </span>
                  <span className="tg gold">
                    {selected ? `快照 ${selected.id.slice(0, 12)}…` : "選擇快照"}
                  </span>
                </div>
                {selected && (
                  <div className="tg soft">
                    <span className="_snap-badge" style={triggerBadgeStyle(selected.trigger)}>{selected.trigger}</span>
                    {" "}{fmtDT(selected.createdAt)}
                  </div>
                )}
              </div>
              {!selected && <div className="_snap-empty">← 請從左側選擇一個快照</div>}
              {selected && (
                <>
                  {selected.parentId && (
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", padding: "4px 10px" }}>
                      parent: {selected.parentId.slice(0, 16)}…
                    </div>
                  )}
                  <table className="_snap-table">
                    <thead>
                      <tr>
                        <th>ticker</th>
                        <th>股數</th>
                        <th>平均成本</th>
                        <th>sector</th>
                        <th>最新價</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.positions.length === 0
                        ? <tr><td colSpan={5} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>此快照無部位</td></tr>
                        : selected.positions.map((p) => (
                          <tr key={p.ticker}>
                            <td style={{ color: "#ffb800" }}>{p.ticker}</td>
                            <td>{p.shares}</td>
                            <td>{p.avgCost}</td>
                            <td>{p.sector ?? "—"}</td>
                            <td>{p.lastPrice ?? "—"}</td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </>
              )}
            </section>

            {/* Diff viewer */}
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="tg panel-code">管理</span>
                  <span className="tg muted"> / </span>
                  <span className="tg gold">版本差異 Diff</span>
                </div>
              </div>
              <div className="_snap-toolbar">
                <span className="_snap-toolbar-lbl">From ID</span>
                <input className="_snap-input" placeholder="快照 ID (from)" value={diffFrom} onChange={(e) => setDiffFrom(e.target.value)} />
                <span className="_snap-toolbar-lbl">→ To ID</span>
                <input className="_snap-input" placeholder="快照 ID (to)" value={diffTo} onChange={(e) => setDiffTo(e.target.value)} />
                <button className="_snap-btn" type="button" disabled={!diffFrom || !diffTo || diffLoading} onClick={loadDiff}>
                  {diffLoading ? "比較中…" : "比較"}
                </button>
              </div>
              {diffError && <div style={{ padding: "8px 12px", fontSize: 11, color: "#ef5350" }}>Diff 失敗：{diffError}</div>}
              {diff && (
                <table className="_snap-table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>變動</th>
                      <th>ticker</th>
                      <th>細節</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.added.map((p) => (
                      <tr key={`add-${p.ticker}`}>
                        <td><span className="_snap-badge _snap-diff-added" style={{ background: "rgba(76,175,80,0.12)", border: "1px solid rgba(76,175,80,0.3)" }}>新增</span></td>
                        <td className="_snap-diff-added">{p.ticker}</td>
                        <td>{p.shares} 股 @ {p.avgCost}</td>
                      </tr>
                    ))}
                    {diff.removed.map((p) => (
                      <tr key={`rm-${p.ticker}`}>
                        <td><span className="_snap-badge _snap-diff-removed" style={{ background: "rgba(239,83,80,0.12)", border: "1px solid rgba(239,83,80,0.3)" }}>移除</span></td>
                        <td className="_snap-diff-removed">{p.ticker}</td>
                        <td>{p.shares} 股 @ {p.avgCost}</td>
                      </tr>
                    ))}
                    {diff.changed.map((p) => (
                      <tr key={`ch-${p.ticker}`}>
                        <td><span className="_snap-badge _snap-diff-changed" style={{ background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.3)" }}>變動</span></td>
                        <td className="_snap-diff-changed">{p.ticker}</td>
                        <td>{p.fromShares}→{p.toShares} 股 / 成本 {p.fromAvgCost}→{p.toAvgCost}</td>
                      </tr>
                    ))}
                    {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && (
                      <tr><td colSpan={3} style={{ color: "rgba(255,255,255,0.3)", textAlign: "center" }}>兩版本無差異</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              {!diff && !diffError && !diffLoading && (
                <div className="_snap-empty">輸入兩個快照 ID 進行版本比較</div>
              )}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
