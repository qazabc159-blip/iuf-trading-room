"use client";

import { useEffect, useState, useCallback } from "react";

import { unwrapEventLogApiPayload } from "@/lib/eventlog-api-payload";
import { normalizeOutboxDiag, outboxPendingLabel } from "@/lib/eventlog-outbox";

const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "")
    : "";

const CSS = `
  ._ev-shell {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 900px) {
    ._ev-shell { grid-template-columns: 1fr; }
  }
  ._ev-sidebar {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    overflow: hidden;
    background: rgba(0,0,0,0.2);
  }
  ._ev-sidebar-head {
    padding: 8px 12px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.07);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  ._ev-stream-row {
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    transition: background 0.1s;
  }
  ._ev-stream-row:last-child { border-bottom: none; }
  ._ev-stream-row:hover { background: rgba(255,255,255,0.04); }
  ._ev-stream-row.selected { background: rgba(255,184,0,0.1); border-left: 2px solid #ffb800; }
  ._ev-stream-type {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    margin-bottom: 2px;
  }
  ._ev-stream-id {
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    font-family: var(--mono, monospace);
    font-weight: 500;
  }
  ._ev-main {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  ._ev-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    flex-wrap: wrap;
  }
  ._ev-toolbar-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }
  ._ev-datetime-input {
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    font-family: var(--mono, monospace);
  }
  ._ev-btn {
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid rgba(255,184,0,0.3);
    background: rgba(255,184,0,0.1);
    color: #ffb800;
    transition: background 0.1s;
  }
  ._ev-btn:hover { background: rgba(255,184,0,0.2); }
  ._ev-btn:disabled { opacity: 0.5; cursor: default; }
  ._ev-btn-clear {
    border-color: rgba(255,255,255,0.12);
    background: transparent;
    color: rgba(255,255,255,0.5);
  }
  ._ev-btn-clear:hover { background: rgba(255,255,255,0.05); }
  ._ev-outbox-badge {
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
  }
  ._ev-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  ._ev-table th {
    text-align: left;
    padding: 6px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  ._ev-table td {
    padding: 7px 10px;
    color: rgba(255,255,255,0.75);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-family: var(--mono, monospace);
    vertical-align: top;
  }
  ._ev-table tr:last-child td { border-bottom: none; }
  ._ev-table tr:hover td { background: rgba(255,255,255,0.02); }
  ._ev-payload {
    font-size: 10px;
    color: rgba(255,255,255,0.45);
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ._ev-state-card {
    padding: 16px;
    border: 1px dashed rgba(255,184,0,0.34);
    border-left: 3px solid #ffb800;
    border-radius: 6px;
    background: rgba(255,184,0,0.055);
    color: rgba(255,255,255,0.76);
    font-size: 12px;
    line-height: 1.65;
  }
  ._ev-state-title {
    color: rgba(255,255,255,0.92);
    font-weight: 800;
    margin-bottom: 6px;
  }
  ._ev-state-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;
    margin-top: 10px;
  }
  ._ev-state-grid > div {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 5px;
    padding: 8px 10px;
    background: rgba(0,0,0,0.22);
  }
  ._ev-state-label {
    display: block;
    margin-bottom: 3px;
    color: #ffb800;
    font: 800 10px/1 var(--mono, monospace);
    text-transform: uppercase;
  }
  ._ev-empty {
    padding: 24px;
    text-align: center;
    color: rgba(255,255,255,0.3);
    font-size: 12px;
  }
  ._ev-filter-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding: 6px 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px;
  }
  ._ev-filter-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ._ev-filter-btn {
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,0.1);
    background: transparent;
    color: rgba(255,255,255,0.5);
    transition: background 0.1s;
  }
  ._ev-filter-btn:hover { background: rgba(255,255,255,0.05); }
  ._ev-filter-btn.active {
    background: rgba(255,184,0,0.15);
    border-color: rgba(255,184,0,0.4);
    color: #ffb800;
    font-weight: 600;
  }
`;

type StreamEntry = {
  streamType: string;
  streamId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
};

type EventEntry = {
  id: string;
  streamId: string;
  seq: number;
  eventType: string;
  schemaVersion: number;
  actorId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  recordedAt: string;
};

type OutboxDiag = {
  pendingCount: number;
  fatalCount: number;
  oldestPendingAt: string | null;
  isPollerRunning?: boolean;
};

const EVENT_STREAMS_ENDPOINT = "/api/v1/event-streams";
const OUTBOX_DIAG_ENDPOINT = "/api/v1/admin/event-log/outbox/diag";

function fmtDT(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-TW", { hour12: false });
  } catch {
    return iso;
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const res = await fetch(`${base}${path}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json() as T | { data?: T };
  return unwrapEventLogApiPayload<T>(json);
}

function EventLogTruthState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="_ev-state-card">
      <div className="_ev-state-title">{title}</div>
      <div>{detail}</div>
      <div className="_ev-state-grid">
        <div>
          <span className="_ev-state-label">資料來源</span>
          <div>事件流讀取 API</div>
          <div>Outbox 診斷資料</div>
        </div>
        <div>
          <span className="_ev-state-label">資料狀態</span>
          <div>管理登入後讀取正式資料</div>
        </div>
        <div>
          <span className="_ev-state-label">下一步</span>
          <div>確認登入狀態、事件流資料表與 outbox worker 是否正常。</div>
        </div>
      </div>
    </div>
  );
}

export default function EventsAdminPage() {
  const [streams, setStreams] = useState<StreamEntry[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(true);
  const [streamsError, setStreamsError] = useState(false);
  const [filterType, setFilterType] = useState<string>("");

  const [selectedStream, setSelectedStream] = useState<StreamEntry | null>(null);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState(false);

  const [asOf, setAsOf] = useState("");
  const [timeTravelMode, setTimeTravelMode] = useState(false);

  const [outbox, setOutbox] = useState<OutboxDiag | null>(null);
  const [outboxError, setOutboxError] = useState(false);

  // Load streams
  useEffect(() => {
    let cancelled = false;
    setStreamsLoading(true);
    setStreamsError(false);
    apiFetch<{ streams: StreamEntry[]; total: number }>("/api/v1/event-streams")
      .then((d) => {
        if (!cancelled) {
          setStreams(d.streams ?? []);
          setStreamsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStreamsError(true);
          setStreamsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Load outbox diag
  useEffect(() => {
    let cancelled = false;
    setOutboxError(false);
    apiFetch<OutboxDiag>("/api/v1/admin/event-log/outbox/diag")
      .then((d) => { if (!cancelled) setOutbox(d); })
      .catch(() => { if (!cancelled) setOutboxError(true); });
    return () => { cancelled = true; };
  }, []);

  const loadEvents = useCallback((stream: StreamEntry, asOfIso?: string) => {
    let cancelled = false;
    setEventsLoading(true);
    setEventsError(false);

    const path = asOfIso
      ? `/api/v1/event-streams/${encodeURIComponent(stream.streamType)}/${encodeURIComponent(stream.streamId)}/events/at?as_of=${encodeURIComponent(asOfIso)}`
      : `/api/v1/event-streams/${encodeURIComponent(stream.streamType)}/${encodeURIComponent(stream.streamId)}/events?limit=50`;

    (asOfIso
      ? apiFetch<{ events: EventEntry[]; asOf: string }>(path)
      : apiFetch<{ events: EventEntry[]; nextCursor: number | null }>(path)
    )
      .then((d: { events: EventEntry[] }) => {
        if (!cancelled) {
          setEvents(d.events ?? []);
          setEventsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEventsError(true);
          setEventsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  function handleSelectStream(stream: StreamEntry) {
    setSelectedStream(stream);
    setTimeTravelMode(false);
    setAsOf("");
    loadEvents(stream);
  }

  function handleTimeTravel() {
    if (!selectedStream || !asOf) return;
    setTimeTravelMode(true);
    loadEvents(selectedStream, asOf);
  }

  function handleClearTimeTravel() {
    setTimeTravelMode(false);
    setAsOf("");
    if (selectedStream) loadEvents(selectedStream);
  }

  const streamTypes = [...new Set(streams.map((s) => s.streamType))].sort();
  const filteredStreams = filterType ? streams.filter((s) => s.streamType === filterType) : streams;
  const normalizedOutbox = normalizeOutboxDiag(outbox);
  const eventLogBlocked = streamsError;
  const eventLogEmpty = !streamsLoading && !streamsError && streams.length === 0;

  return (
    <>
      <style>{CSS}</style>
      <main className="page-frame">
        <header className="page-head">
          <div className="page-title">
            <span className="tg page-code">管理</span>
            <h1>EventLog 時間軸瀏覽器</h1>
            <span className="tc">OpenAlice Phase A</span>
          </div>
          <div className="tg meta-strip">
            <span>管理頁</span>
            {normalizedOutbox && (
              <span>
                Outbox 待發{" "}
                <span
                  className="_ev-outbox-badge"
                  style={normalizedOutbox.hasInvalidCounts || (normalizedOutbox.pendingCount ?? 0) > 0
                    ? { background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" }
                    : { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" }
                  }
                >
                  {outboxPendingLabel(normalizedOutbox)}
                </span>
                {!normalizedOutbox.hasInvalidCounts && (normalizedOutbox.fatalCount ?? 0) > 0 && (
                  <span className="_ev-outbox-badge" style={{ marginLeft: 4, background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.3)" }}>
                    fatal: {normalizedOutbox.fatalCount}
                  </span>
                )}
              </span>
            )}
          </div>
        </header>
        <div className="terminal-note">EventLog 事件流 / 時間回溯查詢 — 選左側 stream → 查看事件序列。</div>
        {normalizedOutbox?.hasInvalidCounts && (
          <div style={{ marginBottom: 12 }}>
            <EventLogTruthState
              title="EventLog Outbox 診斷數值異常"
              detail="Outbox 診斷資料回傳負數或不可用數值；前端不把它顯示成負數待發，也不假裝為 0。請檢查 outbox 診斷 SQL 與 worker 狀態。"
            />
          </div>
        )}
        {eventLogBlocked && !normalizedOutbox?.hasInvalidCounts && (
          <div style={{ marginBottom: 12 }}>
            <EventLogTruthState
              title="EventLog 目前無法讀取正式資料"
              detail="目前登入狀態尚未通過 EventLog 管理資料讀取；前端不補假事件，也不把同步中當成正常資料。"
            />
          </div>
        )}
        {!eventLogBlocked && eventLogEmpty && (
          <div style={{ marginBottom: 12 }}>
            <EventLogTruthState
              title="目前尚無 EventLog 事件流"
              detail="後端資料可讀，但目前沒有 audit、OpenAlice job、paper order/fill 或 alert 事件；這是正式 empty state。"
            />
          </div>
        )}

        {/* Stream type filter */}
        {streamTypes.length > 0 && (
          <div className="_ev-filter-row" style={{ marginBottom: 10 }}>
            <span className="_ev-filter-lbl">類型</span>
            <button type="button" className={`_ev-filter-btn${filterType === "" ? " active" : ""}`} onClick={() => setFilterType("")}>全部</button>
            {streamTypes.map((t) => (
              <button key={t} type="button" className={`_ev-filter-btn${filterType === t ? " active" : ""}`} onClick={() => setFilterType(t)}>{t}</button>
            ))}
          </div>
        )}

        <div className="_ev-shell">
          {/* Left sidebar: stream list */}
          <div className="_ev-sidebar">
            <div className="_ev-sidebar-head">
              <span>事件流</span>
              <span>{filteredStreams.length} 個</span>
            </div>
            {streamsLoading && <div className="_ev-empty">載入中…</div>}
            {streamsError && (
              <div className="_ev-empty" style={{ color: "#ef5350" }}>
                EventLog 資料目前不可讀
              </div>
            )}
            {!streamsLoading && !streamsError && filteredStreams.length === 0 && (
              <div className="_ev-empty">目前尚無事件流，不顯示假 stream。</div>
            )}
            {filteredStreams.map((s) => {
              const isSelected = selectedStream?.streamType === s.streamType && selectedStream?.streamId === s.streamId;
              return (
                <div
                  key={`${s.streamType}:${s.streamId}`}
                  className={`_ev-stream-row${isSelected ? " selected" : ""}`}
                  onClick={() => handleSelectStream(s)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && handleSelectStream(s)}
                >
                  <div className="_ev-stream-type">{s.streamType}</div>
                  <div className="_ev-stream-id">{s.streamId}</div>
                </div>
              );
            })}
          </div>

          {/* Main panel */}
          <div className="_ev-main">
            {/* Toolbar: time-travel */}
            <div className="_ev-toolbar">
              <span className="_ev-toolbar-lbl">時間回溯</span>
              <input
                className="_ev-datetime-input"
                type="datetime-local"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                disabled={!selectedStream}
              />
              <button
                type="button"
                className="_ev-btn"
                disabled={!selectedStream || !asOf}
                onClick={handleTimeTravel}
              >
                查詢
              </button>
              {timeTravelMode && (
                <button type="button" className="_ev-btn _ev-btn-clear" onClick={handleClearTimeTravel}>
                  回到最新
                </button>
              )}
              {timeTravelMode && (
                <span style={{ fontSize: 10, color: "#ffb800" }}>時間回溯模式 — {asOf}</span>
              )}
            </div>

            {/* Events table */}
            <section className="panel">
              <div className="panel-head">
                <div>
                  <span className="tg panel-code">管理</span>
                  <span className="tg muted"> / </span>
                  <span className="tg gold">
                    {selectedStream ? `${selectedStream.streamType} / ${selectedStream.streamId}` : "請選擇事件流"}
                  </span>
                </div>
                <div className="tg soft">
                  {eventsLoading ? "載入中…" : `${events.length} 筆`}
                </div>
              </div>

              {!selectedStream && eventLogBlocked && (
                <EventLogTruthState
                  title="EventLog 事件流尚未可讀"
                  detail="目前無法載入事件流，因此時間回溯與事件序列先停用；這不是正常同步中，也不會用假事件填畫面。"
                />
              )}
              {!selectedStream && !eventLogBlocked && eventLogEmpty && (
                <EventLogTruthState
                  title="目前尚無 EventLog 事件"
                  detail="EventLog 資料可讀但沒有事件；待 audit log、OpenAlice job、paper order/fill 或 alert 寫入後會出現在這裡。"
                />
              )}
              {!selectedStream && !eventLogBlocked && !eventLogEmpty && (
                <div className="_ev-empty">← 請從左側選擇一個事件流</div>
              )}
              {selectedStream && eventsLoading && (
                <div className="_ev-empty">載入事件中…</div>
              )}
              {selectedStream && eventsError && (
                <EventLogTruthState
                  title="此事件流目前無法讀取"
                  detail="事件序列資料回傳錯誤；請重新驗證管理登入狀態，若仍失敗再檢查 EventLog 讀取路徑。"
                />
              )}
              {selectedStream && !eventsLoading && !eventsError && events.length === 0 && (
                <div className="_ev-empty">此事件流尚無事件記錄</div>
              )}
              {selectedStream && !eventsLoading && !eventsError && events.length > 0 && (
                <table className="_ev-table">
                  <thead>
                    <tr>
                      <th>seq</th>
                      <th>event_type</th>
                      <th>occurred_at</th>
                      <th>recorded_at</th>
                      <th>payload 預覽</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id}>
                        <td style={{ color: "#ffb800" }}>{ev.seq}</td>
                        <td>{ev.eventType}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDT(ev.occurredAt)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDT(ev.recordedAt)}</td>
                        <td>
                          <div className="_ev-payload">{JSON.stringify(ev.payload)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
