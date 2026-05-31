export default function TradingRoomKlineFrameLoading() {
  return (
    <main className="trading-room-real-kline-frame">
      <style>{loadingCss}</style>
      <div className="kline-frame-note">
        <span>交易室 K 線正在讀取真實資料</span>
        <b>OHLCV / FinMind 分 K / 量價指標</b>
      </div>
      <section className="kline-loading-panel" role="status" aria-live="polite">
        <div>
          <b>正在建立 K 線圖</b>
          <span>讀取公司日線、分 K 與量價支撐壓力；載入完成前不顯示假線。</span>
        </div>
      </section>
    </main>
  );
}

const loadingCss = `
  html,
  body {
    margin: 0;
    height: 100%;
    min-height: 100%;
    background: #080b10;
    color: #d7dde8;
    overflow: hidden;
  }

  .trading-room-real-kline-frame {
    box-sizing: border-box;
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    background: #080b10;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .kline-frame-note {
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 12px;
    border: 1px solid rgba(216, 166, 74, 0.22);
    border-radius: 6px 6px 0 0;
    background: rgba(216, 166, 74, 0.07);
    color: #9aa7ba;
    font: 800 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .kline-frame-note b {
    color: #f0bd62;
    font-size: 12px;
  }

  .kline-loading-panel {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    place-items: center;
    border: 1px solid rgba(220, 228, 240, 0.08);
    border-top: 0;
    background:
      linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px),
      #080b10;
    background-size: 74px 74px, 74px 74px, auto;
    color: #9aa7ba;
    font: 800 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace;
    text-align: center;
  }

  .kline-loading-panel div {
    width: min(520px, calc(100vw - 48px));
    padding: 22px;
    border: 1px solid rgba(216, 166, 74, 0.24);
    border-radius: 8px;
    background: rgba(10, 16, 24, 0.82);
  }

  .kline-loading-panel b {
    display: block;
    color: #f0bd62;
    font-size: 15px;
    margin-bottom: 6px;
  }
`;
