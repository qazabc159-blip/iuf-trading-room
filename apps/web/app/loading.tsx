export default function Loading() {
  return (
    <main className="page-frame route-loading-shell" aria-busy="true">
      <header className="page-head">
        <div className="page-title">
          <span className="tg page-code">IUF</span>
          <h1>載入戰情資料</h1>
          <span className="tc">切換頁面中</span>
        </div>
        <div className="tg meta-strip">
          <span>資料 / <b className="gold">正式資料</b></span>
          <span>狀態 / <b>同步中</b></span>
        </div>
        <div className="tg session-pill">LOADING</div>
      </header>
      <section className="panel route-loading-panel">
        <div className="route-loading-bars">
          <span />
          <span />
          <span />
        </div>
      </section>
    </main>
  );
}
