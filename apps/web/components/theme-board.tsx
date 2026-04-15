"use client";

import { useEffect, useMemo, useState } from "react";

import type { MarketState, Theme, ThemeCreateInput, ThemeLifecycle } from "@iuf-trading-room/contracts";

import { createTheme, getThemes } from "@/lib/api";

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

export function ThemeBoard() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [form, setForm] = useState<ThemeCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    getThemes()
      .then((r) => setThemes(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入主題"))
      .finally(() => setLoading(false));
  }, []);

  const highPriority = useMemo(() => themes.filter((t) => t.priority >= 4).length, [themes]);

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
      <div className="panel" style={{ padding: "8px 14px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.9rem" }}>{themes.length}</span>
            <small style={{ fontSize: "0.6rem" }}>主題</small>
          </div>
          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.9rem" }}>{highPriority}</span>
            <small style={{ fontSize: "0.6rem" }}>高優先</small>
          </div>
          <button
            className="action-button"
            style={{ fontSize: "0.75rem", padding: "5px 12px", marginLeft: "auto" }}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "關閉表單" : "+ 新增主題"}
          </button>
        </div>
      </div>

      {error ? <p className="error-text" style={{ fontSize: "0.78rem" }}>{error}</p> : null}

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

      {/* 主題列表 */}
      <div className="panel">
        {loading ? <p className="muted">載入主題...</p> : themes.length === 0 ? <p className="dim">尚無主題，點擊上方按鈕建立。</p> : (
          <div className="card-stack">
            {themes.map((t) => (
              <article key={t.id} className="record-card">
                <div className="record-topline">
                  <strong style={{ fontSize: "0.85rem" }}>{t.name}</strong>
                  <div style={{ display: "flex", gap: 4 }}>
                    <span className={stateColor(t.marketState)} style={{ fontSize: "0.65rem" }}>{marketLabel[t.marketState] ?? t.marketState}</span>
                    <span className="badge" style={{ fontSize: "0.65rem" }}>{lifecycleLabel[t.lifecycle] ?? t.lifecycle}</span>
                  </div>
                </div>
                <p className="record-meta">
                  優先度 <strong className="mono">{t.priority}</strong> · 更新 {new Date(t.updatedAt).toLocaleDateString("zh-TW")}
                </p>
                <p style={{ fontSize: "0.8rem", marginTop: 4 }}>{t.thesis}</p>
                {t.whyNow ? <p className="dim" style={{ fontSize: "0.75rem" }}>為什麼是現在：{t.whyNow}</p> : null}
                {t.bottleneck ? <p className="dim" style={{ fontSize: "0.75rem" }}>瓶頸：{t.bottleneck}</p> : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
