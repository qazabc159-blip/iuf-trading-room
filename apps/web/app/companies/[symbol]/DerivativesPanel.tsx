export function DerivativesPanel() {
  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[08]</span> 衍生商品曝險
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>合約未開通</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-red">暫停</span>
        <span className="tg soft">負責：Jason / Elva</span>
        <span className="state-reason">
          目前還沒有正式的衍生商品曝險端點，所以這裡先明確暫停，不用假資料填表。
        </span>
      </div>
    </section>
  );
}
