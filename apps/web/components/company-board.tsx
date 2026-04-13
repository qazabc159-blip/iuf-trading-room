"use client";

import { useEffect, useState } from "react";

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

export function CompanyBoard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [themeOptions, setThemeOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<CompanyCreateInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await createCompany(form);
      setCompanies((current) => [response.data, ...current]);
      setForm(initialForm);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create company.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="board-grid">
      <div className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Coverage</p>
            <h3>Companies</h3>
          </div>
          <div className="metric-chip">
            <span>{companies.length}</span>
            <small>Tracked</small>
          </div>
        </div>

        {loading ? <p className="muted">Loading companies...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="card-stack">
          {companies.map((company) => (
            <article key={company.id} className="record-card">
              <div className="record-topline">
                <strong>
                  {company.name} <span className="muted">({company.ticker})</span>
                </strong>
                <span className="badge">{company.beneficiaryTier}</span>
              </div>
              <p className="record-meta">
                {company.market} · {company.country} · {company.chainPosition}
              </p>
              <p>{company.notes}</p>
              <p className="muted">
                Exposure {company.exposure.volume}/{company.exposure.asp}/{company.exposure.margin}/
                {company.exposure.capacity}/{company.exposure.narrative}
              </p>
            </article>
          ))}
        </div>
      </div>

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
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Acme Optics Taiwan"
            />
          </label>
          <label className="field">
            <span>Ticker</span>
            <input
              value={form.ticker}
              onChange={(event) => setForm((current) => ({ ...current, ticker: event.target.value }))}
              placeholder="6801"
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Market</span>
            <input
              value={form.market}
              onChange={(event) => setForm((current) => ({ ...current, market: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Country</span>
            <input
              value={form.country}
              onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
            />
          </label>
        </div>

        <label className="field">
          <span>Theme</span>
          <select
            value={form.themeIds[0] ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                themeIds: event.target.value ? [event.target.value] : []
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

        <label className="field">
          <span>Chain position</span>
          <input
            value={form.chainPosition}
            onChange={(event) =>
              setForm((current) => ({ ...current, chainPosition: event.target.value }))
            }
            placeholder="Optical module supplier"
          />
        </label>

        <label className="field">
          <span>Beneficiary tier</span>
          <select
            value={form.beneficiaryTier}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                beneficiaryTier: event.target.value as BeneficiaryTier
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

        <div className="score-grid">
          {exposureKeys.map((key) => (
            <label key={key} className="field">
              <span>{key}</span>
              <input
                type="number"
                min={1}
                max={5}
                value={form.exposure[key]}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    exposure: {
                      ...current.exposure,
                      [key]: Number(event.target.value)
                    }
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
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            placeholder="What is underpriced about this company."
          />
        </label>

        <button className="action-button" type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create company"}
        </button>
      </form>
    </section>
  );
}
