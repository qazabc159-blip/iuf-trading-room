export function DerivativesPanel() {
  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">衍生品</span> 權證與選擇權
        <span className="dim" style={{ fontSize: 11, marginLeft: 10 }}>待正式資料</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-red">暫停</span>
        <span className="tg soft">處理：衍生品唯讀資料管線</span>
        <span className="state-reason">
          目前尚未接上正式權證、期權或借券資料；此區不顯示假資料，也不提供任何交易動作。
        </span>
      </div>
    </section>
  );
}
