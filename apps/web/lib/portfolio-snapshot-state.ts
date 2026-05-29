export type PortfolioSnapshotPhase = "loading" | "live" | "empty" | "blocked";

export const PORTFOLIO_SNAPSHOT_ENDPOINT = "/api/v1/portfolio/snapshots";
export const PORTFOLIO_SNAPSHOT_DIFF_ENDPOINT = "/api/v1/portfolio/snapshots/diff";
export const PORTFOLIO_SNAPSHOT_OWNER = "Elva/Jason backend data lane + Bruce live verify";

export type PortfolioSnapshotStateCopy = {
  tone: "live" | "empty" | "blocked" | "loading";
  title: string;
  detail: string;
  endpoint: string;
  owner: string;
  nextAction: string;
};

export function portfolioSnapshotStateCopy(input: {
  phase: PortfolioSnapshotPhase;
  count: number;
  error?: string | null;
}): PortfolioSnapshotStateCopy {
  if (input.phase === "loading") {
    return {
      tone: "loading",
      title: "讀取 Portfolio Snapshot",
      detail: "正在讀取正式 snapshot API，確認 paper 帳本歷史快照與差異比對資料。",
      endpoint: PORTFOLIO_SNAPSHOT_ENDPOINT,
      owner: PORTFOLIO_SNAPSHOT_OWNER,
      nextAction: "等待 API 回應；若逾時或失敗，改顯示 blocked 狀態與 owner。",
    };
  }

  if (input.phase === "live") {
    return {
      tone: "live",
      title: `Portfolio Snapshot LIVE：${input.count} 筆`,
      detail: "已連上正式 snapshot API。這裡是 paper portfolio 的歷史快照，不是即時庫存；持倉是否為空會依每筆快照內容誠實顯示。",
      endpoint: PORTFOLIO_SNAPSHOT_ENDPOINT,
      owner: PORTFOLIO_SNAPSHOT_OWNER,
      nextAction: "檢查最新快照的觸發來源、持倉筆數與時間；需要比較兩筆快照時輸入 snapshot ID 查 diff。",
    };
  }

  if (input.phase === "empty") {
    return {
      tone: "empty",
      title: "Portfolio Snapshot EMPTY",
      detail: "API 可連線，但目前沒有任何 portfolio snapshot。這代表 snapshot writer 尚未寫入，不可假裝有資料。",
      endpoint: PORTFOLIO_SNAPSHOT_ENDPOINT,
      owner: PORTFOLIO_SNAPSHOT_OWNER,
      nextAction: "請 Elva/Jason 檢查 snapshot writer、paper orders/fills 與 EOD job 是否有觸發寫入。",
    };
  }

  const status = input.error ? `HTTP ${input.error}` : "unknown error";
  return {
    tone: "blocked",
    title: "Portfolio Snapshot BLOCKED",
    detail: `snapshot read API 讀取失敗（${status}）。頁面不可顯示假資料，需查看 API/session/log。`,
    endpoint: PORTFOLIO_SNAPSHOT_ENDPOINT,
    owner: PORTFOLIO_SNAPSHOT_OWNER,
    nextAction: "Bruce 驗 production route/session；Elva/Jason 查看 API log 與 snapshot store。",
  };
}
