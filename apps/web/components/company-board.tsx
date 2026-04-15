"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  BeneficiaryTier,
  Company,
  CompanyCreateInput,
  ExposureBreakdown
} from "@iuf-trading-room/contracts";

import { createCompany, getCompanies, getThemes } from "@/lib/api";

const tiers: BeneficiaryTier[] = ["Core", "Direct", "Indirect", "Observation"];
const tierLabel: Record<string, string> = { Core: "核心", Direct: "直接", Indirect: "間接", Observation: "觀察" };
const exposureKeys: Array<keyof ExposureBreakdown> = ["volume", "asp", "margin", "capacity", "narrative"];
const exposureLabel: Record<string, string> = { volume: "量", asp: "價", margin: "毛利", capacity: "產能", narrative: "題材" };

const emptyExposure: ExposureBreakdown = { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 };

const initialForm: CompanyCreateInput = {
  name: "", ticker: "", market: "TWSE", country: "Taiwan",
  themeIds: [], chainPosition: "", beneficiaryTier: "Observation",
  exposure: emptyExposure,
  validation: { capitalFlow: "", consensus: "", relativeStrength: "" },
  notes: ""
};

const PAGE_SIZE = 50;
type SortField = "name" | "ticker" | "beneficiaryTier" | "chainPosition";
type SortDir = "asc" | "desc";
const tierRank: Record<BeneficiaryTier, number> = { Core: 0, Direct: 1, Indirect: 2, Observation: 3 };

export function CompanyBoard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [themeOptions, setThemeOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<CompanyCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [filterSector, setFilterSector] = useState("");
  const [sortField, setSortField] = useState<SortField>("ticker");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Company | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    Promise.all([getCompanies(), getThemes()])
      .then(([cr, tr]) => { setCompanies(cr.data); setThemeOptions(tr.data.map((t) => ({ id: t.id, name: t.name }))); })
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入公司"))
      .finally(() => setLoading(false));
  }, []);

  const sectors = useMemo(() => [...new Set(companies.map((c) => c.chainPosition).filter(Boolean))].sort(), [companies]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return companies
      .filter((c) => {
        if (q && !c.name.toLowerCase().includes(q) && !c.ticker.toLowerCase().includes(q)) return false;
        if (filterTier && c.beneficiaryTier !== filterTier) return false;
        if (filterSector && c.chainPosition !== filterSector) return false;
        return true;
      })
      .sort((a, b) => {
        let cmp = sortField === "beneficiaryTier"
          ? tierRank[a.beneficiaryTier] - tierRank[b.beneficiaryTier]
          : (a[sortField] ?? "").localeCompare(b[sortField] ?? "");
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [companies, search, filterTier, filterSector, sortField, sortDir]);

  useEffect(() => { setPage(0); }, [search, filterTier, filterSector, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }, [sortField]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const r = await createCompany(form);
      setCompanies((c) => [r.data, ...c]);
      setForm(initialForm); setShowForm(false);
    } catch (err) { setError(err instanceof Error ? err.message : "建立公司失敗"); }
    finally { setSaving(false); }
  };

  const sortArrow = (f: SortField) => sortField === f ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  /* ── 詳細面板 ── */
  if (selected) {
    return (
      <section style={{ display: "grid", gap: 14 }}>
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">公司詳情</p>
              <h3>{selected.name} <span className="mono muted">({selected.ticker})</span></h3>
            </div>
            <button className="hero-link" style={{ fontSize: "0.75rem", padding: "5px 12px" }} onClick={() => setSelected(null)}>返回列表</button>
          </div>

          <div className="card-stack">
            <div className="record-card">
              <div className="record-topline">
                <strong>分類</strong>
                <span className="badge">{tierLabel[selected.beneficiaryTier] ?? selected.beneficiaryTier}</span>
              </div>
              <p className="record-meta">{selected.market} / {selected.country} / {selected.chainPosition}</p>
            </div>

            <div className="record-card">
              <strong style={{ fontSize: "0.78rem" }}>曝險評分</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 8 }}>
                {exposureKeys.map((k) => (
                  <div key={k} style={{ textAlign: "center" }}>
                    <div className="big-num" style={{ fontSize: "1.2rem" }}>{selected.exposure[k]}</div>
                    <div className="dim" style={{ fontSize: "0.62rem" }}>{exposureLabel[k]}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="record-card">
              <strong style={{ fontSize: "0.78rem" }}>驗證快照</strong>
              <p className="record-meta" style={{ marginTop: 4 }}>資金流：{selected.validation.capitalFlow || "N/A"}</p>
              <p className="record-meta">共識：{selected.validation.consensus || "N/A"}</p>
              <p className="record-meta">相對強度：{selected.validation.relativeStrength || "N/A"}</p>
            </div>

            {selected.notes ? (
              <div className="record-card">
                <strong style={{ fontSize: "0.78rem" }}>筆記</strong>
                <p style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", marginTop: 4 }}>{selected.notes}</p>
              </div>
            ) : null}

            <div className="action-row">
              <a href={`/signals?companyId=${selected.id}`} className="hero-link" style={{ fontSize: "0.75rem", padding: "5px 12px" }}>查看訊號</a>
              <a href={`/plans?companyId=${selected.id}`} className="hero-link" style={{ fontSize: "0.75rem", padding: "5px 12px" }}>查看計畫</a>
              <a href={`/plans?newForCompany=${selected.id}&companyName=${encodeURIComponent(selected.name)}`} className="hero-link primary" style={{ fontSize: "0.75rem", padding: "5px 12px" }}>+ 建立計畫</a>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {/* 工具列 */}
      <div className="panel" style={{ padding: "8px 14px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input placeholder="搜尋名稱或代號..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 160px", minWidth: 140 }} />
          <select value={filterSector} onChange={(e) => setFilterSector(e.target.value)} style={{ width: "auto", minWidth: 100 }}>
            <option value="">全部產業 ({sectors.length})</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)} style={{ width: "auto", minWidth: 80 }}>
            <option value="">全部層級</option>
            {tiers.map((t) => <option key={t} value={t}>{tierLabel[t]}</option>)}
          </select>
          <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.9rem" }}>{filtered.length}</span>
            <small style={{ fontSize: "0.6rem" }}>符合</small>
          </div>
          <button className="action-button" style={{ fontSize: "0.75rem", padding: "5px 12px" }} onClick={() => setShowForm(!showForm)}>
            {showForm ? "關閉表單" : "+ 新增公司"}
          </button>
        </div>
      </div>

      {error ? <p className="error-text" style={{ fontSize: "0.78rem" }}>{error}</p> : null}

      {/* 建立表單 */}
      {showForm ? (
        <form className="panel" onSubmit={handleSubmit}>
          <p className="eyebrow">新增公司</p>
          <div className="field-grid">
            <label className="field"><span>名稱</span><input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="聯亞光電" /></label>
            <label className="field"><span>代號</span><input value={form.ticker} onChange={(e) => setForm((c) => ({ ...c, ticker: e.target.value }))} placeholder="3081.TW" /></label>
          </div>
          <div className="field-grid">
            <label className="field"><span>市場</span><input value={form.market} onChange={(e) => setForm((c) => ({ ...c, market: e.target.value }))} /></label>
            <label className="field"><span>國家</span><input value={form.country} onChange={(e) => setForm((c) => ({ ...c, country: e.target.value }))} /></label>
          </div>
          <label className="field"><span>主題</span>
            <select value={form.themeIds[0] ?? ""} onChange={(e) => setForm((c) => ({ ...c, themeIds: e.target.value ? [e.target.value] : [] }))}>
              <option value="">選擇主題</option>
              {themeOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div className="field-grid">
            <label className="field"><span>供應鏈定位</span><input value={form.chainPosition} onChange={(e) => setForm((c) => ({ ...c, chainPosition: e.target.value }))} placeholder="光模組供應商" /></label>
            <label className="field"><span>受益層級</span>
              <select value={form.beneficiaryTier} onChange={(e) => setForm((c) => ({ ...c, beneficiaryTier: e.target.value as BeneficiaryTier }))}>
                {tiers.map((t) => <option key={t} value={t}>{tierLabel[t]}</option>)}
              </select>
            </label>
          </div>
          <div className="score-grid">
            {exposureKeys.map((k) => (
              <label key={k} className="field"><span>{exposureLabel[k]}</span>
                <input type="number" min={1} max={5} value={form.exposure[k]} onChange={(e) => setForm((c) => ({ ...c, exposure: { ...c.exposure, [k]: Number(e.target.value) } }))} />
              </label>
            ))}
          </div>
          <label className="field"><span>筆記</span><textarea value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} placeholder="這間公司的低估環節" /></label>
          <button className="action-button" type="submit" disabled={saving}>{saving ? "建立中..." : "建立公司"}</button>
        </form>
      ) : null}

      {/* 表格 */}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <p className="muted" style={{ padding: 16 }}>載入 1,700+ 間公司...</p>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th onClick={() => toggleSort("ticker")}>代號{sortArrow("ticker")}</th>
                    <th onClick={() => toggleSort("name")}>名稱{sortArrow("name")}</th>
                    <th onClick={() => toggleSort("chainPosition")}>產業{sortArrow("chainPosition")}</th>
                    <th onClick={() => toggleSort("beneficiaryTier")}>層級{sortArrow("beneficiaryTier")}</th>
                    <th>曝險</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice.map((c) => (
                    <tr key={c.id} onClick={() => setSelected(c)} style={{ cursor: "pointer" }}>
                      <td className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{c.ticker}</td>
                      <td>{c.name}</td>
                      <td className="dim" style={{ fontSize: "0.75rem" }}>{c.chainPosition}</td>
                      <td><span className="badge" style={{ fontSize: "0.65rem", padding: "2px 7px" }}>{tierLabel[c.beneficiaryTier] ?? c.beneficiaryTier}</span></td>
                      <td className="mono dim" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>{c.exposure.volume}/{c.exposure.asp}/{c.exposure.margin}/{c.exposure.capacity}/{c.exposure.narrative}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分頁 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderTop: "1px solid var(--line)", fontSize: "0.75rem" }}>
              <span className="dim">顯示 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / 共 {filtered.length}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="hero-link" style={{ padding: "4px 10px", fontSize: "0.72rem" }} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>上一頁</button>
                <span className="mono" style={{ lineHeight: "28px" }}>{page + 1} / {totalPages}</span>
                <button className="hero-link" style={{ padding: "4px 10px", fontSize: "0.72rem" }} disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>下一頁</button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
