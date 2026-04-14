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
const exposureKeys: Array<keyof ExposureBreakdown> = [
  "volume",
  "asp",
  "margin",
  "capacity",
  "narrative"
];

const emptyExposure: ExposureBreakdown = {
  volume: 3,
  asp: 3,
  margin: 3,
  capacity: 3,
  narrative: 3
};

const initialForm: CompanyCreateInput = {
  name: "",
  ticker: "",
  market: "TWSE",
  country: "Taiwan",
  themeIds: [],
  chainPosition: "",
  beneficiaryTier: "Observation",
  exposure: emptyExposure,
  validation: {
    capitalFlow: "",
    consensus: "",
    relativeStrength: ""
  },
  notes: ""
};

const PAGE_SIZE = 50;

type SortField = "name" | "ticker" | "beneficiaryTier" | "chainPosition";
type SortDir = "asc" | "desc";

const tierRank: Record<BeneficiaryTier, number> = {
  Core: 0,
  Direct: 1,
  Indirect: 2,
  Observation: 3
};

export function CompanyBoard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [themeOptions, setThemeOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<CompanyCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [filterSector, setFilterSector] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("ticker");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Pagination
  const [page, setPage] = useState(0);

  // Detail drawer
  const [selected, setSelected] = useState<Company | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [companiesResponse, themesResponse] = await Promise.all([getCompanies(), getThemes()]);
        setCompanies(companiesResponse.data);
        setThemeOptions(themesResponse.data.map((theme) => ({ id: theme.id, name: theme.name })));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load companies.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  // Derive unique sectors from chainPosition
  const sectors = useMemo(() => {
    const set = new Set<string>();
    for (const c of companies) {
      if (c.chainPosition) set.add(c.chainPosition);
    }
    return [...set].sort();
  }, [companies]);

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = companies.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.ticker.toLowerCase().includes(q)) {
        return false;
      }
      if (filterTier && c.beneficiaryTier !== filterTier) return false;
      if (filterSector && c.chainPosition !== filterSector) return false;
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "beneficiaryTier") {
        cmp = tierRank[a.beneficiaryTier] - tierRank[b.beneficiaryTier];
      } else {
        cmp = (a[sortField] ?? "").localeCompare(b[sortField] ?? "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [companies, search, filterTier, filterSector, sortField, sortDir]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, filterTier, filterSector, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await createCompany(form);
      setCompanies((current) => [response.data, ...current]);
      setForm(initialForm);
      setShowForm(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create company.");
    } finally {
      setSaving(false);
    }
  };

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ^" : " v") : "";

  // Detail drawer
  if (selected) {
    return (
      <section className="board-grid">
        <div className="panel panel-large">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Company Detail</p>
              <h3>
                {selected.name}{" "}
                <span className="muted">({selected.ticker})</span>
              </h3>
            </div>
            <button
              className="action-button"
              onClick={() => setSelected(null)}
              style={{ fontSize: "0.85rem", padding: "8px 14px" }}
            >
              Back to list
            </button>
          </div>

          <div className="card-stack">
            <div className="record-card">
              <div className="record-topline">
                <strong>Classification</strong>
                <span className="badge">{selected.beneficiaryTier}</span>
              </div>
              <p className="record-meta">
                {selected.market} / {selected.country} / {selected.chainPosition}
              </p>
            </div>

            <div className="record-card">
              <strong>Exposure Scores</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 10 }}>
                {exposureKeys.map((k) => (
                  <div key={k} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{selected.exposure[k]}</div>
                    <div className="muted" style={{ fontSize: "0.75rem", textTransform: "capitalize" }}>
                      {k}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="record-card">
              <strong>Validation Snapshot</strong>
              <p className="record-meta" style={{ marginTop: 8 }}>
                Capital Flow: {selected.validation.capitalFlow || "N/A"}
              </p>
              <p className="record-meta">Consensus: {selected.validation.consensus || "N/A"}</p>
              <p className="record-meta">
                Relative Strength: {selected.validation.relativeStrength || "N/A"}
              </p>
            </div>

            {selected.notes ? (
              <div className="record-card">
                <strong>Notes</strong>
                <p style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{selected.notes}</p>
              </div>
            ) : null}

            <div className="action-row" style={{ marginTop: 8 }}>
              <a
                href={`/signals?companyId=${selected.id}`}
                className="hero-link"
                style={{ fontSize: "0.85rem" }}
              >
                View Signals
              </a>
              <a
                href={`/plans?companyId=${selected.id}`}
                className="hero-link"
                style={{ fontSize: "0.85rem" }}
              >
                View Plans
              </a>
              <a
                href={`/plans?newForCompany=${selected.id}&companyName=${encodeURIComponent(selected.name)}`}
                className="hero-link primary"
                style={{ fontSize: "0.85rem" }}
              >
                + Create Plan
              </a>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Quick Info</p>
              <h3>{selected.ticker}</h3>
            </div>
          </div>
          <p>
            <strong>Theme IDs:</strong>{" "}
            {selected.themeIds.length > 0 ? selected.themeIds.join(", ") : "None"}
          </p>
          <p className="muted" style={{ marginTop: 12, fontSize: "0.82rem" }}>
            Updated: {selected.updatedAt}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 20 }}>
      {/* Toolbar */}
      <div className="panel" style={{ padding: "14px 22px" }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          <input
            placeholder="Search name or ticker..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 200px", minWidth: 180 }}
          />
          <select value={filterSector} onChange={(e) => setFilterSector(e.target.value)}>
            <option value="">All sectors ({sectors.length})</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}>
            <option value="">All tiers</option>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div className="metric-chip" style={{ padding: "6px 12px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.95rem" }}>{filtered.length}</span>
            <small style={{ fontSize: "0.7rem" }}>match</small>
          </div>
          <button
            className="action-button"
            style={{ fontSize: "0.85rem", padding: "8px 14px" }}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "Close form" : "+ Add company"}
          </button>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {/* Create form (collapsible) */}
      {showForm ? (
        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-header">
            <div>
              <p className="eyebrow">Create Company</p>
              <h3>New company card</h3>
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                placeholder="Acme Optics Taiwan"
              />
            </label>
            <label className="field">
              <span>Ticker</span>
              <input
                value={form.ticker}
                onChange={(e) => setForm((c) => ({ ...c, ticker: e.target.value }))}
                placeholder="6801"
              />
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Market</span>
              <input
                value={form.market}
                onChange={(e) => setForm((c) => ({ ...c, market: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Country</span>
              <input
                value={form.country}
                onChange={(e) => setForm((c) => ({ ...c, country: e.target.value }))}
              />
            </label>
          </div>

          <label className="field">
            <span>Theme</span>
            <select
              value={form.themeIds[0] ?? ""}
              onChange={(e) =>
                setForm((c) => ({
                  ...c,
                  themeIds: e.target.value ? [e.target.value] : []
                }))
              }
            >
              <option value="">Select a theme</option>
              {themeOptions.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>

          <div className="field-grid">
            <label className="field">
              <span>Chain position</span>
              <input
                value={form.chainPosition}
                onChange={(e) => setForm((c) => ({ ...c, chainPosition: e.target.value }))}
                placeholder="Optical module supplier"
              />
            </label>
            <label className="field">
              <span>Beneficiary tier</span>
              <select
                value={form.beneficiaryTier}
                onChange={(e) =>
                  setForm((c) => ({
                    ...c,
                    beneficiaryTier: e.target.value as BeneficiaryTier
                  }))
                }
              >
                {tiers.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="score-grid">
            {exposureKeys.map((key) => (
              <label key={key} className="field">
                <span>{key}</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.exposure[key]}
                  onChange={(e) =>
                    setForm((c) => ({
                      ...c,
                      exposure: { ...c.exposure, [key]: Number(e.target.value) }
                    }))
                  }
                />
              </label>
            ))}
          </div>

          <label className="field">
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))}
              placeholder="What is underpriced about this company."
            />
          </label>

          <button className="action-button" type="submit" disabled={saving}>
            {saving ? "Creating..." : "Create company"}
          </button>
        </form>
      ) : null}

      {/* Table */}
      <div className="panel">
        {loading ? (
          <p className="muted">Loading 1,700+ companies...</p>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: "2px solid var(--line)",
                      textAlign: "left"
                    }}
                  >
                    <th
                      style={{ padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                      onClick={() => toggleSort("ticker")}
                    >
                      Ticker{sortArrow("ticker")}
                    </th>
                    <th
                      style={{ padding: "8px 10px", cursor: "pointer" }}
                      onClick={() => toggleSort("name")}
                    >
                      Name{sortArrow("name")}
                    </th>
                    <th
                      style={{ padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                      onClick={() => toggleSort("chainPosition")}
                    >
                      Sector{sortArrow("chainPosition")}
                    </th>
                    <th
                      style={{ padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                      onClick={() => toggleSort("beneficiaryTier")}
                    >
                      Tier{sortArrow("beneficiaryTier")}
                    </th>
                    <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>Exp</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setSelected(c)}
                      style={{
                        borderBottom: "1px solid var(--line)",
                        cursor: "pointer",
                        transition: "background 120ms"
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(180,77,26,0.06)")
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "7px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {c.ticker}
                      </td>
                      <td style={{ padding: "7px 10px" }}>{c.name}</td>
                      <td style={{ padding: "7px 10px", color: "var(--muted)", fontSize: "0.82rem" }}>
                        {c.chainPosition}
                      </td>
                      <td style={{ padding: "7px 10px" }}>
                        <span className="badge" style={{ fontSize: "0.75rem", padding: "3px 8px" }}>
                          {c.beneficiaryTier}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "7px 10px",
                          color: "var(--muted)",
                          fontSize: "0.78rem",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {c.exposure.volume}/{c.exposure.asp}/{c.exposure.margin}/
                        {c.exposure.capacity}/{c.exposure.narrative}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 16,
                fontSize: "0.85rem"
              }}
            >
              <span className="muted">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)}{" "}
                of {filtered.length}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="hero-link"
                  style={{ padding: "6px 14px", fontSize: "0.82rem" }}
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </button>
                <span style={{ lineHeight: "32px" }}>
                  {page + 1} / {totalPages}
                </span>
                <button
                  className="hero-link"
                  style={{ padding: "6px 14px", fontSize: "0.82rem" }}
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
