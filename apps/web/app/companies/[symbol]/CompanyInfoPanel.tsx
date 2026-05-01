import type { Company } from "@iuf-trading-room/contracts";

const tierBadge: Record<string, string> = {
  Core: "badge-green",
  Direct: "badge-yellow",
  Indirect: "badge",
  Observation: "badge",
};

const tierLabel: Record<string, string> = {
  Core: "Core",
  Direct: "Direct",
  Indirect: "Indirect",
  Observation: "Observation",
};

function scoreValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function ScoreBar({ value, max = 5 }: { value: number; max?: number }) {
  const filled = scoreValue(value);
  return (
    <span style={{ display: "inline-flex", gap: 2 }} aria-label={`${filled} of ${max}`}>
      {Array.from({ length: max }).map((_, index) => (
        <span
          key={index}
          style={{
            display: "inline-block",
            width: 9,
            height: 9,
            background: index < filled ? "var(--gold, #b8960c)" : "var(--night-rule-strong, #333)",
          }}
        />
      ))}
    </span>
  );
}

function validationTone(value: string) {
  if (/positive|bullish|high|strong/i.test(value)) return "badge-green";
  if (/negative|bearish|low|weak/i.test(value)) return "badge-red";
  return "badge-yellow";
}

function ValidationPill({ label, value }: { label: string; value: string }) {
  const display = value?.trim() || "EMPTY";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)" }}>{label}</span>
      <span className={validationTone(display)} style={{ fontSize: 11, padding: "2px 8px", alignSelf: "flex-start" }}>
        {display}
      </span>
    </div>
  );
}

function Dim({ value }: { value: string | undefined | null }) {
  return <span className="dim">{value?.trim() || "EMPTY"}</span>;
}

export function CompanyInfoPanel({ company }: { company: Company }) {
  const { ticker, name, market, country, chainPosition, beneficiaryTier, exposure, validation, notes } = company;

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[01]</span> COMPANY MASTER
      </h3>

      <dl style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "10px 24px",
        margin: "12px 0",
        padding: 0,
      }}>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 2 }}>TICKER</dt>
          <dd className="mono" style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>{ticker}</dd>
        </div>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 2 }}>COMPANY</dt>
          <dd style={{ margin: 0 }}><Dim value={name} /></dd>
        </div>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 2 }}>MARKET</dt>
          <dd style={{ margin: 0 }}><Dim value={market} /></dd>
        </div>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 2 }}>COUNTRY</dt>
          <dd style={{ margin: 0 }}><Dim value={country} /></dd>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 4 }}>CHAIN POSITION</dt>
          <dd style={{ margin: 0, fontFamily: "var(--mono, monospace)", fontSize: 12 }}><Dim value={chainPosition} /></dd>
        </div>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 4 }}>BENEFICIARY TIER</dt>
          <dd style={{ margin: 0 }}>
            <span className={tierBadge[beneficiaryTier] ?? "badge"} style={{ fontSize: 11, padding: "2px 8px" }}>
              {tierLabel[beneficiaryTier] ?? beneficiaryTier}
            </span>
          </dd>
        </div>
      </dl>

      <div style={{ borderTop: "1px solid var(--night-rule, #222)", paddingTop: 12, marginTop: 4 }}>
        <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 8, letterSpacing: "0.12em" }}>
          EXPOSURE BREAKDOWN / SOURCE: COMPANY MASTER
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(
            [
              ["VOLUME", exposure.volume],
              ["ASP", exposure.asp],
              ["MARGIN", exposure.margin],
              ["CAPACITY", exposure.capacity],
              ["NARRATIVE", exposure.narrative],
            ] as [string, number][]
          ).map(([label, value]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", width: 72, flexShrink: 0 }}>{label}</span>
              <ScoreBar value={value} />
              <span className="tg" style={{ fontSize: 11, color: "var(--gold, #b8960c)", minWidth: 16 }}>{scoreValue(value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--night-rule, #222)", paddingTop: 12, marginTop: 12 }}>
        <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 8, letterSpacing: "0.12em" }}>
          VALIDATION SNAPSHOT / SOURCE: COMPANY MASTER
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <ValidationPill label="CAPITAL FLOW" value={validation.capitalFlow} />
          <ValidationPill label="CONSENSUS" value={validation.consensus} />
          <ValidationPill label="RELATIVE STRENGTH" value={validation.relativeStrength} />
        </div>
      </div>

      {notes && notes.trim() && (
        <div style={{ borderTop: "1px solid var(--night-rule, #222)", paddingTop: 12, marginTop: 12 }}>
          <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 6, letterSpacing: "0.12em" }}>
            NOTES / SOURCE: COMPANY MASTER
          </div>
          <pre style={{
            whiteSpace: "pre-wrap",
            fontFamily: "var(--mono, monospace)",
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--night-ink, #d8d4c8)",
            margin: 0,
          }}>
            {notes}
          </pre>
        </div>
      )}
    </section>
  );
}
