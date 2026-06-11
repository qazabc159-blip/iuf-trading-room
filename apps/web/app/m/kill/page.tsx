import { getKillSwitch } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

export const dynamic = "force-dynamic";

const ACCOUNT_ID = "paper-default";
const ACCOUNT_LABEL = "模擬帳戶";
const MODES = [
  { mode: "trading", label: "SIM 檢查通過", sub: "通過後端風控後，只允許建立模擬委託", accent: "#4caf50", active: true },
  { mode: "paper_only", label: "模擬模式", sub: "策略與委託都只留在模擬交易層", accent: "#ffb800", active: false },
  { mode: "liquidate_only", label: "只減倉", sub: "只允許降低模擬曝險的委託", accent: "#ff9800", active: false },
  { mode: "halted", label: "全鎖定", sub: "停止新增模擬委託，等待風控處理", accent: "#ef5350", active: false },
] as const;

type KillState = Awaited<ReturnType<typeof getKillSwitch>>["data"];
type LoadState =
  | { state: "LIVE"; data: KillState | null; updatedAt: string; source: string }
  | { state: "BLOCKED"; data: KillState | null; updatedAt: string; source: string; reason: string };

async function loadKill(): Promise<LoadState> {
  const source = `GET /api/v1/risk/kill-switch?accountId=${ACCOUNT_ID}`;
  const updatedAt = new Date().toISOString();
  try {
    const envelope = await getKillSwitch(ACCOUNT_ID);
    return {
      state: "LIVE",
      data: envelope.data,
      updatedAt: envelope.data.updatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: null,
      updatedAt,
      source,
      reason: friendlyDataError(error, "交易模式暫時無法讀取。"),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // Server component renders on Railway (UTC) — must pin Taipei or the clock shows UTC.
  return date.toLocaleTimeString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" });
}

function modeAccent(mode: string): string {
  return MODES.find((m) => m.mode === mode)?.accent ?? "#888";
}

function modeLabel(mode: string): string {
  return MODES.find((m) => m.mode === mode)?.label ?? "未知狀態";
}

function modeSub(mode: string): string {
  return MODES.find((m) => m.mode === mode)?.sub ?? "模式未知";
}

const KILL_CSS = `
  ._bty-kill-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 20px 16px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  ._bty-kill-title {
    font-size: 22px;
    font-weight: 700;
    color: rgba(255,255,255,0.9);
    margin: 4px 0 6px;
    line-height: 1.2;
  }
  ._bty-kill-sub {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
  }
  ._bty-kill-status-pill {
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border-radius: 14px;
    font-size: 12px;
    font-weight: 600;
  }
  ._bty-kill-hero {
    margin: 16px 12px;
    padding: 20px 16px;
    border-radius: 12px;
    background: var(--_mode-bg, rgba(100,100,100,0.12));
    border: 2px solid var(--_mode-border, rgba(100,100,100,0.3));
    text-align: center;
  }
  ._bty-kill-hero-mode {
    font-size: 36px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: var(--_mode-color, #888);
    margin-bottom: 6px;
  }
  ._bty-kill-hero-sub {
    font-size: 13px;
    color: rgba(255,255,255,0.5);
    line-height: 1.5;
  }
  ._bty-kill-hero-ts {
    font-size: 11px;
    color: rgba(255,255,255,0.35);
    margin-top: 10px;
    font-family: var(--mono, monospace);
  }
  ._bty-kill-section {
    padding: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  ._bty-kill-section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  ._bty-kill-section-code {
    font-size: 10px;
    color: #ffb800;
    font-weight: 600;
    font-family: var(--mono, monospace);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  ._bty-kill-section-right {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
  }
  ._bty-kill-mode-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 14px;
  }
  ._bty-kill-mode-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 56px;
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid var(--_item-border, rgba(255,255,255,0.08));
    background: var(--_item-bg, rgba(255,255,255,0.025));
  }
  ._bty-kill-mode-item.active {
    border-color: var(--_item-border, rgba(255,255,255,0.25));
    background: var(--_item-bg, rgba(255,255,255,0.06));
    box-shadow: 0 0 0 1px var(--_item-glow, rgba(255,255,255,0.1)) inset;
  }
  ._bty-kill-mode-label {
    font-size: 15px;
    font-weight: 600;
    color: var(--_item-color, rgba(255,255,255,0.5));
    margin-bottom: 3px;
  }
  ._bty-kill-mode-desc {
    font-size: 11px;
    color: rgba(255,255,255,0.35);
    line-height: 1.4;
    max-width: 200px;
  }
  ._bty-kill-mode-active-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    min-height: 28px;
    background: var(--_badge-bg, rgba(255,255,255,0.1));
    color: var(--_badge-color, rgba(255,255,255,0.4));
    border: 1px solid var(--_badge-border, rgba(255,255,255,0.15));
  }
  ._bty-kill-readonly-note {
    margin: 8px 12px 14px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 8px;
    font-size: 12px;
    color: rgba(255,255,255,0.45);
    line-height: 1.7;
  }
  ._bty-kill-blocked-note {
    margin: 10px 12px;
    padding: 12px 14px;
    background: rgba(239,83,80,0.08);
    border: 1px solid rgba(239,83,80,0.2);
    border-radius: 8px;
    font-size: 12px;
    color: rgba(239,83,80,0.8);
    line-height: 1.6;
  }
`;

export default async function MobileKillPage() {
  const result = await loadKill();
  const current = result.data?.mode ?? "unknown";
  const accent = modeAccent(current);
  const isHalted = current === "halted";
  const isTrading = current === "trading";

  const stateOk = result.state === "LIVE";
  const statePillStyle = {
    background: stateOk ? "rgba(76,175,80,0.18)" : "rgba(239,83,80,0.18)",
    color: stateOk ? "#4caf50" : "#ef5350",
    border: `1px solid ${stateOk ? "rgba(76,175,80,0.35)" : "rgba(239,83,80,0.35)"}`,
  };

  return (
    <main>
      <style>{KILL_CSS}</style>

      {/* Header */}
      <div className="_bty-kill-head">
        <div>
          <div className="_bty-kill-sub">IUF 交易戰情室 / 行動風控</div>
          <div className="_bty-kill-title">交易模式</div>
          <div className="_bty-kill-sub">模擬帳戶：{ACCOUNT_LABEL}</div>
        </div>
        <span className="_bty-kill-status-pill" style={statePillStyle}>
          {stateOk ? "正常" : "暫停"}
        </span>
      </div>

      {/* Hero — large current mode display */}
      <div
        className="_bty-kill-hero"
        style={{
          "--_mode-color": accent,
          "--_mode-bg": `${accent}11`,
          "--_mode-border": `${accent}44`,
        } as React.CSSProperties}
      >
        <div className="_bty-kill-hero-mode" style={{ color: accent }}>
          {modeLabel(current)}
        </div>
        <div className="_bty-kill-hero-sub">{modeSub(current)}</div>
        {result.data?.reason && (
          <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{result.data.reason}</div>
        )}
        <div className="_bty-kill-hero-ts">後端更新 {formatTime(result.updatedAt)}</div>
      </div>

      {result.state === "BLOCKED" && (
        <div className="_bty-kill-blocked-note">
          讀取失敗：{result.reason}
        </div>
      )}

      {/* Mode list */}
      <section className="_bty-kill-section">
        <div className="_bty-kill-section-head">
          <span className="_bty-kill-section-code">模式總覽</span>
          <span className="_bty-kill-section-right">唯讀狀態</span>
        </div>
        <div className="_bty-kill-mode-list">
          {MODES.map((item) => {
            const isActive = item.mode === current;
            return (
              <div
                key={item.mode}
                className={`_bty-kill-mode-item${isActive ? " active" : ""}`}
                role="status"
                title="前端目前只顯示狀態；切換執行模式需要後端治理、稽核紀錄與風控回歸測試通過。"
                style={isActive ? {
                  "--_item-color": item.accent,
                  "--_item-border": `${item.accent}55`,
                  "--_item-bg": `${item.accent}11`,
                  "--_item-glow": `${item.accent}22`,
                  "--_badge-bg": `${item.accent}22`,
                  "--_badge-color": item.accent,
                  "--_badge-border": `${item.accent}44`,
                } as React.CSSProperties : {}}
              >
                <div>
                  <div className="_bty-kill-mode-label" style={isActive ? { color: item.accent } : undefined}>
                    {item.label}
                  </div>
                  <div className="_bty-kill-mode-desc">{item.sub}</div>
                </div>
                <span
                  className="_bty-kill-mode-active-badge"
                  style={isActive ? {
                    "--_badge-bg": `${item.accent}22`,
                    "--_badge-color": item.accent,
                    "--_badge-border": `${item.accent}44`,
                  } as React.CSSProperties : undefined}
                >
                  {isActive ? "目前" : "不可切換"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Read-only note */}
      <section className="_bty-kill-section">
        <div className="_bty-kill-section-head">
          <span className="_bty-kill-section-code" style={{ color: "#4fc3f7" }}>切換權限</span>
          <span className="_bty-kill-section-right">後端治理</span>
        </div>
        <div className="_bty-kill-readonly-note">
          這一頁只讀取目前執行模式，不直接更改後端狀態；v1 僅允許模擬委託，不開啟正式券商寫入。
          切換路徑需要後端治理路由、稽核紀錄、四層風控回歸與操作員核准。
          {result.state === "BLOCKED" && ` 目前狀態暫停：${result.reason}`}
        </div>
      </section>
    </main>
  );
}
