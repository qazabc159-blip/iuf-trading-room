/**
 * quant-strategies-content.ts — v9.1 量化策略頁內容單一來源（2026-07-19）。
 *
 * 楊董 7/19 裁定：量化策略頁改走「基金 fact-sheet」體裁，且 Athena 授權邊界
 * §2 明訂 F-AUTO 運行績效（報酬%／NAV／本金／持倉）不得對一般使用者揭露，
 * 只能在 owner-only 的 /ops/f-auto 呈現。本頁（/quant-strategies 目錄 +
 * 詳情）與首頁迷你卡因此改為「策略性質 + 里程碑進度」的純內容頁，不打任何
 * 後端績效 API——0 運行績效數字。
 *
 * 里程碑日期是本頁唯一會隨時間變動的欄位，集中在這裡管理（不散落在
 * page.tsx / 首頁），並註記由 Lab 排程更新；若日期異動，只需要改這個檔案。
 *
 * 命名刻意不使用內部代號（S1／cont_liq_v36／F-AUTO 等）——這些是給操作面板
 * （/ops/f-auto）看的工程語彙，不是使用者要看到的策略名稱。
 */

import { taipeiCalendarDate } from "./taipei-date";

export type MilestoneState = "done" | "upcoming" | "pending";

export type Milestone = {
  /** 三步樣板固定文案：模擬盤觀察起算 / 排程首組合 / 真金試點 */
  label: string;
  /** "YYYY-MM-DD"；尚未排定則為 null（絕不用猜測日期頂替）。 */
  date: string | null;
};

export type QuantStrategyContent = {
  /** URL slug，用於 /quant-strategies/[id]。 */
  id: string;
  name: string;
  /** 一句買什麼。 */
  oneLiner: string;
  /** 屬性 chips。 */
  chips: string[];
  /** 現況狀態 badge 文字。 */
  statusBadge: string;
  /** 下一個動作。 */
  nextAction: { label: string; date: string };
  /** 里程碑三步（固定樣板：模擬盤觀察起算／排程首組合／真金試點）。 */
  milestones: Milestone[];
  detail: {
    summary: string;
    /** 選股邏輯人話要點（非參數/非工程細節）。 */
    mechanics: string[];
  };
};

export const QUANT_STRATEGIES_CONTENT: QuantStrategyContent[] = [
  {
    id: "fundamental-momentum",
    name: "基本面動能",
    oneLiner: "篩基本面轉強、動能同步走升的台股，每月檢視一次持股名單。",
    chips: ["月頻決策", "基本面 + 動能", "多頭傾向"],
    statusBadge: "模擬盤觀察中",
    nextAction: { label: "真金試點", date: "2026-08-12" },
    milestones: [
      { label: "模擬盤觀察起算", date: "2026-07-13" },
      { label: "排程首組合", date: null },
      { label: "真金試點", date: "2026-08-12" },
    ],
    detail: {
      summary:
        "以基本面轉強與價格動能同步向上作為選股條件，鎖定財報與動能同時轉強的台股，每月重新檢視一次名單，避免追高財報已經反應完的股票。",
      mechanics: [
        "先用財報數據篩出基本面轉強的公司。",
        "再用價格動能確認市場是否同步反應。",
        "兩者同時成立才會進入候選名單。",
      ],
    },
  },
  {
    id: "trend-continuation",
    name: "趨勢延續",
    oneLiner: "篩趨勢方向明確的台股，順勢持有到訊號轉弱為止，每月檢視一次持股名單。",
    chips: ["月頻決策", "價格趨勢", "順勢持有"],
    statusBadge: "排程準備中",
    nextAction: { label: "排程首組合", date: "2026-08-03" },
    milestones: [
      { label: "模擬盤觀察起算", date: null },
      { label: "排程首組合", date: "2026-08-03" },
      { label: "真金試點", date: null },
    ],
    detail: {
      summary:
        "鎖定價格趨勢方向明確、尚未出現反轉訊號的台股，順勢持有到趨勢轉弱為止，每月重新檢視一次名單，避免在盤整期頻繁進出。",
      mechanics: [
        "追蹤價格趨勢是否維持同一方向。",
        "訊號轉弱或反轉才會調整持股。",
        "不做預測性進出場，只跟隨已確立的趨勢。",
      ],
    },
  },
];

export const QUANT_PAGE_HEADER = {
  title: "量化策略",
  subtitle: "兩條月頻選股策略",
  note: "本頁只揭露策略性質與里程碑進度，不顯示即時報酬、淨值或持倉；正式績效上線前一律以「將揭露」呈現。",
};

/** 治理帶三條人話（非工程/非法條堆砌）。 */
export const QUANT_GOVERNANCE_NOTES: string[] = [
  "策略要先通過內部驗證與觀察期，才會進入下一個里程碑。",
  "模擬與真金試點資金皆與既有帳戶隔離，不影響你現有的部位與委託。",
  "里程碑日期由量化團隊排定與更新；日期若調整，本頁會同步更新。",
];

/** 法遵頁尾。 */
export const QUANT_COMPLIANCE_FOOTER =
  "策略里程碑代表產品開發進度，不是投資建議，也不是對未來績效的承諾。真金試點啟動前，所有畫面均以模擬環境呈現；淨值曲線待績效可對外揭露時另行上線。";

export function getQuantStrategyContent(id: string): QuantStrategyContent | null {
  return QUANT_STRATEGIES_CONTENT.find((strategy) => strategy.id === id) ?? null;
}

/** 今天的 Taipei 日曆日（"YYYY-MM-DD"），供里程碑狀態判斷使用。 */
export function todayTaipeiDate(): string {
  return taipeiCalendarDate(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);
}

export function milestoneState(date: string | null, today: string): MilestoneState {
  if (date == null) return "pending";
  return date <= today ? "done" : "upcoming";
}

export function formatMilestoneDate(date: string | null): string {
  if (date == null) return "待排定";
  const [, month, day] = date.split("-");
  return `${month}/${day}`;
}
