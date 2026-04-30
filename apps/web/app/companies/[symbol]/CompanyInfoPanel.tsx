import type { CompanyDetailView, ValidationState } from "@/lib/company-adapter";

function badgeClass(state: ValidationState) {
  if (state === "positive") return "badge-green";
  if (state === "negative") return "badge-red";
  return "badge-yellow";
}

function validationLabel(state: ValidationState) {
  if (state === "positive") return "正向";
  if (state === "negative") return "負向";
  return "待觀察";
}

function ExposureBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="exposure-bar">
      <span className="tg soft">{label}</span>
      <div className="bar" aria-label={`${label} ${value}/5`}><span style={{ width: `${Math.max(0, Math.min(5, value)) * 20}%` }} /></div>
      <b className="num">{value}/5</b>
    </div>
  );
}

export function CompanyInfoPanel({ company }: { company: CompanyDetailView }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">CMP-INF</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">公司基本資料</span>
          <div className="panel-sub">view-model adapter output</div>
        </div>
        <div className="tg soft">{company.id}</div>
      </div>

      <div className="company-info-panel">
        <dl className="company-dl">
          <div><dt>公司</dt><dd>{company.name} {company.nameEn ? `(${company.nameEn})` : ""}</dd></div>
          <div><dt>代號</dt><dd className="num">{company.ticker}</dd></div>
          <div><dt>市場</dt><dd>{company.market} / {company.country}</dd></div>
          <div><dt>市值</dt><dd className="num">{company.marketCapBn?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "--"} BN</dd></div>
          <div><dt>鏈位</dt><dd><span className="badge badge-blue">{company.chainPosition}</span></dd></div>
          <div><dt>受益層</dt><dd><span className="badge badge-yellow">{company.beneficiaryTier}</span></dd></div>
        </dl>

        <div className="company-notes">
          <div className="tg gold">NOTES</div>
          <p className="tc">{company.notes}</p>
        </div>

        <div className="company-info-grid">
          <div>
            <div className="tg gold">EXPOSURE</div>
            <ExposureBar label="Volume" value={company.exposure.volume} />
            <ExposureBar label="ASP" value={company.exposure.asp} />
            <ExposureBar label="Margin" value={company.exposure.margin} />
            <ExposureBar label="Capacity" value={company.exposure.capacity} />
            <ExposureBar label="Narrative" value={company.exposure.narrative} />
          </div>
          <div>
            <div className="tg gold">VALIDATION</div>
            <div className="validation-grid">
              <span className={`badge ${badgeClass(company.validation.capitalFlow)}`}>資金 {validationLabel(company.validation.capitalFlow)}</span>
              <span className={`badge ${badgeClass(company.validation.consensus)}`}>共識 {validationLabel(company.validation.consensus)}</span>
              <span className={`badge ${badgeClass(company.validation.relativeStrength)}`}>相對強度 {validationLabel(company.validation.relativeStrength)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

