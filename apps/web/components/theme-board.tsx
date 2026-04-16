"use client";

import { useEffect, useMemo, useState } from "react";

import type { MarketState, Theme, ThemeCreateInput, ThemeGraphRankingView, ThemeGraphStatsView, ThemeLifecycle } from "@iuf-trading-room/contracts";

import { createTheme, getThemeGraphRankings, getThemeGraphStats, getThemes } from "@/lib/api";

const marketStates: MarketState[] = ["Attack", "Selective Attack", "Balanced", "Defense", "Preservation"];
const lifecycleStates: ThemeLifecycle[] = ["Discovery", "Validation", "Expansion", "Crowded", "Distribution"];

const marketLabel: Record<string, string> = {
  Attack: "進攻",
  "Selective Attack": "精選進攻",
  Balanced: "平衡",
  Defense: "防禦",
  Preservation: "保本"
};

const lifecycleLabel: Record<string, string> = {
  Discovery: "發現期",
  Validation: "驗證期",
  Expansion: "擴張期",
  Crowded: "擁擠期",
  Distribution: "出貨期"
};

const initialForm: ThemeCreateInput = {
  name: "",
  marketState: "Balanced",
  lifecycle: "Discovery",
  priority: 3,
  thesis: "",
  whyNow: "",
  bottleneck: ""
};

function MiniBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="theme-bar">
      <div className="theme-bar-row">
        <span className="theme-bar-label">{label}</span>
        <span className="theme-bar-value mono">{value}</span>
      </div>
      <div className="theme-bar-track">
        <div className="theme-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ThemeBoard() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [stats, setStats] = useState<ThemeGraphStatsView | null>(null);
  const [rankings, setRankings] = useState<ThemeGraphRankingView | null>(null);
  const [form, setForm] = useState<ThemeCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filterLifecycle, setFilterLifecycle] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "ranking">("ranking");

  useEffect(() => {
    getThemes()
      .then((r) => setThemes(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入主題"))
      .finally(() => setLoading(false));
    getThemeGraphStats().then((r) => setStats(r.data)).catch(() => {});
    getThemeGraphRankings({ limit: 12 }).then((r) => setRankings(r.data)).catch(() => {});
  }, []);

  const highPriority = useMemo(() => themes.filter((t) => t.priority >= 4).length, [themes]);

  const filtered = useMemo(() => {
    if (!filterLifecycle) return themes;
    return themes.filter((t) => t.lifecycle === filterLifecycle);
  }, [themes, filterLifecycle]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => b.priority - a.priority), [filtered]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await createTheme(form);
      setThemes((c) => [r.data, ...c]);
      setForm(initialForm);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立主題失敗");
    } finally {
      setSaving(false);
    }
  };

  const stateColor = (s: string) => {
    if (s === "Attack" || s === "Selective Attack") return "badge-green";
    if (s === "Defense" || s === "Preservation") return "badge-red";
    return "badge-yellow";
  };

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {/* 工具列 */}
      <div className="panel filter-bar">
        <div className="tab-bar" style={{ flexShrink: 0 }}>
          <button className={`tab-btn ${viewMode === "ranking" ? "active" : ""}`} onClick={() => setViewMode("ranking")}>火力排名</button>
          <button className={`tab-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")}>清單</button>
        </div>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{themes.length}</span>
          <small>主題</small>
        </div>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{highPriority}</span>
          <small>高優先</small>
        </div>
        {stats ? (
          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "var(--fs-base)" }}>{stats.connectedThemeCount}</span>
            <small>已連結</small>
          </div>
        ) : null}
        {stats ? (
          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "var(--fs-base)" }}>{stats.totalEdges}</span>
            <small>關係</small>
          </div>
        ) : null}
        {viewMode === "list" ? (
          <select value={filterLifecycle} onChange={(e) => setFilterLifecycle(e.target.value)}>
            <option value="">全部階段</option>
            {lifecycleStates.map((v) => <option key={v} value={v}>{lifecycleLabel[v]}</option>)}
          </select>
        ) : null}
        <button className="btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowForm(!showForm)}>
          {showForm ? "關閉表單" : "+ 新增主題"}
        </button>
      </div>

      {error ? <p className="error-text" style={{ fontSize: "var(--fs-sm)" }}>{error}</p> : null}

      {/* 建立表單 */}
      {showForm ? (
        <form className="panel" onSubmit={handleSubmit}>
          <p className="eyebrow">新增主題</p>
          <label className="field"><span>名稱</span>
            <input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="AI 電力與散熱" />
          </label>
          <div className="field-grid">
            <label className="field"><span>盤勢狀態</span>
              <select value={form.marketState} onChange={(e) => setForm((c) => ({ ...c, marketState: e.target.value as MarketState }))}>
                {marketStates.map((v) => <option key={v} value={v}>{marketLabel[v] ?? v}</option>)}
              </select>
            </label>
            <label className="field"><span>生命週期</span>
              <select value={form.lifecycle} onChange={(e) => setForm((c) => ({ ...c, lifecycle: e.target.value as ThemeLifecycle }))}>
                {lifecycleStates.map((v) => <option key={v} value={v}>{lifecycleLabel[v] ?? v}</option>)}
              </select>
            </label>
          </div>
          <label className="field"><span>優先度 (1-5)</span>
            <input type="number" min={1} max={5} value={form.priority} onChange={(e) => setForm((c) => ({ ...c, priority: Number(e.target.value) }))} />
          </label>
          <label className="field"><span>論點</span>
            <textarea value={form.thesis} onChange={(e) => setForm((c) => ({ ...c, thesis: e.target.value }))} placeholder="為什麼這個主題值得追蹤" />
          </label>
          <label className="field"><span>為什麼是現在</span>
            <textarea value={form.whyNow} onChange={(e) => setForm((c) => ({ ...c, whyNow: e.target.value }))} placeholder="正在發生什麼催化劑" />
          </label>
          <label className="field"><span>瓶頸 / 低估環節</span>
            <textarea value={form.bottleneck} onChange={(e) => setForm((c) => ({ ...c, bottleneck: e.target.value }))} placeholder="供應鏈中被低估的環節" />
          </label>
          <button className="action-button" type="submit" disabled={saving}>{saving ? "建立中..." : "建立主題"}</button>
        </form>
      ) : null}

      {/* 主題內容 */}
      {viewMode === "ranking" ? (
        <div className="panel">
          {!rankings ? (
            <p className="muted loading-text">載入排名...</p>
          ) : rankings.results.length === 0 ? (
            <p className="dim">尚無排名資料，先新增主題與公司關聯。</p>
          ) : (
            <div className="theme-ranking-grid">
              {rankings.results.map((r, idx) => (
                <div key={r.themeId} className="theme-ranking-card">
                  <div className="theme-ranking-head">
                    <span className="theme-rank-num mono">#{idx + 1}</span>
                    <div className="theme-ranking-score mono">{r.score}</div>
                  </div>
                  <div className="theme-ranking-name">{r.name}</div>
                  <div className="theme-ranking-meta dim">
                    {marketLabel[r.marketState] ?? r.marketState} · {lifecycleLabel[r.lifecycle] ?? r.lifecycle} · 優先度 {r.priority}
                  </div>
                  <div className="theme-ranking-meta dim">
                    {r.summary.themeCompanyCount} 核心 · {r.summary.relatedCompanyCount} 關聯 · {r.summary.totalEdges} 關係
                  </div>
                  {r.summary.topKeywords.length > 0 ? (
                    <div className="theme-ranking-signals">
                      {r.summary.topKeywords.slice(0, 4).map((k, i) => (
                        <span key={i} className="badge" style={{ fontSize: "var(--fs-xs)" }}>{k.label} ×{k.count}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="theme-ranking-bars">
                    <MiniBar label="信念" value={r.breakdown.conviction} max={40} />
                    <MiniBar label="連結" value={r.breakdown.connectivity} max={30} />
                    <MiniBar label="槓桿" value={r.breakdown.leverage} max={20} />
                    <MiniBar label="關鍵詞" value={r.breakdown.keywordRichness} max={10} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="panel">
          {loading ? <p className="muted loading-text">載入主題...</p> : sorted.length === 0 ? <p className="dim">尚無主題，點擊上方按鈕建立。</p> : (
            <div className="card-stack">
              {sorted.map((t) => (
                <article key={t.id} className="record-card">
                  <div className="record-topline">
                    <strong style={{ fontSize: "var(--fs-base)" }}>{t.name}</strong>
                    <div className="action-row" style={{ gap: 4 }}>
                      <span className={stateColor(t.marketState)} style={{ fontSize: "var(--fs-xs)" }}>{marketLabel[t.marketState] ?? t.marketState}</span>
                      <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>{lifecycleLabel[t.lifecycle] ?? t.lifecycle}</span>
                    </div>
                  </div>
                  <p className="record-meta">
                    優先度 <strong className="mono">{t.priority}</strong> · 更新 {new Date(t.updatedAt).toLocaleDateString("zh-TW")}
                  </p>
                  <p style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>{t.thesis}</p>
                  {t.whyNow ? <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>為什麼是現在：{t.whyNow}</p> : null}
                  {t.bottleneck ? <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>瓶頸：{t.bottleneck}</p> : null}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
