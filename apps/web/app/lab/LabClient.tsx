"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
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
  if (blockedReason) return "量化研究資料尚未完成同步，先顯示資料狀態。";
  if (count === 0) return "目前沒有正式策略包；不顯示假策略或假績效。";
  return "只顯示正式策略包；審核動作會更新量化研究紀錄。";
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
        { label: "總包數", value: "--", tone: "muted" as const },
        { label: "待審", value: "--", tone: "muted" as const },
        { label: "已核准", value: "--", tone: "muted" as const },
        { label: "已退回", value: "--", tone: "muted" as const },
        { label: "已交接", value: "--", tone: "muted" as const },
        { label: "績效", value: "隱藏", tone: "gold" as const },
      ];
    }

    const pending = bundles.filter((bundle) => bundle.status === "NEW").length;
    const approved = bundles.filter((bundle) => bundle.status === "APPROVED").length;
    const rejected = bundles.filter((bundle) => bundle.status === "REJECTED").length;
    const pushed = bundles.filter((bundle) => bundle.status === "PUSHED").length;
    return [
      { label: "總包數", value: bundles.length, tone: "muted" as const },
      { label: "待審", value: pending, tone: "muted" as const },
      { label: "已核准", value: approved, tone: "status-ok" as const },
      { label: "已退回", value: rejected, tone: rejected > 0 ? "status-bad" as const : "muted" as const },
      { label: "已交接", value: pushed, tone: "gold" as const },
      { label: "績效", value: "待核准", tone: "gold" as const },
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
      sub={blockedReason ? "資料同步狀態" : "策略包收件台"}
      note="此頁只顯示正式量化策略包；沒有真實資料時顯示同步狀態，不以假策略包或假績效充數。"
    >
      <MetricStrip columns={6} cells={cells} />

      <section className="lab-command-deck">
        <div>
          <span className="tg gold">量化研究 / 策略包收件台</span>
          <h2>先收正式策略包，再談績效曲線。</h2>
          <p>
            這頁是量化研究與 SIM 驗證的交接台。沒有正式策略包時只顯示資料狀態；
            有策略包也只先顯示來源、狀態與分歧回饋；未經完整驗證前，不顯示勝率、報酬或權益曲線。
          </p>
        </div>
        <div className="lab-source-card">
          <span>目前模式</span>
          <strong className={blockedReason ? "status-bad" : "status-ok"}>
            {blockedReason ? "同步待處理" : "正式資料"}
          </strong>
          <p>{labModeCopy(blockedReason, bundles.length)}</p>
        </div>
      </section>

      <div className="lab-workbench-grid">
        <Panel code="LAB-Q" title="策略包收件" sub="正式資料 / 不顯示假績效" right={blockedReason ? "暫停" : `${bundles.length} 包`}>
          {blockedReason ? (
            <div className="lab-empty-state">
              <strong>量化研究資料尚未完成同步。</strong>
              <p>{blockedReason}</p>
              <div>
                <span>接上後顯示：策略包、股票、主題、來源、審核狀態、分歧備註。</span>
                <span>仍不會顯示：未驗證績效、假曲線、假交易紀錄。</span>
              </div>
            </div>
          ) : bundles.length === 0 ? (
            <div className="lab-empty-state">
              <strong>目前沒有待審策略包。</strong>
              <p>目前沒有正式策略包；頁面保留收件台與治理說明，不用範例數字冒充策略績效。</p>
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
                    <span><b>{timeText(bundle.createdAt)}</b><small>建立</small></span>
                    <span><b className="gold">待核准</b><small>績效隱藏</small></span>
                  </div>

                  <div className="lab-bundle-actions">
                    <button className="mini-button approve-soft" type="button" disabled={!!busy || actionsBlocked} onClick={() => applyAction(bundle.bundleId, "APPROVED", "APPROVE")}>
                      通過
                    </button>
                    <button className="outline-button danger-soft" type="button" disabled={!!busy || actionsBlocked} onClick={() => applyAction(bundle.bundleId, "REJECTED", "REJECT")}>
                      退回
                    </button>
                    <span className="idea-promotion-block" role="status" title="策略包轉入 SIM 驗證仍需完成交接流程。">
                      SIM 驗證待開啟
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
                : "轉入 SIM 驗證需等待量化研究交接流程完成；核准/退回會更新量化研究正式資料。"}
            </div>
          )}
        </Panel>

        <div className="lab-side-stack">
          <Panel code="LAB-D" title="選取策略包" right={selected ? labDisplay.status[selected.status] : blockedReason ? "暫停" : "無資料"}>
            {selected ? (
              <div className="lab-selected-card">
                <div className="tg gold">策略包 {shortBundleId(selected.bundleId)} / {labDisplay.producer[selected.producer]}</div>
                <h2>{selected.title}</h2>
                <div className="tg soft">{selected.symbol} / {selected.themeCode} / {timeText(selected.createdAt)}</div>
                <p>{safeSummary(selected.summary)}</p>
                <div className="lab-selected-metrics">
                  <span><b>{selected.symbol}</b><small>股票</small></span>
                  <span><b>{selected.themeCode}</b><small>主題</small></span>
                  <span><b className="gold">未核准</b><small>績效不顯示</small></span>
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
              <span>可寫動作：通過 / 退回 / 分歧回饋，只更新量化研究紀錄。</span>
              <span>禁止動作：建立真實券商委託。</span>
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
