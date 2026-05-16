import type { CSSProperties } from "react";

import type { WatchlistOverview } from "@/lib/api";
import { WatchlistTable } from "./WatchlistTable";

const WATCHLIST_CAP = 10;

export type WatchlistSurfaceState =
  | { state: "LIVE"; data: WatchlistOverview; updatedAt: string; source: string }
  | { state: "BLOCKED"; updatedAt: string; source: string; reason: string };

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function gateLabel(value: string | null | undefined) {
  if (value === "trading") return "SIM 檢查通過";
  if (value === "paper_only") return "僅模擬";
  if (value === "liquidate_only") return "只減倉";
  if (value === "halted") return "暫停";
  if (value === "ARMED") return "啟用";
  if (value === "ENGAGED") return "鎖定";
  if (value === "ok") return "正常";
  if (value === "warn") return "警示";
  if (value === "block") return "阻擋";
  if (value === "blocked_killswitch") return "風控鎖定";
  return value ?? "--";
}

export function WatchlistSurface({ result }: { result: WatchlistSurfaceState }) {
  if (result.state === "BLOCKED") {
    return (
      <div>
        <div className="tg soft" style={sourceStyle}>
          <span className="down" style={{ fontWeight: 700 }}>暫停</span>
          <span>觀察清單</span>
          <span>檢查 {formatTime(result.updatedAt)}</span>
        </div>
        <div className="terminal-note">
          <span className="tg down">暫停</span>{" "}
          觀察清單暫時無法讀取：{result.reason}
        </div>
      </div>
    );
  }

  const { data } = result;
  const isFull = data.rows.length >= WATCHLIST_CAP;
  return (
    <div>
      <div className="tg soft" style={sourceStyle}>
        <span className="up" style={{ fontWeight: 700 }}>真實資料</span>
        <span>觀察清單</span>
        <span>更新 {formatTime(data.generatedAt)}</span>
        <span>風控 {gateLabel(data.killSwitchState)}</span>
        <span>模擬交易 {gateLabel(data.paperGateState)}</span>
        <span
          style={hintStyle}
          title="即時觀察清單上限 10 檔，可隨時調整成員"
        >
          ⓘ 上限 {WATCHLIST_CAP} 檔
        </span>
      </div>
      {isFull && (
        <div className="terminal-note" style={capWarningStyle}>
          <span className="tg gold">觀察清單已滿 ({data.rows.length}/{WATCHLIST_CAP})</span>
          {" "}移除一檔後再加，或聯絡管理員提升額度。
        </div>
      )}
      {data.warnings.map((warning) => (
        <div className="terminal-note" key={warning}>
          <span className="tg gold">注意</span> {warning}
        </div>
      ))}
      {data.rows.length === 0 ? (
        <div className="terminal-note">
          <span className="tg gold">無資料</span> 尚未建立觀察清單。
        </div>
      ) : (
        <WatchlistTable rows={data.rows} cap={WATCHLIST_CAP} />
      )}
    </div>
  );
}

const sourceStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 14px",
  margin: "12px 0 14px",
};

const hintStyle: CSSProperties = {
  cursor: "help",
  color: "var(--exec-soft, #7a8a9a)",
  fontSize: 11,
  letterSpacing: "0.03em",
};

const capWarningStyle: CSSProperties = {
  borderLeft: "3px solid var(--gold, #c8943f)",
  paddingLeft: 10,
  marginBottom: 8,
};
