"use client";

/* ─────────────────────────────────────────────────────────────────
   OpenAliceAwaitingDevice.tsx
   場景：ops 頁 OpenAlice 狀態區，devices=0 且 jobs=0
   Producer awareness：
     - 告知 worker heartbeat 存在（worker 在跑），但無 producer device
     - 與 SignalFeedEmpty 協同：signal 少的根因是這裡
   ───────────────────────────────────────────────────────────────── */

import type { OpenAliceObservability } from "@/lib/api";

export interface OpenAliceAwaitingDeviceProps {
  /** 來自 /api/v1/openalice/observability 的完整資料 */
  observability: OpenAliceObservability;
  /** 目前已知 device 數量 */
  deviceCount: number;
  /** 目前已知 job 數量 */
  jobCount: number;
}

const WORKER_STATUS_LABEL: Record<string, string> = {
  healthy: "運作中",
  stale:   "逾時（heartbeat 超時）",
  missing: "無 heartbeat 紀錄",
};

const WORKER_STATUS_DOT: Record<string, string> = {
  healthy: "green",
  stale:   "yellow",
  missing: "red",
};

function formatHeartbeat(iso: string | null, ageSeconds: number | null): string {
  if (!iso) return "尚無 heartbeat 紀錄";
  const age = ageSeconds != null ? `${ageSeconds}s 前` : "";
  try {
    const d = new Date(iso);
    const ts = d.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return age ? `${ts}（${age}）` : ts;
  } catch {
    return iso;
  }
}

export function OpenAliceAwaitingDevice({
  observability,
  deviceCount,
  jobCount,
}: OpenAliceAwaitingDeviceProps) {
  const workerDotClass = WORKER_STATUS_DOT[observability.workerStatus] ?? "red";
  const workerStatusLabel = WORKER_STATUS_LABEL[observability.workerStatus] ?? observability.workerStatus;

  return (
    <div className="openalice-awaiting-device">
      {/* ── HUD header ── */}
      <div className="empty-hud-header">
        <span className="empty-hud-bracket">[</span>
        <span className="empty-hud-label">OPENALICE · DEVICE GATEWAY</span>
        <span className="empty-hud-bracket">]</span>
      </div>

      <div className="empty-ascii-rule">────────────────────────────────</div>

      {/* ── Core message ── */}
      <div className="empty-icon-row">
        <span className="empty-icon phosphor">⬡</span>
        <span className="empty-headline-inline">等待首個 OpenAlice device 註冊</span>
      </div>

      <p className="empty-body">
        AI agent 尚未連上本工作區。
        <br />
        Devices 數量：<span className="empty-count">{deviceCount}</span>
        {" · "}
        Jobs 數量：<span className="empty-count">{jobCount}</span>
      </p>

      {/* ── Worker heartbeat evidence ── */}
      <div className="empty-producer-hint openalice-heartbeat-panel">
        <div className="openalice-heartbeat-header">
          <span className="empty-hud-bracket">[</span>
          <span className="empty-producer-label">WORKER HEARTBEAT</span>
          <span className="empty-hud-bracket">]</span>
          <span className={`empty-dot ${workerDotClass} ml-2`} />
          <span className="openalice-worker-status-label">{workerStatusLabel}</span>
        </div>
        <div className="openalice-heartbeat-rows">
          <div className="openalice-heartbeat-row">
            <span className="openalice-hb-key">worker 狀態</span>
            <span className="openalice-hb-val">{workerStatusLabel}</span>
          </div>
          <div className="openalice-heartbeat-row">
            <span className="openalice-hb-key">上次 heartbeat</span>
            <span className="openalice-hb-val mono">
              {formatHeartbeat(
                observability.workerHeartbeatAt,
                observability.workerHeartbeatAgeSeconds
              )}
            </span>
          </div>
          <div className="openalice-heartbeat-row">
            <span className="openalice-hb-key">sweep 狀態</span>
            <span className="openalice-hb-val">
              {WORKER_STATUS_LABEL[observability.sweepStatus] ?? observability.sweepStatus}
            </span>
          </div>
          <div className="openalice-heartbeat-row">
            <span className="openalice-hb-key">佇列模式</span>
            <span className="openalice-hb-val mono">{observability.metrics.mode}</span>
          </div>
          <div className="openalice-heartbeat-row">
            <span className="openalice-hb-key">active devices</span>
            <span className="openalice-hb-val mono">{observability.metrics.activeDevices}</span>
          </div>
          <div className="openalice-heartbeat-row">
            <span className="openalice-hb-key">queued jobs</span>
            <span className="openalice-hb-val mono">{observability.metrics.queuedJobs}</span>
          </div>
        </div>
        <p className="openalice-heartbeat-note">
          Worker process 正常運作（heartbeat 在），
          但目前沒有任何 AI device 連線傳送 job。
          <br />
          這是 OpenAlice 尚無 producer 的正常待機狀態。
        </p>
      </div>

      {/* ── What to expect ── */}
      <div className="empty-producer-hint">
        <span className="empty-hud-bracket">[</span>
        <span className="empty-producer-label">PRODUCER 條件</span>
        <span className="empty-hud-bracket">]</span>
        <span className="empty-producer-body">
          需要至少一個 AI agent device 完成 API key 註冊並呼叫 device heartbeat 端點後，
          Jobs 才會開始進入佇列。
        </span>
      </div>

      <div className="empty-ascii-rule">────────────────────────────────</div>

      <p className="empty-status-line">
        <span className={`empty-dot ${workerDotClass}`} />
        {" "}WORKER {observability.workerStatus.toUpperCase()} · 0 DEVICE · 0 JOB
      </p>
    </div>
  );
}

export default OpenAliceAwaitingDevice;
