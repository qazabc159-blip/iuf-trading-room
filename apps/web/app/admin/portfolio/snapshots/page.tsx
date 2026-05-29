"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PORTFOLIO_SNAPSHOT_DIFF_ENDPOINT,
  portfolioSnapshotStateCopy,
  type PortfolioSnapshotPhase,
} from "@/lib/portfolio-snapshot-state";

const CSS = `
  ._snap-shell {
    display: grid;
    grid-template-columns: 280px 1fr;
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
    color: rgba(255,255,255,0.48);
    border-bottom: 1px solid rgba(255,255,255,0.07);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  ._snap-row {
    padding: 9px 12px;
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
    margin-bottom: 4px;
  }
  ._snap-row-meta {
    font-size: 10px;
    color: rgba(255,255,255,0.46);
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  ._snap-row-note {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    margin-top: 4px;
    line-height: 1.45;
  }
  ._snap-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  ._snap-main { display: flex; flex-direction: column; gap: 10px; }
  ._snap-table-wrap { overflow-x: auto; }
  ._snap-table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
    font-size: 11px;
  }
  ._snap-table th {
    text-align: left;
    padding: 7px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.45);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  ._snap-table td {
    padding: 8px 10px;
    color: rgba(255,255,255,0.76);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-family: var(--mono, monospace);
    vertical-align: top;
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
    color: rgba(255,255,255,0.45);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }
  ._snap-input {
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 11px;
    color: rgba(255,255,255,0.82);
    font-family: var(--mono, monospace);
    width: min(260px, 100%);
  }
  ._snap-btn {
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
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
    color: rgba(255,255,255,0.42);
    font-size: 12px;
    line-height: 1.8;
  }
  ._snap-state-note {
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.7;
    margin-bottom: 10px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.035);
  }
  ._snap-state-note.live {
    border-color: rgba(76,175,80,0.28);
    background: rgba(76,175,80,0.08);
  }
  ._snap-state-note.empty,
  ._snap-state-note.loading {
    border-color: rgba(255,184,0,0.24);
    background: rgba(255,184,0,0.06);
  }
  ._snap-state-note.blocked {
    border-color: rgba(239,83,80,0.32);
    background: rgba(239,83,80,0.08);
  }
  ._snap-state-note strong {
    display: block;
    color: #ffb800;
    margin-bottom: 4px;
  }
  ._snap-state-note dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 10px;
    margin: 8px 0 0;
  }
  ._snap-state-note dt {
    color: rgba(255,255,255,0.42);
  }
  ._snap-state-note dd {
    margin: 0;
    color: rgba(255,255,255,0.72);
  }
  ._snap-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }
  @media (max-width: 960px) {
    ._snap-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  ._snap-card {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.035);
  }
  ._snap-card-label {
    color: rgba(255,255,255,0.45);
    font-size: 10px;
    margin-bottom: 4px;
  }
  ._snap-card-value {
    color: rgba(255,255,255,0.9);
    font-size: 18px;
    font-weight: 800;
    font-family: var(--mono, monospace);
  }
  ._snap-card-sub {
    color: rgba(255,255,255,0.48);
    font-size: 10px;
    margin-top: 4px;
    line-height: 1.45;
  }
  ._snap-truth-box {
    padding: 10px 12px;
    border: 1px solid rgba(255,184,0,0.22);
    background: rgba(255,184,0,0.06);
    border-radius: 6px;
    font-size: 11px;
    color: rgba(255,255,255,0.72);
    line-height: 1.7;
  }
  ._snap-truth-box strong { color: #ffb800; }
`;

type SnapshotPosition = {
  ticker: string;
  shares: number;
  avgCost: number;
  sector?: string;
  lastPrice?: number;
};

type SnapshotEntry = {
  id: string;
  trigger: string;
  note: string | null;
  positions: SnapshotPosition[];
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
  try {
    return new Date(iso).toLocaleString("zh-TW", { hour12: false });
  } catch {
    return iso;
  }
}

function shortId(id: string) {
  return `${id.slice(0, 12)}...`;
}

function triggerLabel(trigger: string) {
  if (trigger === "strategy_run") return "策略執行";
  if (trigger === "eod_auto") return "收盤自動";
  if (trigger === "rollback") return "回滾";
  if (trigger === "manual") return "手動";
  return trigger;
}

function triggerBadgeStyle(trigger: string) {
  if (trigger === "strategy_run") return { background: "rgba(33,150,243,0.15)", color: "#42a5f5", border: "1px solid rgba(33,150,243,0.3)" };
  if (trigger === "eod_auto") return { background: "rgba(156,39,176,0.15)", color: "#ce93d8", border: "1px solid rgba(156,39,176,0.3)" };
  if (trigger === "rollback") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" };
  return { background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" };
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "無資料";
  return new Intl.NumberFormat("zh-TW").format(value);
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "無資料";
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value);
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
  const [phase, setPhase] = useState<PortfolioSnapshotPhase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SnapshotEntry | null>(null);
  const [diffFrom, setDiffFrom] = useState("");
  const [diffTo, setDiffTo] = useState("");
  const [diff, setDiff] = useState<DiffEntry | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPhase("loading");
    setLoadError(null);

    apiFetch<{ snapshots: SnapshotEntry[]; nextCursor: string | null }>("/api/v1/portfolio/snapshots?limit=20")
      .then((d) => {
        if (cancelled) return;
        const nextSnapshots = d.snapshots ?? [];
        setSnapshots(nextSnapshots);
        setSelected(nextSnapshots[0] ?? null);
        setLoading(false);
        setPhase(nextSnapshots.length > 0 ? "live" : "empty");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoading(false);
        setLoadError(err.message);
        setPhase("blocked");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadDiff = useCallback(() => {
    if (!diffFrom || !diffTo) return;
    let cancelled = false;
    setDiffLoading(true);
    setDiffError("");
    setDiff(null);
    const qs = new URLSearchParams({ from: diffFrom, to: diffTo }).toString();
    apiFetch<DiffEntry>(`/api/v1/portfolio/snapshots/diff?${qs}`)
      .then((d) => {
        if (!cancelled) {
          setDiff(d);
          setDiffLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setDiffError(err.message);
          setDiffLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [diffFrom, diffTo]);

  const snapshotState = portfolioSnapshotStateCopy({ phase, count: snapshots.length, error: loadError });
  const latest = snapshots[0] ?? null;
  const stats = useMemo(() => {
    const totalPositions = snapshots.reduce((sum, snapshot) => sum + snapshot.positions.length, 0);
    const emptySnapshots = snapshots.filter((snapshot) => snapshot.positions.length === 0).length;
    return { totalPositions, emptySnapshots };
  }, [snapshots]);

  return (
    <>
      <style>{CSS}</style>
      <main className="page-frame">
        <header className="page-head">
          <div className="page-title">
            <span className="tg page-code">PORTFOLIO</span>
            <h1>Portfolio Snapshot</h1>
            <span className="tc">Trading-as-Git / Phase A</span>
          </div>
          <div className="tg meta-strip">
            <span>Owner only</span>
            <span>正式 API / Read-only</span>
          </div>
        </header>
        <div className="terminal-note">
          Portfolio Snapshot 是 paper portfolio 的歷史版本紀錄，用來查「當時帳本長什麼樣」與兩筆快照的差異；它不是即時委託簿，也不會假裝有持倉。
        </div>

        <div className={`_snap-state-note ${snapshotState.tone}`} role={snapshotState.tone === "blocked" ? "alert" : "status"}>
          <strong>{snapshotState.title}</strong>
          <span>{snapshotState.detail}</span>
          <dl>
            <dt>Endpoint</dt>
            <dd>{snapshotState.endpoint}</dd>
            <dt>Owner</dt>
            <dd>{snapshotState.owner}</dd>
            <dt>Next</dt>
            <dd>{snapshotState.nextAction}</dd>
          </dl>
        </div>

        <div className="_snap-summary" aria-label="Portfolio snapshot summary">
          <div className="_snap-card">
            <div className="_snap-card-label">快照筆數</div>
            <div className="_snap-card-value">{snapshots.length}</div>
            <div className="_snap-card-sub">最近 20 筆正式 API 回傳</div>
          </div>
          <div className="_snap-card">
            <div className="_snap-card-label">最新觸發</div>
            <div className="_snap-card-value">{latest ? triggerLabel(latest.trigger) : "無"}</div>
            <div className="_snap-card-sub">{latest ? fmtDT(latest.createdAt) : "尚未有快照"}</div>
          </div>
          <div className="_snap-card">
            <div className="_snap-card-label">持倉列數</div>
            <div className="_snap-card-value">{stats.totalPositions}</div>
            <div className="_snap-card-sub">依 snapshot.positions 計算</div>
          </div>
          <div className="_snap-card">
            <div className="_snap-card-label">空持倉快照</div>
            <div className="_snap-card-value">{stats.emptySnapshots}</div>
            <div className="_snap-card-sub">空倉會誠實標示，不當成資料壞掉</div>
          </div>
        </div>

        {snapshots.length > 0 && stats.totalPositions === 0 && (
          <div className="_snap-truth-box" role="status">
            <strong>目前 20 筆快照都是空持倉。</strong>
            這代表 snapshot API 有正常回資料，但這批快照的 positions 陣列為空，常見原因是 paper 帳本當時沒有持倉，或這批資料是啟動時的 30-day backfill。若要看即時資金、庫存、委託與成交，應看交易室或 portfolio live endpoint。
          </div>
        )}

        <div className="_snap-shell" style={{ marginTop: 10 }}>
          <div className="_snap-sidebar">
            <div className="_snap-sidebar-head">
              <span>快照清單</span>
              <span>{snapshots.length} 筆</span>
            </div>
            {loading && <div className="_snap-empty">讀取快照中...</div>}
            {!loading && phase === "blocked" && (
              <div className="_snap-empty">
                API 讀取失敗：{loadError ?? "unknown"}。請查看 API session 或 snapshot store。
              </div>
            )}
            {!loading && phase === "empty" && (
              <div className="_snap-empty">
                目前沒有任何 portfolio snapshot。API 可連線，但 writer 尚未寫入資料。
              </div>
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
                <div className="_snap-row-id">{shortId(s.id)}</div>
                <div className="_snap-row-meta">
                  <span className="_snap-badge" style={triggerBadgeStyle(s.trigger)}>{triggerLabel(s.trigger)}</span>
                  <span>{fmtDT(s.createdAt)}</span>
                  <span>{s.positions.length} 檔持倉</span>
                </div>
                {s.note && <div className="_snap-row-note">{s.note}</div>}
              </div>
            ))}
          </div>

          <div className="_snap-main">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="tg panel-code">SNAPSHOT</span>
                  <span className="tg muted"> / </span>
                  <span className="tg gold">
                    {selected ? shortId(selected.id) : "未選擇快照"}
                  </span>
                </div>
                {selected && (
                  <div className="tg soft">
                    <span className="_snap-badge" style={triggerBadgeStyle(selected.trigger)}>{triggerLabel(selected.trigger)}</span>
                    {" "}{fmtDT(selected.createdAt)}
                  </div>
                )}
              </div>
              {!selected && <div className="_snap-empty">尚未選擇快照。若 API 有回資料，頁面會自動選第一筆。</div>}
              {selected && (
                <>
                  <div className="_snap-truth-box" style={{ margin: "8px 10px" }}>
                    <strong>快照來源：</strong>
                    觸發方式 {triggerLabel(selected.trigger)}；持倉 {selected.positions.length} 檔；父快照 {selected.parentId ? shortId(selected.parentId) : "無"}。
                    {selected.note ? ` 備註：${selected.note}` : ""}
                  </div>
                  <div className="_snap-table-wrap">
                    <table className="_snap-table">
                      <thead>
                        <tr>
                          <th>股票</th>
                          <th>股數</th>
                          <th>均價</th>
                          <th>產業</th>
                          <th>最新價</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.positions.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ color: "rgba(255,255,255,0.48)", textAlign: "center", lineHeight: 1.8 }}>
                              這筆快照沒有持倉。這是正式 API 回傳的空 positions，不是前端假資料；請用交易室查看即時 paper 資金、委託、成交與 KGI read-only 狀態。
                            </td>
                          </tr>
                        ) : selected.positions.map((p) => (
                          <tr key={p.ticker}>
                            <td style={{ color: "#ffb800" }}>{p.ticker}</td>
                            <td>{formatNumber(p.shares)}</td>
                            <td>{formatPrice(p.avgCost)}</td>
                            <td>{p.sector ?? "未標記"}</td>
                            <td>{formatPrice(p.lastPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="tg panel-code">DIFF</span>
                  <span className="tg muted"> / </span>
                  <span className="tg gold">快照差異比對</span>
                </div>
              </div>
              <div className="_snap-toolbar">
                <span className="_snap-toolbar-lbl">From ID</span>
                <input className="_snap-input" placeholder="起始 snapshot ID" value={diffFrom} onChange={(e) => setDiffFrom(e.target.value)} />
                <span className="_snap-toolbar-lbl">To ID</span>
                <input className="_snap-input" placeholder="目標 snapshot ID" value={diffTo} onChange={(e) => setDiffTo(e.target.value)} />
                <button className="_snap-btn" type="button" disabled={!diffFrom || !diffTo || diffLoading} onClick={loadDiff}>
                  {diffLoading ? "比對中..." : "查詢 diff"}
                </button>
              </div>
              {diffError && (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "#ef5350" }}>
                  Diff 讀取失敗：{diffError}。Endpoint：{PORTFOLIO_SNAPSHOT_DIFF_ENDPOINT}。請確認 from/to snapshot ID 都存在。
                </div>
              )}
              {diff && (
                <div className="_snap-table-wrap" style={{ marginTop: 8 }}>
                  <table className="_snap-table">
                    <thead>
                      <tr>
                        <th>變化</th>
                        <th>股票</th>
                        <th>內容</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.added.map((p) => (
                        <tr key={`add-${p.ticker}`}>
                          <td><span className="_snap-badge _snap-diff-added" style={{ background: "rgba(76,175,80,0.12)", border: "1px solid rgba(76,175,80,0.3)" }}>新增</span></td>
                          <td className="_snap-diff-added">{p.ticker}</td>
                          <td>{formatNumber(p.shares)} 股 @ {formatPrice(p.avgCost)}</td>
                        </tr>
                      ))}
                      {diff.removed.map((p) => (
                        <tr key={`rm-${p.ticker}`}>
                          <td><span className="_snap-badge _snap-diff-removed" style={{ background: "rgba(239,83,80,0.12)", border: "1px solid rgba(239,83,80,0.3)" }}>移除</span></td>
                          <td className="_snap-diff-removed">{p.ticker}</td>
                          <td>{formatNumber(p.shares)} 股 @ {formatPrice(p.avgCost)}</td>
                        </tr>
                      ))}
                      {diff.changed.map((p) => (
                        <tr key={`ch-${p.ticker}`}>
                          <td><span className="_snap-badge _snap-diff-changed" style={{ background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.3)" }}>變更</span></td>
                          <td className="_snap-diff-changed">{p.ticker}</td>
                          <td>{formatNumber(p.fromShares)} → {formatNumber(p.toShares)} 股 / 均價 {formatPrice(p.fromAvgCost)} → {formatPrice(p.toAvgCost)}</td>
                        </tr>
                      ))}
                      {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && (
                        <tr><td colSpan={3} style={{ color: "rgba(255,255,255,0.45)", textAlign: "center" }}>兩筆快照沒有持倉差異</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {!diff && !diffError && !diffLoading && (
                <div className="_snap-empty">輸入兩個 snapshot ID 後，可以查看新增、移除、股數或均價變化。</div>
              )}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
