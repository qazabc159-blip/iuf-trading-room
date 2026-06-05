export function DerivativesPanel() {
  return (
    <section className="panel hud-frame company-intel-panel company-secondary-status-panel company-derivatives-console">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">衍生品</span> 權證與選擇權
        <span className="dim" style={{ fontSize: 11, marginLeft: 10 }}>即將推出</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-yellow">未啟用</span>
        <span className="tg soft">資料源尚未接入：權證 / 選擇權正式資料源</span>
        <span className="state-reason">
          此區不會用假資料冒充可交易權證或選擇權。接入正式權證與選擇權資料後，會提供履約價、
          到期日、隱含波動率、價內外程度與流動性警示。目前公司基本資料、K 線、重大訊息與交易室
          正股功能不受影響。
        </span>
      </div>
    </section>
  );
}
