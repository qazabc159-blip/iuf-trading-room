import type { TickRow } from "@/lib/company-adapter";

export function TickStreamPanel({ rows }: { rows: TickRow[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">TIK</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">逐筆成交</span>
          <div className="panel-sub">KGI live stream placeholder</div>
        </div>
        <div className="tg soft">{rows.length} ticks</div>
      </div>
      <div className="company-data-table">
        <div className="row tick-row table-head">
          <span>時間</span><span>成交</span><span>張數</span><span>方向</span>
        </div>
        {rows.map((row, index) => (
          <div className="row tick-row" key={`${row.ts}-${index}`}>
            <span className="tg soft">{row.ts}</span>
            <span className={`num ${row.side === "B" ? "up" : "down"}`}>{row.price.toFixed(2)}</span>
            <span className="num">{row.qty}</span>
            <span className={`badge ${row.side === "B" ? "badge-red" : "badge-green"}`}>{row.side === "B" ? "買盤" : "賣盤"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

