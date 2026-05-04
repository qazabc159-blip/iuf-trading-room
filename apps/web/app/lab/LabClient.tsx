"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanNarrativeText } from "@/lib/operator-copy";
import { labDisplay, radarLabApi, type LabBundleStatus, type LabSignalBundle } from "@/lib/radar-lab";

type LabClientProps = {
  initialBundles: LabSignalBundle[];
  initialBlockedReason?: string;
};

function statusTone(status: LabBundleStatus) {
  if (status === "APPROVED") return "status-ok";
  if (status === "REJECTED") return "status-bad";
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
  return friendlyDataError(error, "量化研究資料暫時無法讀取。");
}

function safeSummary(value: string) {
  return cleanNarrativeText(value, "策略包摘要尚未完成中文整理；保留正式資料來源，不顯示假績效。");
}

function shortBundleId(bundleId: string) {
  return bundleId.length > 14 ? `${bundleId.slice(0, 8)}…${bundleId.slice(-4)}` : bundleId;
}

function labModeCopy(blockedReason: string | null, count: number) {
  if (blockedReason) return "量化策略包 API 尚未接上，先顯示資料接線狀態。";
  if (count === 0) return "後端目前回傳 0 包；不顯示假策略或假績效。";
  return "只顯示正式策略包；審核動作寫回量化研究 API。";
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
      { label: "已核准", value: approved, tone: "status-ok" as const },
      { label: "已送出", value: pushed, tone: "gold" as const },
      { label: "平均信心", value: avgConfidence === null ? "--" : `${Math.round(avgConfidence * 100)}%`, tone: "muted" as const },
      { label: "平均報酬", value: avgReturn === null ? "--" : `${signed(avgReturn, 1)}%`, tone: avgReturn === null ? "muted" as const : toneClass(avgReturn) },
      { label: "最大回撤", value: worstDrawdown === null ? "--" : `${worstDrawdown.toFixed(1)}%`, tone: worstDrawdown !== null && worstDrawdown < -6 ? "status-bad" as const : "muted" as const },
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
      sub={blockedReason ? "資料接線狀態" : "策略包收件台"}
      note="此頁只顯示正式量化策略包；沒有真實資料時顯示接線狀態，不以假策略包或假績效充數。"
    >
      <MetricStrip columns={6} cells={cells} />

      <section className="lab-command-deck">
        <div>
          <span className="tg gold">量化研究 / 策略包收件台</span>
          <h2>先收正式策略包，再談績效曲線。</h2>
          <p>
            這頁是 OpenAlice / Quant Lab 的交接面。沒有正式 bundle 時只顯示資料狀態；
            有 bundle 才顯示回測摘要、審核狀態與分歧回饋。
          </p>
        </div>
        <div className="lab-source-card">
          <span>目前模式</span>
          <strong className={blockedReason ? "status-bad" : "status-ok"}>
            {blockedReason ? "資料待接" : "正式資料"}
          </strong>
          <p>{labModeCopy(blockedReason, bundles.length)}</p>
        </div>
      </section>

      <div className="lab-workbench-grid">
        <Panel code="LAB-Q" title="策略包收件" sub="正式資料 / 不顯示假績效" right={blockedReason ? "暫停" : `${bundles.length} 包`}>
          {blockedReason ? (
            <div className="lab-empty-state">
              <strong>量化策略包資料尚未接上。</strong>
              <p>負責人：量化研究交接管線。細節：{blockedReason}</p>
              <div>
                <span>接上後顯示：策略包、股票、主題、信心、回測摘要、分歧備註。</span>
                <span>仍不會顯示：未驗證 Sharpe、假 equity curve、假交易紀錄。</span>
              </div>
            </div>
          ) : bundles.length === 0 ? (
            <div className="lab-empty-state">
              <strong>目前沒有待審策略包。</strong>
              <p>後端正式回傳 0 包；頁面保留收件台與治理說明，不用範例數字冒充策略績效。</p>
            </div>
          ) : (
            <div className="lab-bundle-stack">
              {bundles.map((bundle) => (
                <article className={`lab-bundle-card ${selected?.bundleId === bundle.bundleId ? "is-selected" : ""}`} key={bundle.bundleId}>
                  <div className="lab-bundle-head">
                    <button className="outline-button" type="button" onClick={() => setSelectedId(bundle.bundleId)}>
                      {shortBundleId(bundle.bundleId)}
                    </button>
                    <span className="tg gold">{labDisplay.producer[bundle.producer]}</span>
                    <span className={statusTone(bundle.status)}>{labDisplay.status[bundle.status]}</span>
                  </div>

                  <Link href={`/lab/${bundle.bundleId}`} className="lab-bundle-title">
                    {bundle.title}
                  </Link>
                  <p>{safeSummary(bundle.summary)}</p>

                  <div className="lab-bundle-metrics">
                    <span><b>{bundle.symbol}</b><small>股票</small></span>
                    <span><b>{bundle.themeCode}</b><small>主題</small></span>
                    <span><b>{Math.round(bundle.confidence * 100)}%</b><small>信心</small></span>
                    <span><b className={toneClass(bundle.backtest.totalReturnPct)}>{signed(bundle.backtest.totalReturnPct, 1)}%</b><small>回測報酬</small></span>
                  </div>

                  <div className="lab-bundle-actions">
                    <button className="mini-button approve-soft" type="button" disabled={!!busy || actionsBlocked} onClick={() => applyAction(bundle.bundleId, "APPROVED", "APPROVE")}>
                      通過
                    </button>
                    <button className="outline-button danger-soft" type="button" disabled={!!busy || actionsBlocked} onClick={() => applyAction(bundle.bundleId, "REJECTED", "REJECT")}>
                      退回
                    </button>
                    <span className="idea-promotion-block" role="status" title="策略包轉模擬交易的後端契約尚未完成。">
                      轉單待接
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
          {(actionError || (!blockedReason && bundles.length > 0)) && (
            <div className="terminal-note" style={{ marginTop: 12 }}>
              {actionError
                ? `暫停：量化研究動作失敗。${actionError}`
                : "轉入模擬交易需等待 量化研究交接管線 完成交接契約；核准/退回會寫入量化研究正式資料。"}
            </div>
          )}
        </Panel>

        <div className="lab-side-stack">
          <Panel code="LAB-D" title="選取策略包" right={selected ? labDisplay.status[selected.status] : blockedReason ? "暫停" : "無資料"}>
            {selected ? (
              <div className="lab-selected-card">
                <div className="tg gold">{selected.bundleId} / {labDisplay.producer[selected.producer]}</div>
                <h2>{selected.title}</h2>
                <div className="tg soft">{selected.symbol} / {selected.themeCode} / {timeText(selected.createdAt)}</div>
                <p>{safeSummary(selected.summary)}</p>
                <div className="lab-selected-metrics">
                  <span><b>{Math.round(selected.backtest.winRate * 100)}%</b><small>勝率</small></span>
                  <span><b className={toneClass(selected.backtest.totalReturnPct)}>{signed(selected.backtest.totalReturnPct, 1)}%</b><small>報酬</small></span>
                  <span><b className="status-bad">{selected.backtest.maxDrawdownPct.toFixed(1)}%</b><small>最大回撤</small></span>
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
            <div className="lab-governance-list">
              <span>只讀展示：策略包、回測摘要、分歧備註。</span>
              <span>可寫動作：通過 / 退回 / 分歧回饋，只寫回量化研究 API。</span>
              <span>禁止動作：建立券商委託、推 migration 0020、碰 KGI write-side。</span>
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
