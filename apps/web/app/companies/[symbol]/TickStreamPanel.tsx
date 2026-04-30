import type { TickRow } from "@/lib/company-adapter";

export function TickStreamPanel({ rows }: { rows: TickRow[] }) {
  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[09]</span> 逐筆成交
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>{rows.length} ticks · KGI live placeholder</span>
      </h3>
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
