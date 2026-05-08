/**
 * /lab/three-strategy/[strategyId] — 策略 detail panel
 *
 * 2026-05-09: 楊董 ack item 4「detail panel 才顯示金額」
 *   - 策略全 spec (intro / signal logic / sizing / exit)
 *   - 8 caveat 燈號 verdict 表格（per ACK item 7 partial-pass posture）
 *   - 真金 toggle 區（Owner role only — 3 段位 OFF/PAPER/LIVE）
 *   - Paper observation audit panel（切 PAPER 後顯示）
 *
 * HARD LINES:
 *   - 不准顯示 "已驗證" / "approved" / "可上線" / "strategy approved"
 *   - 不准截斷 Athena caveat
 *   - 不准隱藏 KGI 真錢警示
 *   - 不准 mock 真實 quote / fake metric
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { PageFrame } from "@/components/PageFrame";
import { StrategyDetailClient } from "./StrategyDetailClient";

export const dynamic = "force-dynamic";

// ── Static strategy registry ───────────────────────────────────────────────────

export type CaveatEntry = {
  icon: "pass" | "warn" | "fail";
  label: string;
  detail: string;
};

export type StrategyDetailData = {
  strategyId: string;
  displayName: string;
  tagline: string;
  badgeVariant: "amber" | "blue" | "violet";
  badgeLabel: string;
  governanceState: string;

  /** 全文 caveat */
  fullCaveat: string;

  /** Intro / signal / sizing / exit spec */
  spec: {
    intro: string;
    signalLogic: string;
    sizing: string;
    exitRule: string;
  };

  /** 8 caveat 燈號 verdict (source: athena_lane_e_8_caveat_sweep) */
  caveatVerdicts: CaveatEntry[];

  /** Paper observation state */
  paperObservation: {
    startDate: string | null;
    expectedUnlockDate: string | null;
    status: "not_started" | "in_progress" | "completed";
  };
};

const STRATEGY_REGISTRY: Record<string, StrategyDetailData> = {
  cont_liq_h20_top3_market_trail20_gt_5pct: {
    strategyId: "cont_liq_h20_top3_market_trail20_gt_5pct",
    displayName: "流動順勢三強",
    tagline: "持有流動性相對強的前三名股票，等市場落後再進場，20 個交易日換倉一次。",
    badgeVariant: "amber",
    badgeLabel: "觀察中",
    governanceState: "L9_MARGINAL_PASS + forward observation pending",
    fullCaveat:
      "Bonferroni p=0.048 borderline（非 p<0.001）/ CPCV PBO 18.2% borderline（非 <5%）/ DSR（deflated Sharpe）計算中 / 需 ≥12 個 matured h20 forward observation 才算 process pass / 不是已驗證策略 / 僅通過 strict gate，不代表策略已驗證可上線",
    spec: {
      intro:
        "cont_liq 策略在 h20（20 個交易日）持有期框架下，選取流動性相對強度排前三的股票。進場條件為市場整體表現落後 20 日基準 5% 以上，意在趨勢反轉前佈局流動性領頭股。",
      signalLogic:
        "計算每檔股票過去 20 日流動性相對市場的強度分數（相對成交量 × 相對換手率）。排序取前三名。同時計算市場大盤過去 20 日相對自身 20 日均值的落差，需 > -5% 才觸發進場。",
      sizing: "等權重持有 3 檔個股。每檔最高 33%。調整頻率為每 20 個交易日一次（h20）。不使用槓桿。",
      exitRule:
        "持有 20 個交易日後全部換倉，依最新排序重新選股。無個股停損（持有期固定）。若觸發市場整體 kill switch 條件，全部清倉。",
    },
    caveatVerdicts: [
      {
        icon: "warn",
        label: "統計顯著性",
        detail: "Bonferroni 校正後 p=0.048，borderline（目標 <0.01），接受標準邊緣",
      },
      {
        icon: "warn",
        label: "CPCV PBO",
        detail: "Probabilistic Backtest Overfitting (CPCV) 18.2%，borderline（目標 <5%）",
      },
      {
        icon: "fail",
        label: "DSR（Deflated Sharpe）",
        detail: "計算進行中，尚未完成。需觀察期完成後重算",
      },
      {
        icon: "fail",
        label: "Forward observation",
        detail: "需 ≥12 個 matured h20 obs 才算 process pass，目前仍在收集中",
      },
      {
        icon: "pass",
        label: "回測樣本外分割",
        detail: "In-sample / Out-of-sample 分割完成，未見過 OOS 資料",
      },
      {
        icon: "pass",
        label: "L9 strict gate 通過",
        detail: "通過 IUF Lab L9 最嚴格 gate（邊緣通過），前提是 DSR / PBO 仍待確認",
      },
      {
        icon: "warn",
        label: "市場機制穩定性",
        detail: "2016–2024 回測，未測試 2008 / COVID 壓力情境",
      },
      {
        icon: "fail",
        label: "可上線背書",
        detail: "尚未完成，無法背書可上線。需完整觀察期 + DSR + PBO 全通過",
      },
    ],
    paperObservation: {
      startDate: null,
      expectedUnlockDate: null,
      status: "not_started",
    },
  },

  strategy_002_revenue_yoy_surprise: {
    strategyId: "strategy_002_revenue_yoy_surprise",
    displayName: "營收動能驚喜",
    tagline: "選出營收年增率大幅優於預期的個股，捕捉市場對基本面修正的動能。",
    badgeVariant: "blue",
    badgeLabel: "Paper 觀察中",
    governanceState: "PAPER_LIVE_OBSERVING (2026-05-09 起)",
    fullCaveat:
      "2026-05-09 起進入 paper live 觀察階段 / 尚無 matured forward observation / 回測數字僅供研究用，未通過完整 L9 gate / 不是已驗證策略 / 金額不顯示（detail panel 才顯示）",
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
        label: "統計顯著性",
        detail: "回測 p 值尚未完整計算，paper 期間收集 forward obs 後補算",
      },
      {
        icon: "fail",
        label: "CPCV PBO",
        detail: "尚未計算，需 paper 期 ≥6 個月後評估",
      },
      {
        icon: "fail",
        label: "DSR（Deflated Sharpe）",
        detail: "尚未計算，等待 paper forward obs 完成",
      },
      {
        icon: "fail",
        label: "Forward observation",
        detail: "2026-05-09 起累積 paper obs，目前 0 個 matured obs",
      },
      {
        icon: "warn",
        label: "回測樣本",
        detail: "2018–2024，台股月報公告機制回測，未含 COVID 供應鏈衝擊情境",
      },
      {
        icon: "warn",
        label: "資料依賴",
        detail: "依賴月報公告時間點精準性，延遲公告可能影響進場時機",
      },
      {
        icon: "fail",
        label: "L9 gate",
        detail: "尚未通過 L9，paper 觀察期完成前不計分",
      },
      {
        icon: "fail",
        label: "可上線背書",
        detail: "paper 觀察期最少 1 個交易日（以觀察 kill switch 回應）後，owner 可手動解鎖 LIVE",
      },
    ],
    paperObservation: {
      startDate: "2026-05-09",
      expectedUnlockDate: "2026-05-10",
      status: "in_progress",
    },
  },

  strategy_003_ma200_trend_follow: {
    strategyId: "strategy_003_ma200_trend_follow",
    displayName: "200 日均線順勢",
    tagline: "追蹤股價站穩 200 日均線的個股，順大趨勢方向持有，依 cache 換倉。",
    badgeVariant: "violet",
    badgeLabel: "回測原始",
    governanceState: "BACKTESTED_RAW + cache 短（尚未 forward test）",
    fullCaveat:
      "僅有回測數字，尚未進行 forward observation / cache 持有期較短，換倉頻率敏感 / 未通過 L9 gate / 不是已驗證策略 / 研究中，下一步需 forward test 設計",
    spec: {
      intro:
        "strategy_003 以個股股價相對 200 日移動平均（MA200）的位置為核心濾網，在大趨勢向上時持有，大趨勢轉空時空倉。屬於古典趨勢追蹤框架，換倉頻率受持倉 cache 長度影響較敏感。",
      signalLogic:
        "計算個股收盤價 / MA200 比值。比值 > 1.0 且上升趨勢確認者進入候選池。再用相對強度（vs 大盤 20 日）過濾，取前 10 名。若大盤 MA200 下方則所有持倉清空。",
      sizing: "等權重最多 10 檔，每檔最高 10%。持倉 cache 週期：因換倉頻率敏感，目前測試 10–30 日。不使用槓桿。",
      exitRule:
        "個股跌破 MA200 時清倉（單股停損）。大盤整體觸發 kill switch 時全清。持倉 cache 短意味著可能需要較高的換倉成本，需進一步優化。",
    },
    caveatVerdicts: [
      {
        icon: "fail",
        label: "統計顯著性",
        detail: "回測數字存在，但尚未進行完整統計顯著性測試",
      },
      {
        icon: "fail",
        label: "CPCV PBO",
        detail: "尚未計算",
      },
      {
        icon: "fail",
        label: "DSR（Deflated Sharpe）",
        detail: "尚未計算",
      },
      {
        icon: "fail",
        label: "Forward observation",
        detail: "尚未啟動 forward obs，需先設計觀察協議",
      },
      {
        icon: "warn",
        label: "換倉成本敏感",
        detail: "cache 持倉期短（10–30 日）導致換倉頻率高，transaction cost 對 Sharpe 影響未完整評估",
      },
      {
        icon: "warn",
        label: "市場機制",
        detail: "在台灣 T+2 交割、漲跌幅 10% 限制下，MA200 訊號延遲問題尚未測試",
      },
      {
        icon: "fail",
        label: "L9 gate",
        detail: "尚未進入 L9 評估流程",
      },
      {
        icon: "fail",
        label: "可上線背書",
        detail: "研究初期，無任何 forward evidence，不得上線",
      },
    ],
    paperObservation: {
      startDate: null,
      expectedUnlockDate: null,
      status: "not_started",
    },
  },
};

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ strategyId: string }>;
}) {
  const { strategyId } = await params;
  const data = STRATEGY_REGISTRY[strategyId];

  if (!data) {
    notFound();
  }

  return (
    <PageFrame
      code="LAB"
      title={`量化研究 / ${data.displayName}`}
      sub={`${data.badgeLabel} · ${data.governanceState}`}
    >
      {/* Back nav */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/lab/three-strategy"
          style={{
            fontSize: 12,
            color: "#888",
            textDecoration: "underline",
            fontFamily: "var(--mono, monospace)",
          }}
        >
          ← 三條策略列表
        </Link>
      </div>

      {/* Client-side detail panel (handles toggle UX + role check) */}
      <StrategyDetailClient data={data} />
    </PageFrame>
  );
}
