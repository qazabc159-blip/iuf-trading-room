"use client";

import { useCallback, useEffect, useState } from "react";

import { getOpsSnapshot, getSession, type OpsSnapshotData } from "@/lib/api";
import type { AppSession } from "@iuf-trading-room/contracts";

const SESSION_KEY = "iuf_booted_v1";
const LINE_DELAY_MS = 90;
const HOLD_AFTER_MS = 260;
const FADE_OUT_MS = 240;

type BootLine = { label: string; value: string; status?: "OK" | "WAIT" | "ERR" };

function buildLines(session: AppSession | null, snap: OpsSnapshotData | null): BootLine[] {
  return [
    { label: "IUF KERNEL", value: "v1.0 · TAIWAN EQUITY WAR ROOM" },
    { label: "WORKSPACE", value: session?.workspace.name ?? "primary-desk" },
    { label: "PERSISTENCE", value: session?.persistenceMode === "database" ? "PostgreSQL · LIVE" : String(session?.persistenceMode ?? "memory") },
    {
      label: "INDEX",
      value: snap
        ? `${snap.stats.companies} COMPANIES · ${snap.stats.themes} THEMES`
        : "LOADING..."
    },
    {
      label: "OPENALICE",
      value: snap
        ? (snap.openAlice.observability.workerStatus).toUpperCase()
        : "—",
      status: snap?.openAlice.observability.workerStatus === "healthy" ? "OK" : "WAIT"
    },
    {
      label: "SIGNALS",
      value: snap ? `${snap.stats.signals} TOTAL · ${snap.stats.bullishSignals} BULL` : "—"
    },
    { label: "READY", value: "─────────────────────" }
  ];
}

export function BootSequence() {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [session, setSession] = useState<AppSession | null>(null);
  const [snap, setSnap] = useState<OpsSnapshotData | null>(null);

  // 只在第一次進 tab 時跑（sessionStorage 記住）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const already = window.sessionStorage.getItem(SESSION_KEY);
    const forceBoot = new URLSearchParams(window.location.search).get("boot") === "1";
    if (!already || forceBoot) {
      setVisible(true);
      // 拉真實資料塞進去，載不到也沒關係，fallback 已經處理
      getSession().then((r) => setSession(r.data)).catch(() => {});
      getOpsSnapshot().then((r) => setSnap(r.data)).catch(() => {});
    }
  }, []);

  const finish = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    }
    setFading(true);
    setTimeout(() => setVisible(false), FADE_OUT_MS);
  }, []);

  // 逐行揭露
  useEffect(() => {
    if (!visible || fading) return;
    const lines = buildLines(session, snap);
    if (revealed >= lines.length) {
      const t = setTimeout(finish, HOLD_AFTER_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRevealed((n) => n + 1), LINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, fading, revealed, session, snap, finish]);

  // 任意鍵 / 點擊跳過
  useEffect(() => {
    if (!visible) return;
    const skip = () => finish();
    window.addEventListener("keydown", skip);
    window.addEventListener("click", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("click", skip);
    };
  }, [visible, finish]);

  if (!visible) return null;

  const lines = buildLines(session, snap);
  const shown = lines.slice(0, revealed);

  return (
    <div className={`boot-overlay${fading ? " fading" : ""}`} aria-hidden="true">
      <div className="boot-panel">
        <div className="boot-title">
          ╔══════════════════════════════════════╗<br />
          ║  IUF · 台股 AI 交易戰情室 · BOOT  ║<br />
          ╚══════════════════════════════════════╝
        </div>
        <div className="boot-lines">
          {shown.map((line, idx) => (
            <div className="boot-line" key={idx}>
              <span className={`boot-status ${line.status === "WAIT" ? "wait" : line.status === "ERR" ? "err" : "ok"}`}>
                [{line.status ?? "OK"}]
              </span>
              <span className="boot-label">{line.label}</span>
              <span className="boot-sep">:</span>
              <span className="boot-value">{line.value}</span>
            </div>
          ))}
          {revealed < lines.length && <span className="boot-cursor">█</span>}
        </div>
        <div className="boot-hint">任意鍵略過</div>
      </div>
    </div>
  );
}
