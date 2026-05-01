import { getKillSwitch } from "@/lib/api";

export const dynamic = "force-dynamic";

const ACCOUNT_ID = "paper-default";
const ACCOUNT_LABEL = "模擬帳戶";
const MODES = [
  { mode: "trading", label: "可交易", sub: "通過後端風控後，可建立模擬委託", tone: "gold" },
  { mode: "paper_only", label: "模擬模式", sub: "策略與委託都只留在模擬交易層", tone: "muted" },
  { mode: "liquidate_only", label: "只減倉", sub: "只允許降低曝險的委託", tone: "muted" },
  { mode: "halted", label: "全鎖定", sub: "停止新增委託，等待風控處理", tone: "up" },
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
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function stateTone(state: LoadState["state"]) {
  return state === "LIVE" ? "up" : "down";
}

function surfaceState(state: LoadState["state"]) {
  return state === "LIVE" ? "正常" : "暫停";
}

function modeLabel(mode: string) {
  return MODES.find((item) => item.mode === mode)?.label ?? "未知狀態";
}

export default async function MobileKillPage() {
  const result = await loadKill();
  const current = result.data?.mode ?? "unknown";

  return (
    <main>
      <header className="mobile-head">
        <div>
          <div className="tg soft">IUF 交易戰情室 / 行動風控</div>
          <h1>交易模式</h1>
          <div className="tg soft" style={{ marginTop: 8 }}>模擬帳戶：{ACCOUNT_LABEL}</div>
        </div>
        <div className={`tg session-pill ${stateTone(result.state)}`}>{surfaceState(result.state)}</div>
      </header>

      <section className="mobile-section">
        <div className="mobile-section-head">
          <span className="tg gold">目前模式</span>
          <span className="tg soft">唯讀狀態</span>
        </div>
        <div style={{ padding: 18, borderBottom: "1px solid var(--night-rule)" }}>
          <div className="tg soft">後端回報</div>
          <div className="kill-current">{modeLabel(current)}</div>
          <div className="tg soft" style={{ marginTop: 8 }}>更新 {formatTime(result.updatedAt)}</div>
          {result.data?.reason && <div className="tc soft" style={{ marginTop: 8 }}>{result.data.reason}</div>}
        </div>
        <div style={{ display: "grid", gap: 10, padding: 14 }}>
          {MODES.map((item) => {
            const active = item.mode === current;
            return (
              <div
                key={item.mode}
                role="status"
                title="前端目前只顯示狀態；切換交易模式需要後端治理、稽核紀錄與風控回歸測試通過。"
                className={`kill-mode ${active ? "active" : ""}`}
              >
                <span>
                  <span className={`tg ${active ? "gold" : item.tone}`}>{item.label}</span>
                  <span className="tc soft">{item.sub}</span>
                </span>
                <span className="tg soft">{active ? "目前" : "不可切換"}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mobile-section">
        <div className="mobile-section-head">
          <span className="tg up">切換權限</span>
          <span className="tg soft">後端治理</span>
        </div>
        <div style={{ padding: 18 }}>
          <p className="tc soft" style={{ margin: 0, lineHeight: 1.8 }}>
            這一頁只讀取真實交易模式，不直接更改後端狀態。
          </p>
          <div className="terminal-note" style={{ marginTop: 12 }}>
            暫停切換：{result.state === "BLOCKED" ? result.reason : "切換路徑需要後端治理路由、稽核紀錄、四層風控回歸與操作員核准。"}
          </div>
        </div>
      </section>
    </main>
  );
}
