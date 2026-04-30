// CompanyInfoPanel.tsx — Server Component
// Renders contracts-shape Company fields: basic info, chain tier badge,
// exposure breakdown bars (5 dims), validation snapshot pills.
// No RADAR fields (symbol / score / momentum / etc) — those are RADAR-only.

import type { Company } from "@iuf-trading-room/contracts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const tierBadge: Record<string, string> = {
  Core:        "badge-green",
  Direct:      "badge-yellow",
  Indirect:    "badge",
  Observation: "badge",
};

const tierLabel: Record<string, string> = {
  Core:        "核心受益",
  Direct:      "直接受益",
  Indirect:    "間接受益",
  Observation: "觀察",
};

/** Render a 1-5 score as a small block-bar row (5 blocks, filled = gold). */
function ScoreBar({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 9,
            height: 9,
            background: i < value ? "var(--gold, #b8960c)" : "var(--night-rule-strong, #333)",
          }}
        />
      ))}
    </span>
  );
}

/** capitalFlow / consensus / relativeStrength status pill */
function ValidationPill({ label, value }: { label: string; value: string }) {
  const isPositive = /positive|bullish|high|strong|上|多/i.test(value);
  const isNegative = /negative|bearish|low|weak|下|空/i.test(value);
  const cls = isPositive ? "badge-green" : isNegative ? "badge-red" : "badge-yellow";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)" }}>{label}</span>
      <span className={cls} style={{ fontSize: 11, padding: "2px 8px", alignSelf: "flex-start" }}>
        {value || "—"}
      </span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function CompanyInfoPanel({ company }: { company: Company }) {
  const { ticker, name, market, country, chainPosition, beneficiaryTier, exposure, validation, notes } = company;

  const dim = (v: string | undefined | null) => (
    <span className="dim">{v || "—"}</span>
  );

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[01]</span> 公司基本資料
      </h3>

      {/* Basic info grid */}
      <dl style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "10px 24px",
        margin: "12px 0",
        padding: 0,
      }}>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 2 }}>股票代號</dt>
          <dd className="mono" style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>{ticker}</dd>
        </div>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 2 }}>公司名稱</dt>
          <dd style={{ margin: 0 }}>{dim(name)}</dd>
        </div>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 2 }}>市場</dt>
          <dd style={{ margin: 0 }}>{dim(market)}</dd>
        </div>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 2 }}>國別</dt>
          <dd style={{ margin: 0 }}>{dim(country)}</dd>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 4 }}>產業鏈位置</dt>
          <dd style={{ margin: 0, fontFamily: "var(--mono, monospace)", fontSize: 12 }}>{dim(chainPosition)}</dd>
        </div>
        <div>
          <dt className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 4 }}>受益層級</dt>
          <dd style={{ margin: 0 }}>
            <span className={tierBadge[beneficiaryTier] ?? "badge"} style={{ fontSize: 11, padding: "2px 8px" }}>
              {tierLabel[beneficiaryTier] ?? beneficiaryTier}
            </span>
          </dd>
        </div>
      </dl>

      {/* Exposure breakdown */}
      <div style={{ borderTop: "1px solid var(--night-rule, #222)", paddingTop: 12, marginTop: 4 }}>
        <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 8, letterSpacing: "0.12em" }}>
          EXPOSURE BREAKDOWN (1–5)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(
            [
              ["VOLUME",    exposure.volume],
              ["ASP",       exposure.asp],
              ["MARGIN",    exposure.margin],
              ["CAPACITY",  exposure.capacity],
              ["NARRATIVE", exposure.narrative],
            ] as [string, number][]
          ).map(([label, val]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", width: 72, flexShrink: 0 }}>{label}</span>
              <ScoreBar value={val} />
              <span className="tg" style={{ fontSize: 11, color: "var(--gold, #b8960c)", minWidth: 16 }}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Validation snapshot */}
      <div style={{ borderTop: "1px solid var(--night-rule, #222)", paddingTop: 12, marginTop: 12 }}>
        <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 8, letterSpacing: "0.12em" }}>
          VALIDATION SNAPSHOT
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <ValidationPill label="CAPITAL FLOW"      value={validation.capitalFlow} />
          <ValidationPill label="CONSENSUS"         value={validation.consensus} />
          <ValidationPill label="RELATIVE STRENGTH" value={validation.relativeStrength} />
        </div>
      </div>

      {/* Notes */}
      {notes && notes.trim() && (
        <div style={{ borderTop: "1px solid var(--night-rule, #222)", paddingTop: 12, marginTop: 12 }}>
          <div className="tg" style={{ fontSize: 10, color: "var(--night-mid, #888)", marginBottom: 6, letterSpacing: "0.12em" }}>
            NOTES
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
