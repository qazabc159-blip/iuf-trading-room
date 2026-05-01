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
    const pending = bundles.filter((bundle) => bundle.status === "NEW").length;
    const approved = bundles.filter((bundle) => bundle.status === "APPROVED").length;
    const pushed = bundles.filter((bundle) => bundle.status === "PUSHED").length;
    const avgConfidence = bundles.length ? bundles.reduce((sum, bundle) => sum + bundle.confidence, 0) / bundles.length : 0;
    const avgReturn = bundles.length ? bundles.reduce((sum, bundle) => sum + bundle.backtest.totalReturnPct, 0) / bundles.length : 0;
    const worstDrawdown = bundles.length ? Math.min(...bundles.map((bundle) => bundle.backtest.maxDrawdownPct)) : 0;
    return [
      { label: "NEW", value: pending, tone: "muted" as const },
      { label: "APPROVED", value: approved, tone: "down" as const },
      { label: "PUSHED", value: pushed, tone: "gold" as const },
      { label: "AVG CONF", value: `${Math.round(avgConfidence * 100)}%`, tone: "muted" as const },
      { label: "AVG RETURN", value: `${signed(avgReturn, 1)}%`, tone: toneClass(avgReturn) },
      { label: "MAX DD", value: `${worstDrawdown.toFixed(1)}%`, tone: worstDrawdown < -6 ? "up" as const : "muted" as const },
    ];
  }, [bundles]);

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
      title="Quant Lab Intake"
      sub={blockedReason ? "BLOCKED" : "Signal bundles"}
      note="[LAB] Strategy bundle intake. Production requires real /api/v1/lab/bundles data; no mock bundle data is shown as live."
    >
      <MetricStrip columns={6} cells={cells} />

      <div className="company-grid">
        <Panel code="LAB-Q" title="Bundle Queue" right={blockedReason ? "BLOCKED" : `${bundles.length} BUNDLES`}>
          {blockedReason ? (
            <div className="terminal-note">
              BLOCKED: Quant Lab bundle API is unavailable. Owner: Athena + Jason. Detail: {blockedReason}
            </div>
          ) : bundles.length === 0 ? (
            <div className="terminal-note">EMPTY: /api/v1/lab/bundles returned no bundle rows.</div>
          ) : (
            <>
              <div className="row table-head lab-row">
                <span>ID</span>
                <span>Producer</span>
                <span>Title</span>
                <span>Symbol</span>
                <span>Conf</span>
                <span>Status</span>
                <span>Actions</span>
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
                      Approve
                    </button>
                    <button className="outline-button" type="button" disabled={!!busy || actionsBlocked} onClick={() => applyAction(bundle.bundleId, "REJECTED", "REJECT")}>
                      Reject
                    </button>
                    <button className="outline-button" type="button" disabled title="BLOCKED: strategy bundle to portfolio handoff contract is not ready.">
                      Push
                    </button>
                  </span>
                </div>
              ))}
            </>
          )}
          {(actionError || (!blockedReason && bundles.length > 0)) && (
            <div className="terminal-note" style={{ marginTop: 12 }}>
              {actionError
                ? `BLOCKED: lab action endpoint failed. ${actionError}`
                : "Push-to-portfolio is BLOCKED until Jason/Athena define the handoff contract. Approve/Reject require the lab action endpoint to respond successfully."}
            </div>
          )}
        </Panel>

        <div>
          <Panel code="LAB-D" title="Selected Bundle" right={selected ? labDisplay.status[selected.status] : blockedReason ? "BLOCKED" : "EMPTY"}>
            {selected ? (
              <div className="ticket">
                <div className="tg gold">{selected.bundleId} / {labDisplay.producer[selected.producer]}</div>
                <h2 className="tc" style={{ margin: "10px 0 6px", fontSize: 26 }}>{selected.title}</h2>
                <div className="tg soft">{selected.symbol} / {selected.themeCode} / {timeText(selected.createdAt)}</div>
                <p className="tc" style={{ color: "var(--night-ink)", lineHeight: 1.8 }}>{selected.summary}</p>
                <div className="row position-row">
                  <span className="tg muted">Win</span>
                  <span className="num down">{Math.round(selected.backtest.winRate * 100)}%</span>
                  <span className="tg muted">Return</span>
                  <span className={`num ${toneClass(selected.backtest.totalReturnPct)}`}>{signed(selected.backtest.totalReturnPct, 1)}%</span>
                  <span className="tg muted">Max DD</span>
                  <span className="num up">{selected.backtest.maxDrawdownPct.toFixed(1)}%</span>
                </div>
                <Link className="mini-button" href={`/lab/${selected.bundleId}`} style={{ marginTop: 12 }}>
                  Open Detail
                </Link>
              </div>
            ) : (
              <div className="terminal-note">
                {blockedReason ? "BLOCKED: no real lab bundle can be displayed." : "EMPTY: no lab bundle selected."}
              </div>
            )}
          </Panel>

          <Panel code="LAB-MEMO" title="Governance" right="NO LIVE ORDER">
            <div className="terminal-note">
              Lab review is read/write only against the lab API. It does not create broker orders, does not promote migration 0020, and does not enable live submit.
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
