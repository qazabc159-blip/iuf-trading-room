export type PortfolioSnapshotPhase = "loading" | "live" | "empty" | "blocked";

export const PORTFOLIO_SNAPSHOT_ENDPOINT = "/api/v1/portfolio/snapshots";
export const PORTFOLIO_SNAPSHOT_DIFF_ENDPOINT = "/api/v1/portfolio/snapshots/diff";
export const PORTFOLIO_SNAPSHOT_OWNER = "系統快照寫入流程";

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
      detail: "正在向正式 snapshot read API 讀取資料。",
      endpoint: PORTFOLIO_SNAPSHOT_ENDPOINT,
      owner: PORTFOLIO_SNAPSHOT_OWNER,
      nextAction: "等待正式資料回應；若超時，檢查 production route 與登入狀態。",
    };
  }

  if (input.phase === "live") {
    return {
      tone: "live",
      title: `Portfolio Snapshot LIVE：${input.count} 筆`,
      detail: "已接正式 read API，畫面只呈現後端回傳的 snapshot 與 positions。",
      endpoint: PORTFOLIO_SNAPSHOT_ENDPOINT,
      owner: PORTFOLIO_SNAPSHOT_OWNER,
      nextAction: "可選擇左側 snapshot 檢視部位，或輸入兩個 snapshot ID 比較 diff。",
    };
  }

  if (input.phase === "empty") {
    return {
      tone: "empty",
      title: "Portfolio Snapshot EMPTY",
      detail: "read API 已可用，但目前後端尚未寫入任何 portfolio snapshot；這不是假資料，也不是白屏。",
      endpoint: PORTFOLIO_SNAPSHOT_ENDPOINT,
      owner: PORTFOLIO_SNAPSHOT_OWNER,
      nextAction: "確認 snapshot writer 何時由 paper portfolio、orders、fills 或 EOD job 觸發。",
    };
  }

  const status = input.error ? `HTTP ${input.error}` : "unknown error";
  return {
    tone: "blocked",
    title: "Portfolio Snapshot BLOCKED",
    detail: `讀取正式 read API 失敗：${status}。畫面不會用假 snapshot 填空。`,
    endpoint: PORTFOLIO_SNAPSHOT_ENDPOINT,
    owner: PORTFOLIO_SNAPSHOT_OWNER,
    nextAction: "先驗 production route/session，再檢查 API log 與 snapshot store。",
  };
}
