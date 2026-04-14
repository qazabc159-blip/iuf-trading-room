"use client";

import { useEffect, useState } from "react";

import {
  getOpenAliceDevices,
  getOpenAliceObservability,
  type OpenAliceDevice,
  type OpenAliceObservability
} from "@/lib/api";

const healthColor: Record<string, string> = {
  healthy: "badge-green",
  stale: "badge-red",
  missing: "badge"
};

function ago(seconds: number | null) {
  if (seconds === null) return "never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
}

export function OpenAliceOps() {
  const [obs, setObs] = useState<OpenAliceObservability | null>(null);
  const [devices, setDevices] = useState<OpenAliceDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [obsRes, devRes] = await Promise.all([
        getOpenAliceObservability(),
        getOpenAliceDevices()
      ]);
      setObs(obsRes.data);
      setDevices(devRes.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !obs) {
    return (
      <div className="panel" style={{ padding: 22 }}>
        <p className="muted">Loading OpenAlice observability...</p>
      </div>
    );
  }

  if (error && !obs) {
    return (
      <div className="panel" style={{ padding: 22 }}>
        <p className="error-text">{error}</p>
      </div>
    );
  }

  const m = obs!.metrics;
  const staleDevicesList = devices.filter((d) => d.stale);
  const activeDevicesList = devices.filter((d) => d.status === "active" && !d.stale);

  return (
    <section style={{ display: "grid", gap: 20 }}>
      {error ? (
        <div className="panel" style={{ padding: "10px 22px" }}>
          <p className="error-text" style={{ margin: 0, fontSize: "0.82rem" }}>{error}</p>
        </div>
      ) : null}

      {/* Health overview */}
      <div className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Worker</p>
              <h3>Heartbeat</h3>
            </div>
            <span className={healthColor[obs!.workerStatus]}>
              {obs!.workerStatus}
            </span>
          </div>
          <p style={{ fontSize: "0.88rem" }}>
            Last beat: <strong>{obs!.workerHeartbeatAt ? new Date(obs!.workerHeartbeatAt).toLocaleTimeString() : "never"}</strong>
          </p>
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            {ago(obs!.workerHeartbeatAgeSeconds)}
          </p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Sweep</p>
              <h3>Maintenance</h3>
            </div>
            <span className={healthColor[obs!.sweepStatus]}>
              {obs!.sweepStatus}
            </span>
          </div>
          <p style={{ fontSize: "0.88rem" }}>
            Last sweep: <strong>{obs!.lastSweepAt ? new Date(obs!.lastSweepAt).toLocaleTimeString() : "never"}</strong>
          </p>
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            {ago(obs!.lastSweepAgeSeconds)} / Source: {obs!.source}
          </p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Mode</p>
              <h3>{m.mode === "database" ? "PostgreSQL" : "Memory"}</h3>
            </div>
          </div>
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            Persistence: {m.mode}
          </p>
        </div>
      </div>

      {/* Queue metrics */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Job Queue</p>
            <h3>Queue Status</h3>
          </div>
          <button
            className="hero-link"
            style={{ padding: "6px 14px", fontSize: "0.82rem" }}
            onClick={() => { setLoading(true); void load(); }}
          >
            Refresh
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{m.queuedJobs}</div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>Queued</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--teal)" }}>{m.runningJobs}</div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>Running</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: m.staleRunningJobs > 0 ? "#b91c1c" : "inherit" }}>
              {m.staleRunningJobs}
            </div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>Stale Running</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{m.terminalJobs}</div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>Terminal</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{m.expiredJobsRequeued}</div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>Requeued</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: m.expiredJobsFailed > 0 ? "#b91c1c" : "inherit" }}>
              {m.expiredJobsFailed}
            </div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>Expired Failed</div>
          </div>
        </div>
      </div>

      {/* Devices */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Devices</p>
            <h3>Registered Agents</h3>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="metric-chip" style={{ padding: "6px 12px", minWidth: "auto" }}>
              <span style={{ fontSize: "0.95rem" }}>{m.activeDevices}</span>
              <small style={{ fontSize: "0.7rem" }}>active</small>
            </div>
            <div className="metric-chip" style={{ padding: "6px 12px", minWidth: "auto" }}>
              <span style={{ fontSize: "0.95rem", color: m.staleDevices > 0 ? "#b91c1c" : "inherit" }}>
                {m.staleDevices}
              </span>
              <small style={{ fontSize: "0.7rem" }}>stale</small>
            </div>
          </div>
        </div>

        {devices.length === 0 ? (
          <p className="muted">No devices registered. Register a device via POST /api/v1/openalice/register.</p>
        ) : (
          <div className="card-stack">
            {/* Stale devices first */}
            {staleDevicesList.map((d) => (
              <div key={d.deviceId} className="record-card" style={{ borderLeft: "3px solid #b91c1c" }}>
                <div className="record-topline">
                  <div>
                    <strong>{d.deviceName}</strong>
                    <span className="muted" style={{ fontSize: "0.78rem", marginLeft: 8 }}>{d.deviceId}</span>
                  </div>
                  <span className="badge-red">stale</span>
                </div>
                <p className="record-meta">
                  Last seen: {new Date(d.lastSeenAt).toLocaleString()}
                  {d.capabilities.length > 0 ? ` / Capabilities: ${d.capabilities.join(", ")}` : null}
                </p>
              </div>
            ))}

            {/* Active devices */}
            {activeDevicesList.map((d) => (
              <div key={d.deviceId} className="record-card">
                <div className="record-topline">
                  <div>
                    <strong>{d.deviceName}</strong>
                    <span className="muted" style={{ fontSize: "0.78rem", marginLeft: 8 }}>{d.deviceId}</span>
                  </div>
                  <span className="badge-green">{d.status}</span>
                </div>
                <p className="record-meta">
                  Last seen: {new Date(d.lastSeenAt).toLocaleString()}
                  / Registered: {new Date(d.registeredAt).toLocaleString()}
                  {d.capabilities.length > 0 ? ` / ${d.capabilities.join(", ")}` : null}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
