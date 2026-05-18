export function DerivativesPanel() {
  return (
    <section className="panel hud-frame company-intel-panel company-secondary-status-panel company-derivatives-console">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">衍生品</span> 權證與選擇權
        <span className="dim" style={{ fontSize: 11, marginLeft: 10 }}>COMING_SOON_DISABLED</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-yellow">未啟用</span>
        <span className="tg soft">資料源尚未接入：TWSE warrant / broker feed / external provider</span>
        <span className="state-reason">
          此區不顯示假權證或假選擇權資料。Owner: Jason。下一步：接正式權證/選擇權資料源後再啟用，不影響公司基本資料與交易室。
        </span>
      </div>
    </section>
  );
}
