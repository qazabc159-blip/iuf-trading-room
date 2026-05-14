"use client";

import { useMemo, useState } from "react";

import { formatKgiSimOrderError, submitKgiSimOrder } from "@/lib/paper-orders-api";
import type { QuantStrategy, StrategyCurvePoint } from "../strategy-data";
import styles from "../QuantStrategies.module.css";

function accentColor(accent: QuantStrategy["accent"]) {
  if (accent === "cyan") return "#5cc8ff";
  if (accent === "green") return "#58d68d";
  return "#e2b85c";
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function money(value: number) {
  return Math.round(value).toLocaleString("zh-TW");
}

const MIN_SIM_CAPITAL = 50_000;
const MAX_SIM_CAPITAL = 1_000_000;

function LineChart({ points, color }: { points: StrategyCurvePoint[]; color: string }) {
  const width = 760;
  const height = 230;
  const pad = 24;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const coords = points.map((p, index) => {
    const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((p.value - min) / range) * (height - pad * 2);
    return { x, y, p };
  });
  const line = coords.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} ${coords.at(-1)?.x ?? pad},${height - pad} ${pad},${height - pad}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="230" role="img" aria-label="累積報酬曲線">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="rgba(220,228,240,.14)" />
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map(({ x, y, p }) => (
        <g key={`${p.date}-${p.value}`}>
          <circle cx={x} cy={y} r="3" fill={color} />
        </g>
      ))}
      <text x={pad} y={18} fill="#91a0b5" fontSize="12" fontFamily="monospace">累積報酬</text>
      <text x={width - pad} y={18} fill="#91a0b5" fontSize="12" fontFamily="monospace" textAnchor="end">
        {pct(points.at(-1)?.value ?? 0)}
      </text>
    </svg>
  );
}

function BarChart({ points, color }: { points: StrategyCurvePoint[]; color: string }) {
  const width = 760;
  const height = 220;
  const pad = 24;
  const values = points.map((p) => p.value);
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1);
  const zeroY = height / 2;
  const barW = (width - pad * 2) / points.length - 6;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="220" role="img" aria-label="分期報酬長條圖">
      <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="rgba(220,228,240,.14)" />
      {points.map((p, index) => {
        const x = pad + index * ((width - pad * 2) / points.length) + 3;
        const h = Math.abs(p.value) / maxAbs * (height / 2 - pad);
        const y = p.value >= 0 ? zeroY - h : zeroY;
        return (
          <g key={`${p.date}-${p.value}`}>
            <rect x={x} y={y} width={barW} height={h} rx="4" fill={p.value >= 0 ? color : "#e63946"} opacity="0.82" />
          </g>
        );
      })}
      <text x={pad} y={18} fill="#91a0b5" fontSize="12" fontFamily="monospace">每期淨報酬</text>
    </svg>
  );
}

function BasketLauncher({ strategy, color }: { strategy: QuantStrategy; color: string }) {
  const [capital, setCapital] = useState("100000");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const budget = useMemo(() => Number(capital.replace(/,/g, "")), [capital]);
  const capitalValid = Number.isFinite(budget) && budget >= MIN_SIM_CAPITAL && budget <= MAX_SIM_CAPITAL;
  const capitalMessage = !Number.isFinite(budget) || budget <= 0
    ? "請輸入投入金額。"
    : budget < MIN_SIM_CAPITAL
      ? `投入金額需至少 ${money(MIN_SIM_CAPITAL)} TWD。`
      : budget > MAX_SIM_CAPITAL
        ? `投入金額不可超過 ${money(MAX_SIM_CAPITAL)} TWD。`
        : null;

  const preview = useMemo(() => {
    if (!Number.isFinite(budget) || budget <= 0) return [];
    return strategy.holdings.map((holding) => {
      const target = budget * holding.weight;
      const qty = Math.floor(target / holding.price);
      return {
        ...holding,
        target,
        qty,
        notional: qty * holding.price,
      };
    });
  }, [budget, strategy.holdings]);

  const executable = preview.filter((row) => row.qty > 0);
  const totalNotional = executable.reduce((sum, row) => sum + row.notional, 0);

  async function submitBasket() {
    if (!confirmed || busy || executable.length === 0 || !capitalValid) return;
    setBusy(true);
    setResult(null);
    setError(null);
    const accepted: string[] = [];
    try {
      for (const row of executable) {
        const res = await submitKgiSimOrder({
          symbol: row.symbol,
          side: "buy",
          qty: row.qty,
          price: row.price,
          orderType: "limit",
          quantityUnit: "SHARE",
        });
        accepted.push(`${row.symbol}:${res.data.status}`);
      }
      setResult(`KGI SIM 已送出 ${accepted.length} 檔；估計名目金額 ${money(totalNotional)} TWD。`);
      setConfirmOpen(false);
    } catch (err) {
      setError(formatKgiSimOrderError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={styles.launcher} style={{ "--accent": color } as React.CSSProperties}>
      <h2>SIM 資金配置</h2>
      <p className={styles.sub} style={{ margin: "0 0 12px", fontSize: 13 }}>
        送往 KGI SIM，正式帳戶寫入封鎖。下方會依目前籃子價格換算股數。
      </p>
      <label htmlFor="capital" className={styles.eyebrow}>CAPITAL TWD / 50,000 - 1,000,000</label>
      <input
        id="capital"
        className={styles.input}
        inputMode="numeric"
        value={capital}
        onChange={(event) => setCapital(event.target.value.replace(/[^\d]/g, ""))}
      />
      {capitalMessage && <div className={`${styles.notice} ${styles.error}`} style={{ marginTop: 10 }}>{capitalMessage}</div>}

      <div className={styles.previewList}>
        {preview.map((row) => (
          <div className={styles.previewRow} key={row.symbol}>
            <strong>{row.symbol}</strong>
            <span>{row.qty > 0 ? `${row.qty.toLocaleString("zh-TW")} 股` : "資金不足略過"}</span>
            <span className={styles.num}>{money(row.notional)}</span>
          </div>
        ))}
      </div>

      <div className={styles.notice}>
        預估送出 {executable.length} / {strategy.holdings.length} 檔，名目金額 {money(totalNotional)} TWD。
      </div>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 0", color: "#cdd5df", fontSize: 13 }}>
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        我確認這次只送 KGI SIM，不寫入正式券商帳戶。
      </label>

      <button
        className={styles.button}
        type="button"
        disabled={!confirmed || busy || executable.length === 0 || !capitalValid}
        onClick={() => setConfirmOpen(true)}
      >
        {busy ? "送出中" : "確認 SIM 訂閱"}
      </button>

      {result && <div className={styles.notice} style={{ marginTop: 12 }}>{result}</div>}
      {error && <div className={`${styles.notice} ${styles.error}`} style={{ marginTop: 12 }}>{error}</div>}

      {confirmOpen && (
        <div className={styles.modalBackdrop} role="presentation">
          <div className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="sim-confirm-title">
            <h3 id="sim-confirm-title">確認 SIM 籃子</h3>
            <p>
              將送往 KGI SIM：{executable.length} 檔，預估名目金額 {money(totalNotional)} TWD。
              正式券商帳戶仍維持封鎖。
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.buttonGhost} onClick={() => setConfirmOpen(false)} disabled={busy}>
                取消
              </button>
              <button type="button" className={styles.button} onClick={submitBasket} disabled={busy}>
                {busy ? "送出中" : "送出 KGI SIM"}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export function StrategyDetailClient({ strategy }: { strategy: QuantStrategy }) {
  const color = accentColor(strategy.accent);
  return (
    <div className={styles.detailLayout} style={{ "--accent": color } as React.CSSProperties}>
      <div>
        <div className={styles.notice} style={{ marginBottom: 16 }}>
          <strong>SIM 帳戶執行中</strong> / 此頁沒有正式交易按鈕，送出前需再次確認 KGI SIM。
        </div>

        <section className={styles.band}>
          <h2>策略邏輯</h2>
          <p className={styles.signal}>{strategy.signal}</p>
          <ul className={styles.list}>
            {strategy.logic.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className={styles.band}>
          <h2>核心數據</h2>
          <div className={styles.metricGrid}>
            <div className={styles.metric}><span>Net Return</span><strong>{pct(strategy.metrics.netReturnPct)}</strong></div>
            <div className={styles.metric}><span>Benchmark / Excess</span><strong>{strategy.metrics.excessPct === undefined ? "NA" : pct(strategy.metrics.excessPct)}</strong></div>
            <div className={styles.metric}><span>Sharpe / IR</span><strong>{strategy.metrics.sharpe === null ? strategy.metrics.sharpeLabel ?? "NA" : strategy.metrics.sharpe.toFixed(2)}</strong></div>
            <div className={styles.metric}><span>Max Drawdown</span><strong>{pct(strategy.metrics.maxDrawdownPct)}</strong></div>
            <div className={styles.metric}><span>Hit Rate</span><strong>{pct(strategy.metrics.hitRatePct)}</strong></div>
            <div className={styles.metric}><span>Sample</span><strong>{strategy.metrics.sampleCount}</strong></div>
          </div>
        </section>

        <section className={styles.band}>
          <h2>統計圖表</h2>
          <div className={styles.chartPanel}>
            <div className={styles.chartBox}>
              <LineChart points={strategy.curve} color={color} />
            </div>
            <div className={styles.chartBox}>
              <BarChart points={strategy.bars} color={color} />
            </div>
          </div>
        </section>

        <section className={styles.band}>
          <h2>目前籃子</h2>
          <table className={styles.holdings}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Weight</th>
                <th>Price</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {strategy.holdings.map((holding) => (
                <tr key={holding.symbol}>
                  <td className={styles.num}>{holding.symbol}</td>
                  <td className={styles.num}>{pct(holding.weight * 100)}</td>
                  <td className={styles.num}>{holding.price.toLocaleString("zh-TW")}</td>
                  <td>{holding.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={styles.band}>
          <h2>資金與風控</h2>
          <ul className={styles.list}>
            {strategy.sizing.map((item) => <li key={item}>{item}</li>)}
            {strategy.riskControls.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className={styles.band}>
          <h2>限制與備註</h2>
          <ul className={styles.list}>
            {strategy.caveats.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      </div>

      <BasketLauncher strategy={strategy} color={color} />
    </div>
  );
}

