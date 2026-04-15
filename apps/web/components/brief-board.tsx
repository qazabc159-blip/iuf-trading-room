"use client";

import { useEffect, useState } from "react";

import type { DailyBrief, DailyBriefCreateInput } from "@iuf-trading-room/contracts";

import { createBrief, getBriefs } from "@/lib/api";

const today = () => new Date().toISOString().slice(0, 10);

const initialForm: DailyBriefCreateInput = {
  date: today(),
  marketState: "Balanced",
  sections: [
    { heading: "盤勢狀態", body: "" },
    { heading: "主題異動", body: "" },
    { heading: "重點訊號", body: "" },
    { heading: "待發酵催化劑", body: "" },
    { heading: "觀察清單異動", body: "" }
  ],
  generatedBy: "manual",
  status: "draft"
};

const statusLabel: Record<string, string> = { draft: "草稿", published: "已發布" };
const stateLabel: Record<string, string> = {
  Attack: "進攻", "Selective Attack": "精選進攻", Balanced: "平衡", Defense: "防禦", Preservation: "保本"
};

export function BriefBoard() {
  const [briefs, setBriefs] = useState<DailyBrief[]>([]);
  const [form, setForm] = useState<DailyBriefCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<DailyBrief | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    getBriefs()
      .then((r) => setBriefs(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入簡報"))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const r = await createBrief(form);
      setBriefs((c) => [r.data, ...c]);
      setForm({ ...initialForm, date: today() }); setShowForm(false);
    } catch (err) { setError(err instanceof Error ? err.message : "建立簡報失敗"); }
    finally { setSaving(false); }
  };

  const updateSection = (i: number, value: string) => {
    setForm((c) => ({ ...c, sections: c.sections.map((s, idx) => idx === i ? { ...s, body: value } : s) }));
  };

  /* 閱讀模式 */
  if (selected) {
    return (
      <section style={{ display: "grid", gap: 14 }}>
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">每日簡報</p>
              <h3>{selected.date}</h3>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <span className="badge-blue" style={{ fontSize: "0.65rem" }}>{statusLabel[selected.status] ?? selected.status}</span>
              <span className="badge" style={{ fontSize: "0.65rem" }}>{selected.generatedBy}</span>
              <button className="hero-link" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setSelected(null)}>返回</button>
            </div>
          </div>
          <p className="record-meta" style={{ marginBottom: 10 }}>盤勢：{stateLabel[selected.marketState] ?? selected.marketState}</p>
          {selected.sections.map((s, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <h4 style={{ fontSize: "0.82rem", margin: "0 0 4px", color: "var(--accent)" }}>{s.heading}</h4>
              <p style={{ fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>{s.body || "（空白）"}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {/* 工具列 */}
      <div className="panel" style={{ padding: "8px 14px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.9rem" }}>{briefs.length}</span>
            <small style={{ fontSize: "0.6rem" }}>簡報</small>
          </div>
          <button className="action-button" style={{ fontSize: "0.75rem", padding: "5px 12px", marginLeft: "auto" }} onClick={() => setShowForm(!showForm)}>
            {showForm ? "關閉表單" : "+ 新增簡報"}
          </button>
        </div>
      </div>

      {error ? <p className="error-text" style={{ fontSize: "0.78rem" }}>{error}</p> : null}

      {/* 建立表單 */}
      {showForm ? (
        <form className="panel" onSubmit={handleSubmit}>
          <p className="eyebrow">新增每日簡報</p>
          <label className="field"><span>日期</span>
            <input type="date" value={form.date} onChange={(e) => setForm((c) => ({ ...c, date: e.target.value }))} />
          </label>
          <label className="field"><span>盤勢狀態</span>
            <input value={form.marketState} onChange={(e) => setForm((c) => ({ ...c, marketState: e.target.value }))} placeholder="平衡、進攻、防禦..." />
          </label>
          {form.sections.map((s, i) => (
            <div key={i} className="field">
              <span>{s.heading}</span>
              <textarea value={s.body} onChange={(e) => updateSection(i, e.target.value)} placeholder={`撰寫${s.heading}...`} />
            </div>
          ))}
          <button className="action-button" type="submit" disabled={saving}>{saving ? "建立中..." : "建立簡報"}</button>
        </form>
      ) : null}

      {/* 簡報列表 */}
      <div className="panel">
        {loading ? <p className="muted">載入簡報...</p> : briefs.length === 0 ? <p className="dim">尚無簡報，點擊上方建立。</p> : (
          <div className="card-stack">
            {briefs.map((b) => (
              <article key={b.id} className="record-card" onClick={() => setSelected(b)} style={{ cursor: "pointer" }}>
                <div className="record-topline">
                  <strong className="mono" style={{ fontSize: "0.85rem" }}>{b.date}</strong>
                  <div style={{ display: "flex", gap: 4 }}>
                    <span className="badge-blue" style={{ fontSize: "0.62rem" }}>{statusLabel[b.status] ?? b.status}</span>
                    <span className="badge" style={{ fontSize: "0.62rem" }}>{b.generatedBy}</span>
                  </div>
                </div>
                <p className="record-meta">盤勢 {stateLabel[b.marketState] ?? b.marketState} · {b.sections.length} 段落</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
