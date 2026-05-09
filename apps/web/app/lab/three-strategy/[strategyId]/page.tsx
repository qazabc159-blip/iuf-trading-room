/**
 * /lab/three-strategy/[strategyId] — 策略 detail panel
 *
 * 2026-05-09: 接通 Athena 5/9 morning truth
 *   - cont_liq v36: 9/9 PASS + 四重魯棒（Horizon ±5d NEAR_PASS / Regime ±2% FULL_PASS / Cost / Universe PARTIAL）
 *   - rs_20_60: RETIRED (sector-pinned, family-level no-edge)
 *   - strategy_002 + strategy_003: walk-forward + bootstrap CI in progress (Task #400)
 *
 * Stage 2 DEFER: equity curve / monthly bar / drawdown / Sharpe / win rate
 *   → pending Athena schema ship
 *
 * HARD LINES:
 *   - 不准顯示 "已驗證" / "approved" / "可上線" / "strategy approved"
 *   - 不准截斷 Athena caveat
 *   - 不准隱藏 KGI 真錢警示
 *   - 不准 mock 真實 quote / fake metric
 */

// notFound removed — using defensive fallback rendering instead
import Link from "next/link";
import { PageFrame } from "@/components/PageFrame";
import { StrategyDetailClient } from "./StrategyDetailClient";

export const dynamic = "force-dynamic";

// ── Types ──────────────────────────────────────────────────────────────────────

export type CaveatEntry = {
  icon: "pass" | "warn" | "fail";
  label: string;
  detail: string;
};

export type StrategyDetailData = {
  strategyId: string;
  displayName: string;
  tagline: string;
  badgeVariant: "amber" | "blue" | "violet" | "gray";
  badgeLabel: string;
  governanceState: string;
  isRetired: boolean;
  retiredReason?: string;

  /** 全文 caveat */
  fullCaveat: string;

  /** Intro / signal / sizing / exit spec */
  spec: {
    intro: string;
    signalLogic: string;
    sizing: string;
    exitRule: string;
  };

  /** 8 caveat 燈號 verdict */
  caveatVerdicts: CaveatEntry[];

  /** Paper observation state */
  paperObservation: {
    startDate: string | null;
    expectedUnlockDate: string | null;
    status: "not_started" | "in_progress" | "completed" | "retired";
  };

  /** Data source label */
  dataSource: string;
};

// ── Strategy registry — Athena 5/9 morning truth ──────────────────────────────

const RETIRED_SPEC = {
  intro: "此策略已退場，不再維護設計規格。",
  signalLogic: "—",
  sizing: "—",
  exitRule: "—",
};

const STRATEGY_REGISTRY: Record<string, StrategyDetailData> = {
  // cont_liq v36 — 9/9 PASS + 四重魯棒 (2026-05-09)
  "cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25": {
    strategyId: "cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25",
    displayName: "流動強勢延續策略 v36",
    tagline:
      "流動性相對強度選股，h20 持有期框架，前五名等權。v36 通過 9/9 驗證項目 + 四重魯棒性確認。",
    badgeVariant: "amber",
    badgeLabel: "9/9 PASS",
    governanceState:
      "cont_liq_v36 · 9/9 PASS + 四重魯棒 · forward observation 進行中",
    isRetired: false,
    fullCaveat:
      "9/9 驗證項目通過（截至 2026-05-09 Athena morning update）/ 四重魯棒：Horizon ±5d NEAR_PASS / Regime ±2% FULL_PASS / Cost 40-250bps script done / Universe K=68→20 PARTIAL（K≥50 liquid universe required）/ 仍需完整 forward observation 才算 process pass / 不是已驗證可上線策略 / capacity note: K≥50 流動性股票宇宙必要條件",
    spec: {
      intro:
        "cont_liq v36 策略在 h20（20 個交易日）持有期框架下，選取流動性相對強度排前五的股票。v36 通過 9/9 Athena 驗證項目，並完成四重魯棒性測試（Horizon / Regime / Cost / Universe 四軸）。",
      signalLogic:
        "計算每檔股票過去 20 日流動性相對市場的強度分數（相對成交量 × 相對換手率）。排序取前五名。Turnover cap 0.25 限制換手過高個股。股票宇宙需 K≥50 流動性股票才具備統計意義。",
      sizing:
        "等權重持有 5 檔個股。每檔最高 20%。調整頻率為每 20 個交易日一次（h20）。不使用槓桿。capital_cap_twd_max: 10,000 TWD（pilot canary sizing）。",
      exitRule:
        "持有 20 個交易日後全部換倉，依最新排序重新選股。若觸發市場整體 kill switch 條件，全部清倉。Cost 40-250bps 魯棒性已驗證（script done）。",
    },
    caveatVerdicts: [
      {
        icon: "pass",
        label: "統計顯著性",
        detail: "9/9 PASS — 統計顯著性通過（Athena 5/9 update）",
      },
      {
        icon: "pass",
        label: "CPCV PBO",
        detail: "9/9 PASS — Probabilistic Backtest Overfitting (CPCV) 通過",
      },
      {
        icon: "pass",
        label: "DSR（Deflated Sharpe）",
        detail: "9/9 PASS — DSR 計算完成",
      },
      {
        icon: "warn",
        label: "Horizon 魯棒性",
        detail: "四重魯棒 Horizon ±5d: NEAR_PASS（非 FULL_PASS）— 持有期敏感性存在，需持續追蹤",
      },
      {
        icon: "pass",
        label: "Regime 魯棒性",
        detail: "四重魯棒 Regime ±2%: FULL_PASS — 市場機制變化下穩健",
      },
      {
        icon: "pass",
        label: "Cost 魯棒性",
        detail: "四重魯棒 Cost 40-250bps: script done — 交易成本敏感性驗證完成",
      },
      {
        icon: "warn",
        label: "Universe 魯棒性 / capacity",
        detail: "四重魯棒 Universe K=68→20: PARTIAL — K≥50 liquid universe 為必要條件（capacity constraint）",
      },
      {
        icon: "fail",
        label: "Forward observation / 可上線背書",
        detail: "仍需完整 forward observation 才算 process pass / 不得背書可上線 / paper trade 需楊董 explicit ACK",
      },
    ],
    paperObservation: {
      startDate: null,
      expectedUnlockDate: null,
      status: "not_started",
    },
    dataSource: "athena_morning_5_9_chat_update",
  },

  // rs_20_60 — RETIRED (2026-05-09)
  "rs_20_60_low_drawdown__h20__top5": {
    strategyId: "rs_20_60_low_drawdown__h20__top5",
    displayName: "穩健強勢低回撤策略",
    tagline:
      "rs_20_60 family — 已退場。sector-pinned 特性導致 family-level no-edge。",
    badgeVariant: "gray",
    badgeLabel: "RETIRED",
    governanceState:
      "RETIRED · sector-pinned · family-level no-edge · 2026-05-09",
    isRetired: true,
    retiredReason:
      "sector-pinned · family-level no-edge（Athena 2026-05-09 morning update）",
    fullCaveat:
      "rs_20_60 family 已於 2026-05-09 Athena morning update 正式退場（RETIRED）/ 根本原因：sector-pinned — 策略表現高度依賴特定板塊曝險，非獨立 alpha 來源 / family-level no-edge 確認 / 不再進行任何 forward observation 或 paper trade / 此 slot 未來由 Athena 新候選策略填補",
    spec: RETIRED_SPEC,
    caveatVerdicts: [
      {
        icon: "fail",
        label: "退場確認",
        detail: "RETIRED (2026-05-09) — sector-pinned，family-level no-edge",
      },
      {
        icon: "fail",
        label: "Alpha 來源",
        detail: "不具備獨立 alpha — 表現依賴特定板塊曝險",
      },
      {
        icon: "fail",
        label: "後續觀察",
        detail: "已終止所有 forward observation 及 paper trade",
      },
      {
        icon: "fail",
        label: "可上線背書",
        detail: "RETIRED — 不得以任何形式背書或重啟",
      },
      { icon: "fail", label: "統計顯著性", detail: "不適用（已退場）" },
      { icon: "fail", label: "CPCV PBO", detail: "不適用（已退場）" },
      { icon: "fail", label: "DSR", detail: "不適用（已退場）" },
      {
        icon: "fail",
        label: "Forward observation",
        detail: "不適用（已退場）",
      },
    ],
    paperObservation: {
      startDate: null,
      expectedUnlockDate: null,
      status: "retired",
    },
    dataSource: "athena_morning_5_9_chat_update",
  },

  // MAIN — walk-forward + bootstrap CI in progress (Task #400)
  MAIN_execution_rank_buffer_top20: {
    strategyId: "MAIN_execution_rank_buffer_top20",
    displayName: "主控排序緩衝策略",
    tagline:
      "MAIN core research candidate — 執行強度排序緩衝，20 股候選池，sector/regime dependent。",
    badgeVariant: "blue",
    badgeLabel: "研究候選",
    governanceState:
      "MAIN · RESEARCH_CANDIDATE · strategy_002/003 walk-forward + bootstrap CI in progress (Task #400)",
    isRetired: false,
    fullCaveat:
      "MAIN 策略保持 RESEARCH_CANDIDATE 狀態 / strategy_002 + strategy_003 walk-forward + bootstrap CI 進行中（Task #400）/ 尚未進入 forward observation / sector/regime dependent — 非 clean stock-picking claim / 不是已驗證策略 / cash_order_path: BLOCKED_until_Yang_final_manual_ACK",
    spec: {
      intro:
        "MAIN 策略以執行強度排序為核心機制，維持 20 股候選池緩衝，在市場流動性充足時才觸發換倉。MICRO_LIVE_CORE 角色（pilot role），capital_cap_twd_max: 50,000 TWD。",
      signalLogic:
        "計算各股票執行強度（relative strength × volume × momentum composite），取前 20 名組成候選池。觸發條件：市場流動性指標 > 基準 threshold（調整頻率 h20）。",
      sizing:
        "等權重最多 20 檔，每檔最高 5%。持倉 cache：20 個交易日。position_cap: 2（pilot sizing）。不使用槓桿。",
      exitRule:
        "持有 20 個交易日後全部換倉。若觸發 kill switch 或 daily loss ≥ 5% 凍結。sector/regime breakdown 時降回 RESEARCH 等級。",
    },
    caveatVerdicts: [
      {
        icon: "warn",
        label: "Walk-forward 狀態",
        detail:
          "strategy_002 + strategy_003 walk-forward + bootstrap CI in progress（Task #400）",
      },
      {
        icon: "fail",
        label: "統計顯著性",
        detail: "待 walk-forward 完成後計算，目前不具統計 evidence",
      },
      { icon: "fail", label: "CPCV PBO", detail: "尚未計算，待 Task #400 完成" },
      {
        icon: "fail",
        label: "DSR（Deflated Sharpe）",
        detail: "尚未計算，待 Task #400 完成",
      },
      {
        icon: "fail",
        label: "Forward observation",
        detail: "尚未啟動 forward obs，需先完成 walk-forward 設計",
      },
      {
        icon: "warn",
        label: "Sector / Regime dependent",
        detail: "策略表現受板塊輪動與市場機制影響，非 clean alpha source",
      },
      { icon: "fail", label: "L9 gate", detail: "尚未進入 L9 評估流程" },
      {
        icon: "fail",
        label: "可上線背書",
        detail: "RESEARCH_CANDIDATE — 不具任何可上線背書，cash_order_path: BLOCKED",
      },
    ],
    paperObservation: {
      startDate: null,
      expectedUnlockDate: null,
      status: "not_started",
    },
    dataSource: "athena_morning_5_9_chat_update",
  },

  // Legacy alias: old cont_liq ID → show forwarding note
  cont_liq_h20_top3_market_trail20_gt_5pct: {
    strategyId: "cont_liq_h20_top3_market_trail20_gt_5pct",
    displayName: "流動順勢三強（舊 ID）",
    tagline:
      "此為舊版策略 ID。對應策略已更新為 cont_liq_v36，請查看 cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25。",
    badgeVariant: "amber",
    badgeLabel: "ID 已更新",
    governanceState: "舊 ID — 參見 cont_liq_v36 (9/9 PASS)",
    isRetired: false,
    fullCaveat:
      "此 strategyId (cont_liq_h20_top3_market_trail20_gt_5pct) 為舊版 ID，對應策略現已更新為 cont_liq_v36。cont_liq_v36: 9/9 PASS + 四重魯棒（Horizon ±5d NEAR_PASS / Regime ±2% FULL_PASS / Cost 40-250bps / Universe K≥50 required）。仍需完整 forward observation，不得背書可上線。",
    spec: {
      intro:
        "請查看更新後的策略 ID: cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25。",
      signalLogic: "— 同上，請查看新 ID —",
      sizing: "— 同上，請查看新 ID —",
      exitRule: "— 同上，請查看新 ID —",
    },
    caveatVerdicts: [
      {
        icon: "warn",
        label: "ID 已更新",
        detail:
          "請使用新 ID: cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25",
      },
      {
        icon: "pass",
        label: "cont_liq_v36 狀態",
        detail: "9/9 PASS + 四重魯棒（Athena 5/9 morning update）",
      },
      {
        icon: "warn",
        label: "Universe capacity",
        detail: "K≥50 liquid universe required（PARTIAL constraint）",
      },
      {
        icon: "fail",
        label: "Forward observation",
        detail: "仍需完整 forward observation，不得背書可上線",
      },
      { icon: "fail", label: "可上線背書", detail: "不得背書，需楊董 explicit ACK" },
      { icon: "warn", label: "Horizon 魯棒性", detail: "NEAR_PASS（非 FULL_PASS）" },
      { icon: "pass", label: "Regime 魯棒性", detail: "FULL_PASS" },
      { icon: "pass", label: "Cost 魯棒性", detail: "40-250bps script done" },
    ],
    paperObservation: {
      startDate: null,
      expectedUnlockDate: null,
      status: "not_started",
    },
    dataSource: "athena_morning_5_9_chat_update",
  },

  // strategy_002 — walk-forward + bootstrap CI in progress (Task #400)
  strategy_002_revenue_yoy_surprise: {
    strategyId: "strategy_002_revenue_yoy_surprise",
    displayName: "營收動能驚喜",
    tagline:
      "選出營收年增率大幅優於預期的個股，捕捉市場對基本面修正的動能。walk-forward + bootstrap CI in progress (Task #400)。",
    badgeVariant: "blue",
    badgeLabel: "Walk-forward 進行中",
    governanceState:
      "strategy_002 · walk-forward + bootstrap CI in progress · Task #400",
    isRetired: false,
    fullCaveat:
      "walk-forward + bootstrap CI 進行中（Task #400，2026-05-09 Athena morning update）/ 不具 matured forward observation / 回測數字僅供研究用，未通過完整 L9 gate / 不是已驗證策略 / 不顯示任何配置建議或勝率數字",
    spec: {
      intro:
        "strategy_002 以月度/季度營收年增率的「超預期幅度」作為主要選股訊號。當實際營收公告超出市場預期中位數 15% 以上，觸發追蹤觀察視窗，並搭配股價動能確認進場。",
      signalLogic:
        "計算個股最新一期營收年增率（Yoy%）相對市場分析師預期中位數的偏差（surprise ratio）。篩選 surprise > 15% 且同期股價表現優於大盤的個股。再用 3 個月動能過濾避開過度超買。",
      sizing:
        "等權重持有最多 5 檔，每檔最高 20%。換倉頻率：每月末重新評估，若訊號消失則減倉。不使用槓桿。",
      exitRule:
        "持有期最長 3 個月。若 surprise ratio 降至 5% 以下，或股價動能反轉（跌破 20 日均線），提前清倉。",
    },
    caveatVerdicts: [
      {
        icon: "warn",
        label: "Walk-forward 狀態",
        detail: "walk-forward + bootstrap CI in progress（Task #400, 2026-05-09）",
      },
      {
        icon: "fail",
        label: "統計顯著性",
        detail: "待 walk-forward 完成後計算",
      },
      {
        icon: "fail",
        label: "CPCV PBO",
        detail: "尚未計算，待 Task #400 完成",
      },
      {
        icon: "fail",
        label: "DSR（Deflated Sharpe）",
        detail: "尚未計算，等待 walk-forward 完成",
      },
      {
        icon: "fail",
        label: "Forward observation",
        detail: "尚無 matured forward observation，walk-forward 先完成",
      },
      {
        icon: "warn",
        label: "回測樣本",
        detail:
          "2018–2024，台股月報公告機制回測，未含 COVID 供應鏈衝擊情境",
      },
      {
        icon: "warn",
        label: "資料依賴",
        detail: "依賴月報公告時間點精準性，延遲公告可能影響進場時機",
      },
      {
        icon: "fail",
        label: "可上線背書",
        detail: "walk-forward 期間，不具任何可上線背書",
      },
    ],
    paperObservation: {
      startDate: null,
      expectedUnlockDate: null,
      status: "not_started",
    },
    dataSource: "athena_morning_5_9_chat_update",
  },

  // strategy_003 — walk-forward + bootstrap CI in progress (Task #400)
  strategy_003_ma200_trend_follow: {
    strategyId: "strategy_003_ma200_trend_follow",
    displayName: "200 日均線順勢",
    tagline:
      "追蹤股價站穩 200 日均線的個股，順大趨勢方向持有，依 cache 換倉。walk-forward + bootstrap CI in progress (Task #400)。",
    badgeVariant: "violet",
    badgeLabel: "Walk-forward 進行中",
    governanceState:
      "strategy_003 · walk-forward + bootstrap CI in progress · Task #400",
    isRetired: false,
    fullCaveat:
      "walk-forward + bootstrap CI 進行中（Task #400，2026-05-09 Athena morning update）/ 僅有回測數字，尚未進行 forward observation / cache 持有期較短，換倉頻率敏感 / 未通過 L9 gate / 不是已驗證策略 / 研究中，下一步需 forward test 設計",
    spec: {
      intro:
        "strategy_003 以個股股價相對 200 日移動平均（MA200）的位置為核心濾網，在大趨勢向上時持有，大趨勢轉空時空倉。屬於古典趨勢追蹤框架，換倉頻率受持倉 cache 長度影響較敏感。",
      signalLogic:
        "計算個股收盤價 / MA200 比值。比值 > 1.0 且上升趨勢確認者進入候選池。再用相對強度（vs 大盤 20 日）過濾，取前 10 名。若大盤 MA200 下方則所有持倉清空。",
      sizing:
        "等權重最多 10 檔，每檔最高 10%。持倉 cache 週期：因換倉頻率敏感，目前測試 10–30 日。不使用槓桿。",
      exitRule:
        "個股跌破 MA200 時清倉（單股停損）。大盤整體觸發 kill switch 時全清。持倉 cache 短意味著可能需要較高的換倉成本，需進一步優化。",
    },
    caveatVerdicts: [
      {
        icon: "warn",
        label: "Walk-forward 狀態",
        detail: "walk-forward + bootstrap CI in progress（Task #400, 2026-05-09）",
      },
      {
        icon: "fail",
        label: "統計顯著性",
        detail: "待 walk-forward 完成後計算",
      },
      { icon: "fail", label: "CPCV PBO", detail: "尚未計算，待 Task #400 完成" },
      { icon: "fail", label: "DSR（Deflated Sharpe）", detail: "尚未計算" },
      {
        icon: "fail",
        label: "Forward observation",
        detail: "尚未啟動 forward obs，需先設計觀察協議",
      },
      {
        icon: "warn",
        label: "換倉成本敏感",
        detail:
          "cache 持倉期短（10–30 日）導致換倉頻率高，transaction cost 對 Sharpe 影響未完整評估",
      },
      {
        icon: "warn",
        label: "市場機制",
        detail:
          "在台灣 T+2 交割、漲跌幅 10% 限制下，MA200 訊號延遲問題尚未測試",
      },
      {
        icon: "fail",
        label: "可上線背書",
        detail: "walk-forward 期間，無任何 forward evidence，不得上線",
      },
    ],
    paperObservation: {
      startDate: null,
      expectedUnlockDate: null,
      status: "not_started",
    },
    dataSource: "athena_morning_5_9_chat_update",
  },
};

// ── Sub-components (server-side only) ─────────────────────────────────────────

function CaveatIcon({ icon }: { icon: CaveatEntry["icon"] }) {
  if (icon === "pass") return <span style={{ color: "#2ecc71", fontSize: 14, marginRight: 6 }}>✓</span>;
  if (icon === "warn") return <span style={{ color: "#ffb800", fontSize: 14, marginRight: 6 }}>⚠</span>;
  return <span style={{ color: "#e05050", fontSize: 14, marginRight: 6 }}>✗</span>;
}

function RetiredDetailPanel({ data }: { data: StrategyDetailData }) {
  return (
    <>
      {/* RETIRED hero */}
      <div
        style={{
          padding: "20px 22px 18px",
          marginBottom: 20,
          background: "rgba(11,16,23,0.88)",
          border: "1px solid rgba(140,140,140,0.2)",
          borderTop: "3px solid #666",
          borderRadius: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 10px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              background: "rgba(100,100,100,0.12)",
              border: "1px solid rgba(140,140,140,0.35)",
              color: "#888",
            }}
          >
            {data.badgeLabel}
          </span>
          <span style={{ fontSize: 10, color: "#444", fontFamily: "var(--mono, monospace)" }}>
            {data.strategyId}
          </span>
        </div>
        <h1
          style={{
            margin: "0 0 8px",
            fontSize: 28,
            fontWeight: 850,
            color: "#666",
            letterSpacing: -0.4,
            fontFamily: "var(--sans-tc, sans-serif)",
            textDecoration: "line-through",
          }}
        >
          {data.displayName}
        </h1>
        <p style={{ margin: "0 0 10px", fontSize: 14, color: "#555", lineHeight: 1.6 }}>
          {data.tagline}
        </p>
        <div style={{ fontSize: 11, color: "#444", fontFamily: "var(--mono, monospace)" }}>
          治理狀態 / {data.governanceState}
        </div>
      </div>

      {/* Full caveat */}
      <div
        style={{
          padding: "14px 16px",
          marginBottom: 16,
          background: "rgba(140,140,140,0.04)",
          border: "1px solid rgba(140,140,140,0.18)",
          borderLeft: "3px solid #666",
          borderRadius: 5,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#777",
            letterSpacing: 0.8,
            textTransform: "uppercase" as const,
            fontFamily: "var(--mono, monospace)",
            marginBottom: 8,
          }}
        >
          退場說明（全文）
        </div>
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.8 }}>{data.fullCaveat}</div>
      </div>

      {/* Caveat verdicts */}
      <div
        style={{
          padding: "18px 20px",
          marginBottom: 16,
          background: "rgba(11,16,23,0.82)",
          border: "1px solid rgba(140,140,140,0.1)",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#555",
            letterSpacing: 1.2,
            textTransform: "uppercase" as const,
            fontFamily: "var(--mono, monospace)",
            marginBottom: 10,
            paddingBottom: 6,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          退場燈號
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {data.caveatVerdicts.map((v, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "22px 180px 1fr",
                gap: "0 10px",
                padding: "9px 0",
                borderBottom:
                  idx < data.caveatVerdicts.length - 1
                    ? "1px solid rgba(255,255,255,0.04)"
                    : "none",
                alignItems: "flex-start",
              }}
            >
              <div style={{ paddingTop: 1 }}>
                <CaveatIcon icon={v.icon} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#666", lineHeight: 1.5 }}>
                {v.label}
              </div>
              <div style={{ fontSize: 12, color: "#555", lineHeight: 1.6 }}>{v.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ strategyId: string }>;
}) {
  const { strategyId } = await params;
  const data = STRATEGY_REGISTRY[strategyId];

  // Defensive fallback — show a friendly "unknown strategy" page instead of black-screen 404
  if (!data) {
    return (
      <PageFrame
        code="LAB"
        title="策略 ID 不認識"
        sub="此 strategyId 不在已知清單中"
        note="不顯示已驗證、approved、可上線或任何背書字樣。"
      >
        <div
          style={{
            padding: "20px 24px",
            marginBottom: 20,
            background: "rgba(11,16,23,0.88)",
            border: "1px solid rgba(220,60,60,0.25)",
            borderLeft: "3px solid #e05050",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#e05050",
              letterSpacing: 0.8,
              textTransform: "uppercase" as const,
              fontFamily: "var(--mono, monospace)",
              marginBottom: 8,
            }}
          >
            Strategy ID Not Found
          </div>
          <div style={{ fontSize: 14, color: "#c8c8c8", lineHeight: 1.7, marginBottom: 12 }}>
            策略 ID <code style={{ fontFamily: "var(--mono, monospace)", color: "#ffb800", background: "rgba(255,184,0,0.08)", padding: "1px 6px", borderRadius: 3 }}>{strategyId}</code> 不在已知策略清單中。
          </div>
          <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
            可能原因：<br />
            · 此 ID 已更新為新版本（請回列表查看最新 ID）<br />
            · URL 有誤<br />
            · 策略已從 registry 移除
          </div>
        </div>
        <Link
          href="/lab/three-strategy"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#ffb800",
            textDecoration: "underline",
            fontFamily: "var(--mono, monospace)",
          }}
        >
          ← 返回 /lab/three-strategy 查看所有策略
        </Link>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      code="LAB"
      title={`策略詳情 / ${data.displayName}`}
      sub={`${data.governanceState} · 來源: ${data.dataSource}`}
      note="此頁顯示策略詳細治理資料。不顯示已驗證、approved、可上線或任何背書字樣。所有 caveat 全文顯示。"
    >
      {/* RETIRED: render static panel only, skip client toggle */}
      {data.isRetired ? (
        <RetiredDetailPanel data={data} />
      ) : (
        <StrategyDetailClient data={data} />
      )}

      <div style={{ marginTop: 24 }}>
        <Link
          href="/lab/three-strategy"
          style={{ fontSize: 12, color: "#888", textDecoration: "underline" }}
        >
          ← 返回三條策略狀態
        </Link>
      </div>
    </PageFrame>
  );
}
