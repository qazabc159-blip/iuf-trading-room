export function TickStreamPanel() {
  return (
    <section className="panel hud-frame company-intel-panel company-secondary-status-panel company-tick-console">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">逐筆</span> 盤中報價
        <span className="dim" style={{ fontSize: 11, marginLeft: 10 }}>等待 KGI 唯讀資料</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-red">BLOCKED</span>
        <span className="tg soft">資料源：KGI gateway /api/v1/kgi/quote/ticks</span>
        <span className="state-reason">
          目前尚未取得正式逐筆盤中資料；此面板不補假成交明細。Owner: Jason/Bruce。下一步：確認 KGI 唯讀 gateway 覆蓋與 owner session 後啟用。
        </span>
      </div>
    </section>
  );
}
