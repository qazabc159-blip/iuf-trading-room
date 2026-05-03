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

function scoreValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function ScoreBar({ value, max = 5 }: { value: number; max?: number }) {
  const filled = scoreValue(value);
  return (
    <span className="score-bar" aria-label={`${filled} / ${max}`}>
      {Array.from({ length: max }).map((_, index) => (
        <span key={index} data-filled={index < filled} />
      ))}
    </span>
  );
}

function validationTone(value: string) {
  if (/positive|bullish|high|strong|偏強|正向/i.test(value)) return "badge-green";
  if (/negative|bearish|low|weak|偏弱|負向/i.test(value)) return "badge-red";
  return "badge-yellow";
}

function validationLabel(value: string) {
  const trimmed = value?.trim();
  if (!trimmed || /^(n\/a|na|--|null)$/i.test(trimmed)) return "尚未接資料";
  if (/positive|bullish|strong/i.test(trimmed)) return "偏多";
  if (/negative|bearish|weak/i.test(trimmed)) return "偏空";
  if (/neutral/i.test(trimmed)) return "中性";
  return trimmed;
}

function ValidationPill({ label, value }: { label: string; value: string }) {
  const display = validationLabel(value);
  return (
    <div className="validation-pill">
      <span>{label}</span>
      <b className={validationTone(display)}>{display}</b>
    </div>
  );
}

function isMissingValidation(value: string | undefined | null) {
  const normalized = value?.trim();
  return !normalized || /^(n\/a|na|--|null)$/i.test(normalized);
}

function Dim({ value }: { value: string | undefined | null }) {
  const normalized = value?.trim();
  if (!normalized || /^(n\/a|na|--|null)$/i.test(normalized)) {
    return <span className="dim">尚未接資料</span>;
  }
  return <span className="dim">{normalized}</span>;
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
  const validationMissing = [
    validation.capitalFlow,
    validation.consensus,
    validation.relativeStrength,
  ].every(isMissingValidation);

  return (
    <section className="panel hud-frame company-info-panel">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">公司主檔</span>
        基本資料
      </h3>

      <dl className="company-info-grid">
        <div>
          <dt>代號</dt>
          <dd className="mono strong">{ticker}</dd>
        </div>
        <div>
          <dt>公司名稱</dt>
          <dd><Dim value={name} /></dd>
        </div>
        <div>
          <dt>市場</dt>
          <dd><Dim value={marketLabel[market] ?? market} /></dd>
        </div>
        <div>
          <dt>國別</dt>
          <dd><Dim value={country} /></dd>
        </div>
        <div>
          <dt>產業鏈位置</dt>
          <dd><Dim value={industryLabel(chainPosition)} /></dd>
        </div>
        <div>
          <dt>受惠層級</dt>
          <dd>
            <span className={tierBadge[beneficiaryTier] ?? "badge"}>
              {tierLabel[beneficiaryTier] ?? beneficiaryTier}
            </span>
          </dd>
        </div>
      </dl>

      <div className="company-info-section">
        <div className="company-info-label">產業受惠拆解 / 來源：公司主檔分類</div>
        <div className="company-score-list">
          {(
            [
              ["volume", exposure.volume],
              ["asp", exposure.asp],
              ["margin", exposure.margin],
              ["capacity", exposure.capacity],
              ["narrative", exposure.narrative],
            ] as [keyof typeof exposureLabel, number][]
          ).map(([label, value]) => (
            <div key={label} className="company-score-row">
              <span>{exposureLabel[label]}</span>
              <ScoreBar value={value} />
              <b>{scoreValue(value)}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="company-info-section">
        <div className="company-info-label">驗證欄位 / 來源：公司主檔；尚未接資料會明確標示</div>
        {validationMissing ? (
          <div className="company-inline-empty">
            公司主檔尚未提供資金流、市場共識與相對強弱。此區等 FinMind 籌碼與策略驗證接上後才會顯示結論。
          </div>
        ) : (
          <div className="validation-grid">
            <ValidationPill label="資金流" value={validation.capitalFlow} />
            <ValidationPill label="市場共識" value={validation.consensus} />
            <ValidationPill label="相對強弱" value={validation.relativeStrength} />
          </div>
        )}
      </div>

      {notes && notes.trim() && (
        <div className="company-info-section">
          <div className="company-info-label">備註 / 來源：公司主檔</div>
          <pre className="company-notes">{translateNotes(notes)}</pre>
        </div>
      )}
    </section>
  );
}
