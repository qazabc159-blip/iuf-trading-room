"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";
import { labDisplay, radarLabApi, type LabBundleStatus, type LabSignalBundle } from "@/lib/radar-lab";

function statusTone(status: LabBundleStatus) {
  if (status === "APPROVED") return "down";
  if (status === "REJECTED") return "up";
  if (status === "PUSHED") return "gold";
  return "muted";
}

function timeText(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function LabClient({ initialBundles }: { initialBundles: LabSignalBundle[] }) {
  const [bundles, setBundles] = useState(initialBundles);
  const [selectedId, setSelectedId] = useState(initialBundles[0]?.bundleId ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    radarLabApi.bundles().then((next) => {
      if (alive) setBundles(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const selected = bundles.find((bundle) => bundle.bundleId === selectedId) ?? bundles[0];
  const cells = useMemo(() => {
    const pending = bundles.filter((bundle) => bundle.status === "NEW").length;
    const approved = bundles.filter((bundle) => bundle.status === "APPROVED").length;
    const pushed = bundles.filter((bundle) => bundle.status === "PUSHED").length;
    const avgConfidence = bundles.length ? bundles.reduce((sum, bundle) => sum + bundle.confidence, 0) / bundles.length : 0;
    const avgReturn = bundles.length ? bundles.reduce((sum, bundle) => sum + bundle.backtest.totalReturnPct, 0) / bundles.length : 0;
    const worstDrawdown = bundles.length ? Math.min(...bundles.map((bundle) => bundle.backtest.maxDrawdownPct)) : 0;
    return [
      { label: "待審", value: pending, tone: "muted" as const },
      { label: "已批准", value: approved, tone: "down" as const },
      { label: "已推送", value: pushed, tone: "gold" as const },
      { label: "平均信心", value: `${Math.round(avgConfidence * 100)}%`, tone: "muted" as const },
      { label: "平均報酬", value: `${signed(avgReturn, 1)}%`, tone: toneClass(avgReturn) },
      { label: "最大回撤", value: `${worstDrawdown.toFixed(1)}%`, tone: worstDrawdown < -6 ? "up" as const : "muted" as const },
    ];
  }, [bundles]);

  async function applyAction(bundleId: string, nextStatus: LabBundleStatus, action: "APPROVE" | "REJECT" | "PUSH_TO_PORTFOLIO") {
    setBusy(`${bundleId}:${action}`);
    await radarLabApi.bundleAction(bundleId, action);
    setBundles((prev) => prev.map((bundle) => bundle.bundleId === bundleId ? { ...bundle, status: nextStatus } : bundle));
    setBusy(null);
  }

  return (
    <PageFrame
      code="LAB"
      title="量化實驗室"
      sub="策略訊號匯入"
      note="[LAB] Quant Lab / Operator / OpenAlice 訊號 bundle · 批准 / 駁回 / 推送到下單台 · 紙上流程"
    >
      <MetricStrip columns={6} cells={cells} />

      <div className="company-grid">
        <Panel code="LAB-Q" title="訊號佇列" right={`${bundles.length} BUNDLES`}>
          <div className="row table-head lab-row">
            <span>ID</span>
            <span>來源</span>
            <span>訊號</span>
            <span>股票</span>
            <span>信心</span>
            <span>狀態</span>
            <span>動作</span>
          </div>
          {bundles.map((bundle) => (
            <div className="row lab-row" key={bundle.bundleId}>
              <button className="outline-button" type="button" onClick={() => setSelectedId(bundle.bundleId)}>
                {bundle.bundleId.split("-").slice(-2).join("-")}
              </button>
              <span className="tg gold">{labDisplay.producer[bundle.producer]}</span>
              <Link href={`/lab/${bundle.bundleId}`} className="tc">{bundle.title}</Link>
              <span className="tg">{bundle.symbol}</span>
              <span className="num">{Math.round(bundle.confidence * 100)}%</span>
              <span className={`tg ${statusTone(bundle.status)}`}>● {labDisplay.status[bundle.status]}</span>
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                <button className="mini-button" type="button" disabled={!!busy} onClick={() => applyAction(bundle.bundleId, "APPROVED", "APPROVE")}>
                  批准
                </button>
                <button className="outline-button" type="button" disabled={!!busy} onClick={() => applyAction(bundle.bundleId, "REJECTED", "REJECT")}>
                  駁回
                </button>
                <button className="outline-button" type="button" disabled={!!busy} onClick={() => applyAction(bundle.bundleId, "PUSHED", "PUSH_TO_PORTFOLIO")}>
                  推送
                </button>
              </span>
            </div>
          ))}
        </Panel>

        <div>
          <Panel code="LAB-D" title="選中 bundle" right={selected ? labDisplay.status[selected.status] : "EMPTY"}>
            {selected ? (
              <div className="ticket">
                <div className="tg gold">{selected.bundleId} · {labDisplay.producer[selected.producer]}</div>
                <h2 className="tc" style={{ margin: "10px 0 6px", fontSize: 26 }}>{selected.title}</h2>
                <div className="tg soft">{selected.symbol} · {selected.themeCode} · {timeText(selected.createdAt)}</div>
                <p className="tc" style={{ color: "var(--night-ink)", lineHeight: 1.8 }}>{selected.summary}</p>
                <div className="row position-row">
                  <span className="tg muted">勝率</span>
                  <span className="num down">{Math.round(selected.backtest.winRate * 100)}%</span>
                  <span className="tg muted">報酬</span>
                  <span className={`num ${toneClass(selected.backtest.totalReturnPct)}`}>{signed(selected.backtest.totalReturnPct, 1)}%</span>
                  <span className="tg muted">回撤</span>
                  <span className="num up">{selected.backtest.maxDrawdownPct.toFixed(1)}%</span>
                </div>
                <Link className="mini-button" href={`/lab/${selected.bundleId}`} style={{ marginTop: 12 }}>
                  開啟詳情
                </Link>
              </div>
            ) : (
              <div className="terminal-note">目前沒有訊號 bundle。</div>
            )}
          </Panel>

          <Panel code="LAB-MEMO" title="操作原則" right="NO LIVE ORDER">
            <div className="terminal-note">
              這裡只處理 Quant Lab / OpenAlice 的訊號候選。推送到下單台只代表建立候選脈絡，不會送出 broker order，也不會觸碰 KGI gateway。
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
