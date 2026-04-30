import type { DerivativeRow } from "@/lib/company-adapter";

function badgeClass(state: DerivativeRow["state"]) {
  if (state === "positive") return "badge-green";
  if (state === "negative") return "badge-red";
  return "badge-yellow";
}

export function DerivativesPanel({ rows }: { rows: DerivativeRow[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">DRV</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">期權與借券</span>
          <div className="panel-sub">W7 D7 placeholder</div>
        </div>
        <div className="tg soft">gated</div>
      </div>
      <div className="placeholder-panel">
        {rows.map((row) => (
          <div className="row placeholder-row" key={row.label}>
            <span className="tg">{row.label}</span>
            <span className={`badge ${badgeClass(row.state)}`}>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

