"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import { TrackRecordDisclosure } from "@/components/TrackRecordDisclosure";
import type { QuantStrategy, StrategyCurvePoint } from "../strategy-data";
import styles from "../QuantStrategies.module.css";

const MIN_SIM_CAPITAL = 50_000;
const MAX_SIM_CAPITAL = 10_000_000;

type SubscribeResponse = {
  subscription_id?: string;
  status?: string;
  warning?: string;
  error?: string;
  message?: string;
  reason?: string;
};

function accentColor(accent: QuantStrategy["accent"]) {
  if (accent === "cyan") return "#5cc8ff";
  if (accent === "green") return "#58d68d";
  return "#e2b85c";
}

function pct(value: number | null) {
  if (value == null) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function money(value: number) {
  return Math.round(value).toLocaleString("zh-TW");
}

function formatSubscribeFailure(status: number, body: SubscribeResponse) {
  const code = body.error ?? body.message ?? "SUBSCRIBE_FAILED";
  if (status === 401 || status === 403) return `Owner 權限不足或登入逾時，後端拒絕寫入 S1 資金設定。(${code})`;
  if (status === 400) return `資金格式或範圍不合法，請輸入 ${money(MIN_SIM_CAPITAL)} 到 ${money(MAX_SIM_CAPITAL)} TWD。(${code})`;
  if (status === 410) return `策略已退役，不能配置 SIM 資金。${body.reason ?? code}`;
  return `S1 資金設定失敗：HTTP ${status} / ${code}`;
}

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
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="230" role="img" aria-label="S1 forward observation equity curve">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="rgba(220,228,240,.14)" />
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <text x={pad} y={18} fill="#91a0b5" fontSize="12" fontFamily="monospace">Forward observation curve</text>
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
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="220" role="img" aria-label="S1 monthly return bars">
      <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="rgba(220,228,240,.14)" />
      {points.map((p, index) => {
        const x = pad + index * ((width - pad * 2) / points.length) + 3;
        const h = Math.abs(p.value) / maxAbs * (height / 2 - pad);
        const y = p.value >= 0 ? zeroY - h : zeroY;
        return (
          <rect
            key={`${p.date}-${p.value}`}
            x={x}
            y={y}
            width={Math.max(3, barW)}
            height={h}
            rx="4"
            fill={p.value >= 0 ? color : "#e63946"}
            opacity="0.82"
          />
        );
      })}
      <text x={pad} y={18} fill="#91a0b5" fontSize="12" fontFamily="monospace">Monthly returns</text>
    </svg>
  );
}

function BasketLauncher({ strategy, color }: { strategy: QuantStrategy; color: string }) {
  const [capital, setCapital] = useState("10000000");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const budget = useMemo(() => Number(capital.replace(/,/g, "")), [capital]);
  const capitalValid = Number.isFinite(budget) && budget >= MIN_SIM_CAPITAL && budget <= MAX_SIM_CAPITAL;
  const capitalMessage = !Number.isFinite(budget) || budget <= 0
    ? "請輸入要給 S1/F-AUTO 使用的 SIM 資金。"
    : budget < MIN_SIM_CAPITAL
      ? `資金至少 ${money(MIN_SIM_CAPITAL)} TWD。`
      : budget > MAX_SIM_CAPITAL
        ? `目前 S1 上限為 ${money(MAX_SIM_CAPITAL)} TWD。`
        : null;

  const preview = useMemo(() => {
    if (!Number.isFinite(budget) || budget <= 0) return [];
    return strategy.holdings.map((holding) => {
      const target = budget * holding.weight;
      const qty = Math.floor(target / holding.price);
      return { ...holding, target, qty, notional: qty * holding.price };
    });
  }, [budget, strategy.holdings]);

  const executable = preview.filter((row) => row.qty > 0);
  const totalNotional = executable.reduce((sum, row) => sum + row.notional, 0);

  async function subscribeStrategy() {
    if (!confirmed || busy || executable.length === 0 || !capitalValid) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setWarning(null);
    try {
      const response = await fetch(`/api/quant-strategies/${encodeURIComponent(strategy.id)}/subscribe`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capital_twd: budget,
          executionMode: "paper",
        }),
      });

      let body: SubscribeResponse = {};
      try {
        body = await response.json() as SubscribeResponse;
      } catch {
        body = {};
      }

      if (!response.ok) {
        throw new Error(formatSubscribeFailure(response.status, body));
      }

      const subscriptionLabel = body.subscription_id ? ` (${body.subscription_id.slice(0, 8)})` : "";
      setResult(`S1 SIM 資金已寫入後端${subscriptionLabel}：${money(budget)} TWD。下一次 S1 signal run 會用這個金額計算 basket 與委託股數。`);
      setWarning(body.warning?.trim() || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "S1 SIM 資金設定失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={styles.launcher} style={{ "--accent": color } as CSSProperties}>
      <h2>S1 SIM 資金配置</h2>
      <p className={styles.sub} style={{ margin: "0 0 12px", fontSize: 13 }}>
        這裡不是展示用設定。送出後會寫進後端 audit log，S1 runner 產生 basket 時會讀最新一筆 S1 配置。
      </p>
      <label htmlFor="capital" className={styles.eyebrow}>CAPITAL TWD / 50,000 - 10,000,000</label>
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
            <span>{row.qty > 0 ? `${row.qty.toLocaleString("zh-TW")} 股預估` : "資金不足"}</span>
            <span className={styles.num}>{money(row.notional)}</span>
          </div>
        ))}
      </div>

      <div className={styles.notice}>
        {strategy.holdings.length > 0
          ? `依最新 S1 basket 預估可配置 ${executable.length} / ${strategy.holdings.length} 檔，名目金額約 ${money(totalNotional)} TWD。實際委託仍由 runner 依最新價格與流動性重算。`
          : "目前讀不到最新 S1 basket，因此不顯示示意持股，也不開放送出資金設定。"}
      </div>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 0", color: "#cdd5df", fontSize: 13 }}>
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        我確認這是 KGI SIM / paper isolated 資金設定，不會開啟真實下單。
      </label>

      <button
        className={styles.button}
        type="button"
        disabled={!confirmed || busy || executable.length === 0 || !capitalValid}
        onClick={subscribeStrategy}
      >
        {busy ? "寫入中..." : "寫入 S1 SIM 資金"}
      </button>

      {result && <div className={styles.notice} style={{ marginTop: 12 }}>{result}</div>}
      {warning && <div className={styles.notice} style={{ marginTop: 12 }}><strong>觀察窗提醒</strong> / {warning}</div>}
      {error && <div className={`${styles.notice} ${styles.error}`} style={{ marginTop: 12 }}>{error}</div>}
    </aside>
  );
}

export function StrategyDetailClient({ strategy }: { strategy: QuantStrategy }) {
  const color = accentColor(strategy.accent);
  return (
    <div className={styles.detailLayout} style={{ "--accent": color } as CSSProperties}>
      <div>
        <div className={styles.notice} style={{ marginBottom: 16 }}>
          <strong>S1 是目前唯一正式量化策略。</strong> 本頁的資金設定會接到後端 S1 runner；其他研究策略先不放進正式產品頁。
        </div>
        <div className={styles.notice} style={{ marginBottom: 16 }}>
          <strong>{strategy.current.dataState}</strong> / {strategy.current.sourceLabel}
          {strategy.current.asOf ? ` / 最新 basket ${strategy.current.asOf}` : ""}
          {strategy.current.researchWindow ? ` / 核准研究窗 ${strategy.current.researchWindow}` : ""}
        </div>

        <section className={styles.band}>
          <h2>策略邏輯</h2>
          <p className={styles.signal}>{strategy.signal}</p>
          <ul className={styles.list}>
            {strategy.logic.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        {strategy.realSimReturnPct != null && (
          <section className={styles.band}>
            <h2>S1 F-AUTO 實盤模擬（含成本）</h2>
            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <span>KGI SIM 累積損益</span>
                <strong style={{ color: strategy.realSimReturnPct >= 0 ? "var(--tw-up-bright)" : "var(--tw-dn-bright)", fontSize: 22 }}>
                  {pct(strategy.realSimReturnPct)}
                </strong>
                <small className={styles.metricHint}>實際下單成交結果，非研究回測示意。</small>
              </div>
            </div>
          </section>
        )}

        <section className={styles.band}>
          <h2>觀察指標（研究回測）</h2>
          <div className={styles.metricGrid}>
            <div className={styles.metric}><span>研究期淨值曲線</span><strong>{pct(strategy.metrics.netReturnPct)}</strong></div>
            <div className={styles.metric}><span>相對 0050</span><strong>{strategy.metrics.excessPct === undefined ? "NA" : pct(strategy.metrics.excessPct)}</strong></div>
            <div className={styles.metric}><span>Sharpe</span><strong>{strategy.metrics.sharpe === null ? strategy.metrics.sharpeLabel ?? "NA" : strategy.metrics.sharpe.toFixed(2)}</strong></div>
            <div className={styles.metric}><span>最大回撤</span><strong>{pct(strategy.metrics.maxDrawdownPct)}</strong></div>
            <div className={styles.metric}><span>命中率</span><strong>{pct(strategy.metrics.hitRatePct)}</strong></div>
            <div className={styles.metric}><span>再平衡樣本</span><strong>{strategy.metrics.sampleCount ?? "--"}</strong></div>
          </div>
          {(strategy.metrics.netReturnPct != null || strategy.metrics.hitRatePct != null) && (
            <TrackRecordDisclosure
              isLiveVerifiedTrackRecord={strategy.trackRecord.isLiveVerifiedTrackRecord}
              headlineDisclosureZh={strategy.trackRecord.headlineDisclosureZh}
            />
          )}
        </section>

        <section className={styles.band}>
          <h2>研究曲線</h2>
          {strategy.curve.length > 0 && strategy.bars.length > 0 ? (
            <div className={styles.chartPanel}>
              <div className={styles.chartBox}><LineChart points={strategy.curve} color={color} /></div>
              <div className={styles.chartBox}><BarChart points={strategy.bars} color={color} /></div>
            </div>
          ) : (
            <div className={styles.notice}>核准研究曲線目前無法讀取，這裡不使用前端示意資料補畫。</div>
          )}
        </section>

        <section className={styles.band}>
          <h2>預估配置預覽</h2>
          {strategy.holdings.length > 0 ? (
            <div className={styles.holdingsScroll} tabIndex={0} aria-label="S1 latest basket holdings">
              <table className={styles.holdings}>
              <thead>
                <tr>
                  <th scope="col">代號</th>
                  <th scope="col">名稱</th>
                  <th scope="col">權重</th>
                  <th scope="col">basket 價格</th>
                  <th scope="col">說明</th>
                </tr>
              </thead>
              <tbody>
                {strategy.holdings.map((holding) => (
                  <tr key={holding.symbol}>
                    <td className={styles.num}>{holding.symbol}</td>
                    <td>{holding.name ?? "--"}</td>
                    <td className={styles.num}>{pct(holding.weight * 100)}</td>
                    <td className={styles.num}>{holding.price.toLocaleString("zh-TW")}</td>
                    <td>{holding.note}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.notice}>最新 S1 basket 尚未取得；不顯示固定大型股或示意價格。</div>
          )}
        </section>

        <section className={styles.band}>
          <h2>部位與風控</h2>
          <ul className={styles.list}>
            {strategy.sizing.map((item) => <li key={item}>{item}</li>)}
            {strategy.riskControls.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className={styles.band}>
          <h2>限制與下一步</h2>
          <ul className={styles.list}>
            {strategy.caveats.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      </div>

      <BasketLauncher strategy={strategy} color={color} />
    </div>
  );
}
