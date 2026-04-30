import type { DerivativeRow } from "@/lib/company-adapter";

function badgeClass(state: DerivativeRow["state"]) {
  if (state === "positive") return "badge-green";
  if (state === "negative") return "badge-red";
  return "badge-yellow";
}

export function DerivativesPanel({ rows }: { rows: DerivativeRow[] }) {
  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[08]</span> 期權與借券
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>placeholder · W7 D7 接</span>
      </h3>
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
