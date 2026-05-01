"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";
import { labDisplay, radarLabApi, type LabBundleStatus, type LabSignalBundle } from "@/lib/radar-lab";

type LabClientProps = {
  initialBundles: LabSignalBundle[];
  initialBlockedReason?: string;
};

function statusTone(status: LabBundleStatus) {
  if (status === "APPROVED") return "down";
  if (status === "REJECTED") return "up";
  if (status === "PUSHED") return "gold";
  return "muted";
}

function timeText(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LabClient({ initialBundles, initialBlockedReason }: LabClientProps) {
  const [bundles, setBundles] = useState(initialBundles);
  const [selectedId, setSelectedId] = useState(initialBundles[0]?.bundleId ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(initialBlockedReason ?? null);
  const [actionError, setActionError] = useState<string | null>(null);
  const statsAvailable = !blockedReason;

  useEffect(() => {
    if (initialBlockedReason) return;
    let alive = true;
    radarLabApi.bundles()
      .then((next) => {
        if (!alive) return;
        setBundles(next);
        setBlockedReason(null);
        setSelectedId((current) => current || next[0]?.bundleId || "");
      })
      .catch((error) => {
        if (alive) setBlockedReason(errorText(error));
      });
    return () => {
      alive = false;
    };
  }, [initialBlockedReason]);

  const selected = bundles.find((bundle) => bundle.bundleId === selectedId) ?? bundles[0] ?? null;
  const actionsBlocked = Boolean(blockedReason);
  const cells = useMemo(() => {
    if (!statsAvailable) {
      return [
        { label: "待審", value: "--", tone: "muted" as const },
        { label: "已核准", value: "--", tone: "muted" as const },
        { label: "已送出", value: "--", tone: "muted" as const },
        { label: "平均信心", value: "--", tone: "muted" as const },
        { label: "平均報酬", value: "--", tone: "muted" as const },
        { label: "最大回撤", value: "--", tone: "muted" as const },
      ];
    }

    const pending = bundles.filter((bundle) => bundle.status === "NEW").length;
    const approved = bundles.filter((bundle) => bundle.status === "APPROVED").length;
    const pushed = bundles.filter((bundle) => bundle.status === "PUSHED").length;
    const avgConfidence = bundles.length ? bundles.reduce((sum, bundle) => sum + bundle.confidence, 0) / bundles.length : null;
    const avgReturn = bundles.length ? bundles.reduce((sum, bundle) => sum + bundle.backtest.totalReturnPct, 0) / bundles.length : null;
    const worstDrawdown = bundles.length ? Math.min(...bundles.map((bundle) => bundle.backtest.maxDrawdownPct)) : null;
    return [
      { label: "待審", value: pending, tone: "muted" as const },
      { label: "已核准", value: approved, tone: "down" as const },
      { label: "已送出", value: pushed, tone: "gold" as const },
      { label: "平均信心", value: avgConfidence === null ? "--" : `${Math.round(avgConfidence * 100)}%`, tone: "muted" as const },
      { label: "平均報酬", value: avgReturn === null ? "--" : `${signed(avgReturn, 1)}%`, tone: avgReturn === null ? "muted" as const : toneClass(avgReturn) },
      { label: "最大回撤", value: worstDrawdown === null ? "--" : `${worstDrawdown.toFixed(1)}%`, tone: worstDrawdown !== null && worstDrawdown < -6 ? "up" as const : "muted" as const },
    ];
  }, [bundles, statsAvailable]);

  async function applyAction(bundleId: string, nextStatus: LabBundleStatus, action: "APPROVE" | "REJECT") {
    if (actionsBlocked) return;
    setBusy(`${bundleId}:${action}`);
    setActionError(null);
    try {
      await radarLabApi.bundleAction(bundleId, action);
      setBundles((prev) => prev.map((bundle) => bundle.bundleId === bundleId ? { ...bundle, status: nextStatus } : bundle));
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageFrame
      code="LAB"
      title="量化研究"
      sub={blockedReason ? "資料暫停" : "策略包審核"}
      note="此頁只顯示正式量化策略包；沒有真實資料時不以假策略包充數。"
    >
      <MetricStrip columns={6} cells={cells} />

      <div className="company-grid">
        <Panel code="LAB-Q" title="策略包佇列" right={blockedReason ? "暫停" : `${bundles.length} 包`}>
          {blockedReason ? (
            <div className="terminal-note">
              暫停：量化策略包資料尚未啟用。負責人：Athena + Jason。細節：{blockedReason}
            </div>
          ) : bundles.length === 0 ? (
            <div className="terminal-note">無資料：目前沒有待審策略包。</div>
          ) : (
            <>
              <div className="row table-head lab-row">
                <span>ID</span>
                <span>來源</span>
                <span>標題</span>
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
                  <span className={`tg ${statusTone(bundle.status)}`}>{labDisplay.status[bundle.status]}</span>
                  <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="mini-button" type="button" disabled={!!busy || actionsBlocked} onClick={() => applyAction(bundle.bundleId, "APPROVED", "APPROVE")}>
                      核准
                    </button>
                    <button className="outline-button" type="button" disabled={!!busy || actionsBlocked} onClick={() => applyAction(bundle.bundleId, "REJECTED", "REJECT")}>
                      退回
                    </button>
                    <button className="outline-button" type="button" disabled title="策略包轉紙上交易的後端契約尚未完成。">
                      轉入
                    </button>
                  </span>
                </div>
              ))}
            </>
          )}
          {(actionError || (!blockedReason && bundles.length > 0)) && (
            <div className="terminal-note" style={{ marginTop: 12 }}>
              {actionError
                ? `暫停：量化研究動作失敗。${actionError}`
                : "轉入紙上交易需等待 Jason/Athena 完成交接契約；核准/退回會以量化研究 API 寫入。"}
            </div>
          )}
        </Panel>

        <div>
          <Panel code="LAB-D" title="選取策略包" right={selected ? labDisplay.status[selected.status] : blockedReason ? "暫停" : "無資料"}>
            {selected ? (
              <div className="ticket">
                <div className="tg gold">{selected.bundleId} / {labDisplay.producer[selected.producer]}</div>
                <h2 className="tc" style={{ margin: "10px 0 6px", fontSize: 26 }}>{selected.title}</h2>
                <div className="tg soft">{selected.symbol} / {selected.themeCode} / {timeText(selected.createdAt)}</div>
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
                  查看明細
                </Link>
              </div>
            ) : (
              <div className="terminal-note">
                {blockedReason ? "暫停：目前無法顯示正式策略包。" : "無資料：尚未選取策略包。"}
              </div>
            )}
          </Panel>

          <Panel code="LAB-MEMO" title="治理邊界" right="不會實單">
            <div className="terminal-note">
              量化研究只寫入研究 API；不會建立券商委託、不會推進 migration 0020，也不會啟用正式下單。
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
