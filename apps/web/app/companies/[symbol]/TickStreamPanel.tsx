export function TickStreamPanel() {
  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">逐筆</span> 盤中報價
        <span className="dim" style={{ fontSize: 11, marginLeft: 10 }}>等待 KGI 唯讀資料</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-red">暫停</span>
        <span className="tg soft">處理：KGI 五檔與逐筆唯讀資料</span>
        <span className="state-reason">
          目前沒有正式逐筆或五檔資料來源；正式接上前一律不顯示模擬逐筆，以免誤判盤中流動性。
        </span>
      </div>
    </section>
  );
}
