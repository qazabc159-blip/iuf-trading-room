"use client";

import { useEffect, useState } from "react";

import type {
  Company,
  Signal,
  SignalCategory,
  SignalCreateInput,
  SignalDirection
} from "@iuf-trading-room/contracts";

import { createSignal, getCompanies, getSignals } from "@/lib/api";

const categories: SignalCategory[] = ["macro", "industry", "company", "price", "portfolio"];
const directions: SignalDirection[] = ["bullish", "bearish", "neutral"];

const catLabel: Record<string, string> = { macro: "總經", industry: "產業", company: "個股", price: "價格", portfolio: "部位" };
const dirLabel: Record<string, string> = { bullish: "看多", bearish: "看空", neutral: "中性" };

const initialForm: SignalCreateInput = {
  category: "macro",
  direction: "bullish",
  title: "",
  summary: "",
  confidence: 3,
  themeIds: [],
  companyIds: []
};

export function SignalBoard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState<SignalCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getSignals(filterCategory ? { category: filterCategory } : undefined),
      getCompanies()
    ])
      .then(([sr, cr]) => { setSignals(sr.data); setCompanies(cr.data); })
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入訊號"))
      .finally(() => setLoading(false));
  }, [filterCategory]);

  const companyMap = new Map(companies.map((c) => [c.id, c]));
  const getLabel = (id: string) => { const c = companyMap.get(id); return c ? `${c.ticker} ${c.name}` : id.slice(0, 8); };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const r = await createSignal(form);
      setSignals((c) => [r.data, ...c]);
      setForm(initialForm); setShowForm(false);
    } catch (err) { setError(err instanceof Error ? err.message : "建立訊號失敗"); }
    finally { setSaving(false); }
  };

  const dirColor = (d: string) => d === "bullish" ? "badge-green" : d === "bearish" ? "badge-red" : "badge-yellow";

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {/* 工具列 */}
      <div className="panel filter-bar">
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">全部類別</option>
          {categories.map((c) => <option key={c} value={c}>{catLabel[c]}</option>)}
        </select>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{signals.length}</span>
          <small>訊號</small>
        </div>
        <button className="btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowForm(!showForm)}>
          {showForm ? "關閉表單" : "+ 新增訊號"}
        </button>
      </div>

      {error ? <p className="error-text" style={{ fontSize: "var(--fs-sm)" }}>{error}</p> : null}

      {/* 建立表單 */}
      {showForm ? (
        <form className="panel" onSubmit={handleSubmit}>
          <p className="eyebrow">新增訊號</p>
          <label className="field"><span>標題</span>
            <input value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} placeholder="台積電上調資本支出 15%" />
          </label>
          <div className="field-grid">
            <label className="field"><span>類別</span>
              <select value={form.category} onChange={(e) => setForm((c) => ({ ...c, category: e.target.value as SignalCategory }))}>
                {categories.map((v) => <option key={v} value={v}>{catLabel[v]}</option>)}
              </select>
            </label>
            <label className="field"><span>方向</span>
              <select value={form.direction} onChange={(e) => setForm((c) => ({ ...c, direction: e.target.value as SignalDirection }))}>
                {directions.map((v) => <option key={v} value={v}>{dirLabel[v]}</option>)}
              </select>
            </label>
          </div>
          <label className="field"><span>信心度 (1-5)</span>
            <input type="number" min={1} max={5} value={form.confidence} onChange={(e) => setForm((c) => ({ ...c, confidence: Number(e.target.value) }))} />
          </label>
          <label className="field"><span>摘要</span>
            <textarea value={form.summary} onChange={(e) => setForm((c) => ({ ...c, summary: e.target.value }))} placeholder="這個訊號對論點的意義" />
          </label>
          <button className="action-button" type="submit" disabled={saving}>{saving ? "建立中..." : "建立訊號"}</button>
        </form>
      ) : null}

      {/* 訊號列表 */}
      <div className="panel">
        {loading ? <p className="muted loading-text">載入訊號...</p> : signals.length === 0 ? <p className="dim">目前沒有訊號。</p> : (
          <div className="card-stack">
            {signals.map((s) => (
              <article key={s.id} className="record-card">
                <div className="record-topline">
                  <strong style={{ fontSize: "var(--fs-base)" }}>{s.title}</strong>
                  <span className={dirColor(s.direction)} style={{ fontSize: "var(--fs-xs)" }}>{dirLabel[s.direction]}</span>
                </div>
                <p className="record-meta">
                  {catLabel[s.category] ?? s.category} · 信心 <strong className="mono">{s.confidence}</strong>/5 · {new Date(s.createdAt).toLocaleDateString("zh-TW")}
                </p>
                {s.companyIds.length > 0 ? (
                  <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>關聯公司：{s.companyIds.map(getLabel).join("、")}</p>
                ) : null}
                {s.summary ? <p style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>{s.summary}</p> : null}
                {s.companyIds.length > 0 ? (
                  <div className="action-row" style={{ marginTop: 6 }}>
                    {s.companyIds.map((cid) => {
                      const comp = companyMap.get(cid);
                      return (
                        <a key={cid} href={`/plans?newForCompany=${cid}&companyName=${encodeURIComponent(comp?.name ?? cid.slice(0, 8))}`}
                          className="hero-link primary" style={{ fontSize: "var(--fs-xs)", padding: "3px 8px" }}>
                          + {comp?.ticker ?? cid.slice(0, 8)} 計畫
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
