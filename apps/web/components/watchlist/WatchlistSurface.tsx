import type { CSSProperties } from "react";

import type { WatchlistOverview } from "@/lib/api";
import { WatchlistTable } from "./WatchlistTable";

export type WatchlistSurfaceState =
  | { state: "LIVE"; data: WatchlistOverview; updatedAt: string; source: string }
  | { state: "BLOCKED"; updatedAt: string; source: string; reason: string };

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

export function WatchlistSurface({ result }: { result: WatchlistSurfaceState }) {
  if (result.state === "BLOCKED") {
    return (
      <div>
        <div className="tg soft" style={sourceStyle}>
          <span style={{ color: "var(--tw-up-bright)", fontWeight: 700 }}>BLOCKED</span>
          <span>{result.source}</span>
          <span>checked {formatTime(result.updatedAt)}</span>
        </div>
        <div className="terminal-note">
          <span className="tg down">BLOCKED</span>{" "}
          Watchlist is hidden because the overview endpoint is unavailable: {result.reason}. Owner: Jason backend Contract 3 route, Codex frontend wire.
        </div>
      </div>
    );
  }

  const { data } = result;
  return (
    <div>
      <div className="tg soft" style={sourceStyle}>
        <span style={{ color: "var(--tw-dn-bright)", fontWeight: 700 }}>LIVE</span>
        <span>{data.source}</span>
        <span>generated {formatTime(data.generatedAt)}</span>
        <span>kill {data.killSwitchState}</span>
        <span>paper {data.paperGateState}</span>
      </div>
      {data.warnings.map((warning) => (
        <div className="terminal-note" key={warning}>
          <span className="tg gold">PARTIAL</span> {warning}
        </div>
      ))}
      {data.rows.length === 0 ? (
        <div className="terminal-note">
          <span className="tg gold">EMPTY</span> Watchlist store returned zero symbols for this workspace.
        </div>
      ) : (
        <WatchlistTable rows={data.rows} />
      )}
    </div>
  );
}

const sourceStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 14px",
  margin: "10px 0 12px",
};
