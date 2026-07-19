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
 *
 * Pete review #1311 round 2（2026-07-19，🔴 must-fix）：`statusBadge`／
 * `nextAction` 曾經是這裡的靜態欄位，跟 MilestoneTrack 各自依台北日曆日動
 * 態算的狀態脫鉤——日期經過後（例如 08/03 一過），卡片 badge／下一個動作
 * 仍停在過去的靜態文字，跟同一張卡的里程碑時間軸互相矛盾。修法：`milestones`
 * 只存事實（日期），`statusBadge`／`nextAction` 一律用下面的
 * `deriveStrategyProgress()` 從 `milestones` + `today` 現算，全站三個渲染
 * 點（首頁迷你卡／目錄卡／詳情 Panel）都呼叫同一支函式，不得各自複製一份
 * 邏輯或另外存靜態欄位。
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
  /** 里程碑三步（固定樣板：模擬盤觀察起算／排程首組合／真金試點）。事實
   * 只存在這裡——現況 badge／下一個動作一律用 `deriveStrategyProgress()`
   * 從這份陣列現算，不得另外存靜態欄位（見檔頭 Pete review 註記）。 */
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

export type StrategyProgress = {
  /** 現況狀態 badge 文字。 */
  badge: string;
  /** 下一個動作；全部里程碑都已到達（終態）時為 null，不再宣稱有下一步。 */
  nextAction: { label: string; date: string | null } | null;
};

// badge 依「已到達的里程碑深度」對應固定 3 步樣板的 4 種階段文字（0~3 步
// 已完成）。跟 `milestones` 陣列順序（起算／首組合／真金試點）一一對應。
const STAGE_BADGES = ["排程準備中", "模擬盤觀察中", "排程執行中", "真金試點已啟動"];

/**
 * 從 `milestones` 事實 + 當下日期現算 badge／下一個動作——單一真相來源，
 * 三個渲染點（首頁迷你卡／目錄卡／詳情 Panel）都必須呼叫這支函式，不得各自
 * 存一份靜態欄位（Pete review #1311 round 2 🔴 must-fix，見檔頭註記）。
 *
 * 邏輯：
 * 1. 找出陣列中「有日期且已到達（today >= date）」的最後一個 index，視為
 *    目前已走到的里程碑深度。
 * 2. 該 index 之後、且尚未到達的里程碑是候選下一步；若其中有已排定日期
 *    的，取日期最近的一個；若全部都還沒排定日期（`date: null`），取樣板
 *    順序中的第一個——代表「這步驟還沒被排定，但也沒有更早的已知日期步驟
 *    擋在前面」。
 * 3. 候選為空（該 index 之後全部已到達）視為終態：不再宣稱有下一步。
 *
 * 這個順序保證了：一個里程碑要嘛尚未排定、要嘛日期還沒到，才可能被選為
 * 「下一個動作」；已經到達的里程碑（含它前面樣板順序更早的項目）永遠不會
 * 被誤選為「下一步」，也不會出現「下一步指向過去日期」的自相矛盾。
 */
export function deriveStrategyProgress(
  strategy: Pick<QuantStrategyContent, "milestones">,
  today: string,
): StrategyProgress {
  const { milestones } = strategy;

  let lastResolvedIndex = -1;
  milestones.forEach((milestone, index) => {
    if (milestone.date != null && milestoneState(milestone.date, today) === "done") {
      lastResolvedIndex = index;
    }
  });

  const badge = STAGE_BADGES[Math.min(lastResolvedIndex + 1, STAGE_BADGES.length - 1)];

  const remaining = milestones
    .slice(lastResolvedIndex + 1)
    .filter((milestone) => milestoneState(milestone.date, today) !== "done");

  if (remaining.length === 0) {
    return { badge, nextAction: null };
  }

  const datedRemaining = remaining
    .filter((milestone): milestone is Milestone & { date: string } => milestone.date != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const next = datedRemaining[0] ?? remaining[0];
  return { badge, nextAction: { label: next.label, date: next.date } };
}

/** 「下一個動作」欄位的顯示文字——終態（3 步都已到達）時不再宣稱有下一
 * 步，改用誠實的完成語句。三個渲染點共用這支，terminal 文案不再各寫一份。 */
export function formatNextAction(progress: StrategyProgress): string {
  if (progress.nextAction == null) return "里程碑已全數達成";
  return `${progress.nextAction.label} · ${formatMilestoneDate(progress.nextAction.date)}`;
}
