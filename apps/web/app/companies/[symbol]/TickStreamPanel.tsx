export function TickStreamPanel() {
  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[09]</span> 逐筆成交
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>等待 KGI 唯讀資料契約</span>
      </h3>
      <div className="state-panel">
        <span className="badge badge-red">暫停</span>
        <span className="tg soft">負責人：Jason/Elva。外部卡點：KGI 唯讀五檔與逐筆資料。</span>
        <span className="state-reason">
          目前沒有已驗證的正式逐筆成交端點；舊的固定假資料已移除，避免把生成資料誤認為真實盤中流。
        </span>
      </div>
    </section>
  );
}
