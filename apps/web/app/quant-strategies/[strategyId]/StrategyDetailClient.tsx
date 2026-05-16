"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

const BACKEND_STRATEGY_IDS: Record<string, string> = {
  cont_liq_v36: "cont_liq_v36",
  class5_revenue_momentum: "strategy_002",
  family_c_sbl_overlay: "strategy_003",
};

type SubscribeResponse = {
  subscription_id?: string;
  status?: string;
  warning?: string;
  error?: string;
  message?: string;
  reason?: string;
};

function backendStrategyIdFor(strategy: QuantStrategy) {
  return BACKEND_STRATEGY_IDS[strategy.id] ?? strategy.id;
}

function formatSubscribeFailure(status: number, body: SubscribeResponse) {
  const code = body.error ?? body.message ?? "SUBSCRIBE_FAILED";
  if (status === 410 || code === "STRATEGY_RETIRED") {
    const reason = typeof body.reason === "string" && body.reason.trim() ? ` ${body.reason.trim()}` : "";
    return `策略已退役，不再接受 SIM 訂閱。${reason}`;
  }
  if (status === 401 || status === 403) return `訂閱失敗：權限或 SIM-only 風控未通過（${code}）。`;
  if (status === 400) return `訂閱失敗：投入金額或策略參數不正確（${code}）。`;
  return `訂閱失敗：後端暫時無法建立策略訂閱（${status} / ${code}）。`;
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
  const [warning, setWarning] = useState<string | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmDialogRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);

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

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!confirmOpen) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => cancelButtonRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || busyRef.current) return;
      event.preventDefault();
      setConfirmOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      window.setTimeout(() => {
        if (previousFocus && document.contains(previousFocus)) {
          previousFocus.focus();
          return;
        }
        openButtonRef.current?.focus();
      }, 0);
    };
  }, [confirmOpen]);

  function closeConfirmDialog() {
    if (busyRef.current) return;
    setConfirmOpen(false);
  }

  function getFocusableDialogControls() {
    const dialog = confirmDialogRef.current;
    if (!dialog) return [];

    const controls = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    return Array.from(controls).filter((control) => control.tabIndex >= 0 && control.offsetParent !== null);
  }

  function focusDialogEdge(edge: "first" | "last") {
    const controls = getFocusableDialogControls();
    if (controls.length === 0) {
      confirmDialogRef.current?.focus();
      return;
    }

    controls[edge === "first" ? 0 : controls.length - 1]?.focus();
  }

  function handleConfirmDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmDialog();
      return;
    }

    if (event.key !== "Tab") return;

    const dialog = confirmDialogRef.current;
    if (!dialog) return;

    const controls = getFocusableDialogControls();
    if (controls.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        focusDialogEdge("last");
      }
      return;
    }

    if (active === last) {
      event.preventDefault();
      focusDialogEdge("first");
    }
  }

  async function subscribeStrategy() {
    if (!confirmed || busy || executable.length === 0 || !capitalValid) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setWarning(null);
    try {
      const backendStrategyId = backendStrategyIdFor(strategy);
      const response = await fetch(`/api/quant-strategies/${encodeURIComponent(backendStrategyId)}/subscribe`, {
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

      const subscriptionLabel = typeof body.subscription_id === "string"
        ? ` (${body.subscription_id.slice(0, 8)})`
        : "";
      const readinessWarning = typeof body.warning === "string" && body.warning.trim()
        ? body.warning.trim()
        : null;
      setResult(`SIM-only 策略訂閱已建立${subscriptionLabel}，配置資金 ${money(budget)} TWD；不直接送出個股委託。`);
      setWarning(readinessWarning);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "策略訂閱建立失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={styles.launcher} style={{ "--accent": color } as React.CSSProperties}>
      <h2>SIM 策略訂閱</h2>
      <p className={styles.sub} style={{ margin: "0 0 12px", fontSize: 13 }}>
        建立 SIM-only 策略訂閱紀錄；此動作不直接送出個股委託，也不開啟正式券商交易。
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
        預估配置 {executable.length} / {strategy.holdings.length} 檔，名目金額 {money(totalNotional)} TWD。
      </div>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 0", color: "#cdd5df", fontSize: 13 }}>
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        我確認這是 SIM-only 策略訂閱，不會送出正式券商委託。
      </label>

      <button
        ref={openButtonRef}
        className={styles.button}
        type="button"
        disabled={!confirmed || busy || executable.length === 0 || !capitalValid}
        onClick={() => setConfirmOpen(true)}
      >
        {busy ? "建立中" : "建立 SIM 訂閱"}
      </button>

      {result && <div className={styles.notice} style={{ marginTop: 12 }}>{result}</div>}
      {warning && (
        <div className={styles.notice} style={{ marginTop: 12 }}>
          <strong>READINESS WARNING</strong> / {warning}
        </div>
      )}
      {error && <div className={`${styles.notice} ${styles.error}`} style={{ marginTop: 12 }}>{error}</div>}

      {confirmOpen &&
        createPortal(
          <div
            className={styles.modalBackdrop}
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeConfirmDialog();
            }}
          >
            <div
              ref={confirmDialogRef}
              className={styles.confirmModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="sim-confirm-title"
              aria-describedby="sim-confirm-description"
              tabIndex={-1}
              onKeyDown={handleConfirmDialogKeyDown}
            >
              <h3 id="sim-confirm-title">確認 SIM 策略訂閱</h3>
              <p id="sim-confirm-description">
                將建立 {strategy.shortName} 的 SIM-only 策略訂閱，配置資金 {money(budget)} TWD，
                目前預估 {executable.length} 檔、名目金額 {money(totalNotional)} TWD。這不會直接送出個股委託。
              </p>
              <div className={styles.confirmActions}>
                <button ref={cancelButtonRef} type="button" className={styles.buttonGhost} onClick={closeConfirmDialog} disabled={busy}>
                  取消
                </button>
                <button type="button" className={styles.button} onClick={subscribeStrategy} disabled={busy}>
                  {busy ? "建立中" : "確認建立"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
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
          <strong>SIM-only 策略訂閱</strong> / 此頁不直接送出個股委託，也沒有正式交易按鈕。
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
            <div className={styles.metric}><span>淨報酬</span><strong>{pct(strategy.metrics.netReturnPct)}</strong></div>
            <div className={styles.metric}><span>基準 / 超額</span><strong>{strategy.metrics.excessPct === undefined ? "NA" : pct(strategy.metrics.excessPct)}</strong></div>
            <div className={styles.metric}><span>Sharpe / IR</span><strong>{strategy.metrics.sharpe === null ? strategy.metrics.sharpeLabel ?? "NA" : strategy.metrics.sharpe.toFixed(2)}</strong></div>
            <div className={styles.metric}><span>最大回撤</span><strong>{pct(strategy.metrics.maxDrawdownPct)}</strong></div>
            <div className={styles.metric}><span>命中率</span><strong>{pct(strategy.metrics.hitRatePct)}</strong></div>
            <div className={styles.metric}><span>樣本數</span><strong>{strategy.metrics.sampleCount}</strong></div>
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

