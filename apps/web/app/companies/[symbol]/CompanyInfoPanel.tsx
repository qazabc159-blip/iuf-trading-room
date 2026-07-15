import type { Company } from "@iuf-trading-room/contracts";
import { industryLabel } from "@/lib/industry-i18n";

const tierBadge: Record<string, string> = {
  Core: "badge-green",
  Direct: "badge-yellow",
  Indirect: "badge",
  Observation: "badge",
};

const tierLabel: Record<string, string> = {
  Core: "核心受惠",
  Direct: "直接受惠",
  Indirect: "間接受惠",
  Observation: "觀察",
};

const exposureLabel: Record<string, string> = {
  volume: "量能",
  asp: "均價",
  margin: "毛利",
  capacity: "產能",
  narrative: "敘事",
};

const marketLabel: Record<string, string> = {
  TWSE: "上市",
  TPEX: "上櫃",
  OTC: "上櫃",
};

const countryLabel: Record<string, string> = {
  TW: "台灣",
  Taiwan: "台灣",
};

function scoreValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function scoreTone(value: number) {
  const score = scoreValue(value);
  if (score >= 4) return "偏強";
  if (score <= 1) return "觀察";
  return "中性";
}

function ScoreBar({ value, max = 5 }: { value: number; max?: number }) {
  const filled = scoreValue(value);
  return (
    <span className="score-bar company-score-meter" aria-label={`${filled} / ${max}`}>
      {Array.from({ length: max }).map((_, index) => (
        <span key={index} data-filled={index < filled} />
      ))}
    </span>
  );
}

function isMissing(value: string | undefined | null) {
  const normalized = value?.trim();
  return !normalized || /^(n\/a|na|--|null)$/i.test(normalized);
}

function validationTone(value: string) {
  if (isMissing(value)) return "badge";
  if (/positive|bullish|high|strong|偏強|正向|pass|ready|live/i.test(value)) return "badge-green";
  if (/negative|bearish|low|weak|偏弱|負向|fail|blocked|error/i.test(value)) return "badge-red";
  return "badge-yellow";
}

function validationLabel(value: string) {
  const trimmed = value?.trim();
  if (!trimmed || /^(n\/a|na|--|null)$/i.test(trimmed)) return "尚未接資料";
  if (/positive|bullish|strong/i.test(trimmed)) return "偏多";
  if (/negative|bearish|weak/i.test(trimmed)) return "偏空";
  if (/neutral/i.test(trimmed)) return "中性";
  if (/pending/i.test(trimmed)) return "待驗證";
  return trimmed;
}

function ValidationPill({ label, value }: { label: string; value: string }) {
  const display = validationLabel(value);
  return (
    <div className="validation-pill company-validation-pill">
      <span>{label}</span>
      <b className={validationTone(value)}>{display}</b>
    </div>
  );
}

function TextValue({ value }: { value: string | undefined | null }) {
  const normalized = value?.trim();
  if (!normalized || /^(n\/a|na|--|null)$/i.test(normalized)) {
    return <span className="dim">尚未接資料</span>;
  }
  return <span>{normalized}</span>;
}

function translateNoteLine(line: string) {
  const [rawLabel, ...rest] = line.split(":");
  if (rest.length === 0) return line;
  const label = rawLabel.trim();
  const value = rest.join(":").trim();
  const translatedLabel: Record<string, string> = {
    Sector: "產業",
    Industry: "產業分類",
    "Market Cap": "市值",
    "Enterprise Value": "企業價值",
  };

  if (label === "Sector" || label === "Industry") {
    return `${translatedLabel[label]}：${industryLabel(value)}`;
  }

  return `${translatedLabel[label] ?? label}：${value}`;
}

function translateNotes(value: string) {
  return value.split(/\r?\n/).map(translateNoteLine).join("\n");
}

export function CompanyInfoPanel({ company }: { company: Company }) {
  const { ticker, name, market, country, chainPosition, beneficiaryTier, exposure, validation, notes } = company;
  const validationFields: Array<{ label: string; value: string }> = [
    { label: "資金流", value: validation.capitalFlow },
    { label: "市場共識", value: validation.consensus },
    { label: "相對強弱", value: validation.relativeStrength },
  ].filter((field) => !isMissing(field.value));
  const chainLabel = industryLabel(chainPosition);
  const tier = tierLabel[beneficiaryTier] ?? beneficiaryTier;
  const marketName = marketLabel[market] ?? market;
  const countryName = countryLabel[country] ?? country;

  return (
    <section className="panel hud-frame company-info-panel company-info-card">
      <div className="company-info-titlebar">
        <span className="ascii-head-bracket">[01]</span>
        <div>
          <h3>公司主檔</h3>
          <p>公司資料庫 / 產業分類 / 驗證狀態</p>
        </div>
      </div>

      <div className="company-info-identity" aria-label={`${ticker} ${name}`}>
        <div>
          <span className="company-info-eyebrow">代號</span>
          <b className="mono">{ticker}</b>
        </div>
        <div className="company-info-name">
          <strong>{name}</strong>
          <span>{chainLabel}</span>
        </div>
        <div className="company-info-tags">
          <span className="badge">{marketName}</span>
          <span className={tierBadge[beneficiaryTier] ?? "badge"}>{tier}</span>
        </div>
      </div>

      <dl className="company-info-grid company-info-grid-compact">
        <div>
          <dt>市場</dt>
          <dd>{marketName}</dd>
        </div>
        <div>
          <dt>國別</dt>
          <dd>{countryName}</dd>
        </div>
        <div>
          <dt>產業鏈位置</dt>
          <dd><TextValue value={chainLabel} /></dd>
        </div>
        <div>
          <dt>受惠層級</dt>
          <dd>{tier}</dd>
        </div>
      </dl>

      <div className="company-info-section company-info-section-compact">
        <div className="company-info-label-row">
          <span>產業受惠拆解</span>
          <b>來源：公司主檔分類</b>
        </div>
        <div className="company-score-list company-score-list-compact">
          {(
            [
              ["volume", exposure.volume],
              ["asp", exposure.asp],
              ["margin", exposure.margin],
              ["capacity", exposure.capacity],
              ["narrative", exposure.narrative],
            ] as [keyof typeof exposureLabel, number][]
          ).map(([label, value]) => (
            <div key={label} className="company-score-row company-score-row-compact">
              <span>{exposureLabel[label]}</span>
              <ScoreBar value={value} />
              <b>{scoreValue(value)}</b>
              <em>{scoreTone(value)}</em>
            </div>
          ))}
        </div>
      </div>

      {validationFields.length > 0 && (
        <div className="company-info-section company-info-section-compact">
          <div className="company-info-label-row">
            <span>驗證欄位</span>
            <b>缺資料會明確標示</b>
          </div>
          <div className="validation-grid company-validation-grid">
            {validationFields.map((field) => (
              <ValidationPill key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        </div>
      )}

      {notes && notes.trim() && (
        <div className="company-info-section company-info-section-compact">
          <div className="company-info-label-row">
            <span>備註</span>
            <b>來源：公司主檔</b>
          </div>
          <pre className="company-notes company-notes-compact">{translateNotes(notes)}</pre>
        </div>
      )}
    </section>
  );
}
