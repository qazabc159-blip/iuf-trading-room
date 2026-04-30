export function DerivativesPanel() {
  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[08]</span> DERIVATIVES
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>contract pending</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-red">BLOCKED</span>
        <span className="tg soft">Owner: Jason/Elva.</span>
        <span className="state-reason">
          No production endpoint contract exists for derivatives exposure yet. This panel is intentionally
          blocked instead of rendering synthetic validation rows.
        </span>
      </div>
    </section>
  );
}
