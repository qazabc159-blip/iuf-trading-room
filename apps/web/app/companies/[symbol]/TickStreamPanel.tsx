export function TickStreamPanel() {
  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[09]</span> TICK STREAM
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>KGI read contract pending</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-red">BLOCKED</span>
        <span className="tg soft">Owner: Jason/Elva. External blocker: KGI readonly bid/ask + tick availability.</span>
        <span className="state-reason">
          No verified production tick endpoint is ready. The old deterministic tick tape has been removed so
          operators do not mistake generated rows for live market flow.
        </span>
      </div>
    </section>
  );
}
