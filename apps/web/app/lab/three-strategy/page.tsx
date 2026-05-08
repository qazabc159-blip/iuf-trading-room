/**
 * /lab/three-strategy — 量化 Lab 真實 3 條策略狀態（Athena truth board v1, 2026-05-08）
 *
 * Source authority: athena_truth_board_v1
 *   IUF_QUANT_LAB/reports/memos/dm_2026_05_08_athena_yang_truth_board_v1.md
 *
 * HARD LINES (enforced in this file):
 *   - 不准顯示 "已驗證" / "approved" / "可上線" / "strategy approved"
 *   - 不准 truncate caveat 文字
 *   - 不准顯示 fake metric / fake current return / fake Sharpe
 *   - 不准動 broker / execution / risk backend
 *   - caveat 文字顯眼：font-size >= 12, color visible
 *
 * 三條策略治理狀態（verbatim from Athena truth board v1）：
 *   cont_liq  → L9_MARGINAL_PASS + forward observation pending  → 🟡 觀察中
 *   rs_20_60  → L8_FAIL_ALL_41_VARIANTS                         → ⚪ 研究阻塞
 *   MAIN      → KILLED_V11_NO_EDGE                              → 🔴 研究關閉
 */

import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

// ── Athena truth board v1 hardcoded data ──────────────────────────────────────
// Source: IUF_QUANT_LAB/reports/memos/dm_2026_05_08_athena_yang_truth_board_v1.md
// Backend lab endpoint returns v15 board data which pre-dates truth board v1 states.
// Per task instruction: hardcode display strings and tag source: athena_truth_board_v1
// Last synced: 2026-05-08 / Next refresh: 2026-05-15 or when Athena publishes new board

const TRUTH_BOARD_SOURCE = "athena_truth_board_v1 (2026-05-08)";

type BadgeColor = "yellow" | "gray" | "red";

type StrategyCard = {
  strategyId: string;
  displayName: string;
  badgeLabel: string;
  badgeColor: BadgeColor;
  governanceState: string;
  whatItDoes: string;
  caveat: string;
  metrics: string | null;
  closedReason: string | null;
};

const THREE_STRATEGIES: StrategyCard[] = [
  {
    strategyId: "cont_liq_h20_top3_market_trail20_gt_5pct",
    displayName: "流動性相對強度 (cont_liq)",
    badgeLabel: "觀察中",
    badgeColor: "yellow",
    governanceState: "L9_MARGINAL_PASS + forward observation pending",
    whatItDoes:
      "持有 20 日流動性相對強的股票，市場落後 20 日且超過 5%，top-3 持股；持有期 20 個交易日。選股依相對強度排序，不依個股預測。",
    caveat:
      "Bonferroni p=0.048 borderline（非 p<0.001）/ CPCV PBO 18.2% borderline（非 <5%）/ DSR（deflated Sharpe）計算中 / 需 ≥12 個 matured h20 forward observation 才算 process pass / 不是已驗證策略 / 僅通過 strict gate，不代表策略已驗證可上線",
    metrics: "research_only / not validated",
    closedReason: null,
  },
  {
    strategyId: "rs_20_60_low_drawdown__h20__top5",
    displayName: "相對強度低回撤 (rs_20_60)",
    badgeLabel: "研究阻塞",
    badgeColor: "gray",
    governanceState: "L8_FAIL_ALL_41_VARIANTS",
    whatItDoes:
      "以 20/60 日相對強度選股，附加低最大回撤篩選，持有 top-5；持有期 20 個交易日。設計意圖是比 MAIN 更穩定的動能捕捉。",
    caveat:
      "41 個 threshold sweep 變體全部 L8 fail / 過去 v28/v29/v30 只嘗試 hyperparameter sweep，未嘗試 z-score / continuous regime weight / multi-horizon ensemble / turnover penalty 等設計維度 / 下一輪 bounded repair sprint (Codex T-CODEX-02, MEDIUM) 不保證通過 / 可能是 family-level no-edge / 即使修復後 fail，Athena 會 emit honest NOT_PASS verdict",
    metrics: "evidence pending",
    closedReason: null,
  },
  {
    strategyId: "MAIN_execution_rank_buffer_top20",
    displayName: "執行排序緩衝 (MAIN)",
    badgeLabel: "研究關閉",
    badgeColor: "red",
    governanceState: "KILLED_V11_NO_EDGE",
    whatItDoes:
      "原始主力策略，依執行排序緩衝選取 top-20 持股；Wave V11 測試後確認無邊際優勢（SELECTION_DOMINANT_SECTOR_DEPENDENT），研究終止。",
    caveat:
      "Wave V11 KILL_NO_EDGE 終止 / SELECTION_DOMINANT_SECTOR_DEPENDENT（績效主要依賴行業選擇，非策略本身邊際）/ 不在任何 fire 條件內 / 研究永久關閉，不進行重啟",
    metrics: null,
    closedReason: "Wave V11 KILL_NO_EDGE — SELECTION_DOMINANT_SECTOR_DEPENDENT",
  },
];

// ── Badge component ────────────────────────────────────────────────────────────

function GovernanceBadge({ color, label }: { color: BadgeColor; label: string }) {
  const colorMap: Record<BadgeColor, React.CSSProperties> = {
    yellow: {
      background: "rgba(255, 184, 0, 0.14)",
      border: "1px solid rgba(255, 184, 0, 0.6)",
      color: "#ffb800",
    },
    gray: {
      background: "rgba(150, 150, 150, 0.12)",
      border: "1px solid rgba(150, 150, 150, 0.45)",
      color: "#a0a0a0",
    },
    red: {
      background: "rgba(220, 60, 60, 0.12)",
      border: "1px solid rgba(220, 60, 60, 0.5)",
      color: "#e05050",
    },
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.5,
        ...colorMap[color],
      }}
    >
      {label}
    </span>
  );
}

// ── Strategy card ──────────────────────────────────────────────────────────────

function StrategyCardView({ card }: { card: StrategyCard }) {
  const borderColor =
    card.badgeColor === "yellow"
      ? "rgba(255,184,0,0.3)"
      : card.badgeColor === "red"
        ? "rgba(220,60,60,0.3)"
        : "rgba(140,140,140,0.25)";
  const accentColor =
    card.badgeColor === "yellow"
      ? "#ffb800"
      : card.badgeColor === "red"
        ? "#e05050"
        : "#707070";

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "18px 20px",
        border: `1px solid ${borderColor}`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 6,
        background: "rgba(18, 18, 22, 0.6)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <GovernanceBadge color={card.badgeColor} label={card.badgeLabel} />
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "#888", letterSpacing: 0.3 }}>
          {card.strategyId}
        </span>
      </div>

      {/* Display name + governance state */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#e8e8e8", marginBottom: 2 }}>
          {card.displayName}
        </div>
        <div style={{ fontSize: 11, color: "#888", letterSpacing: 0.4 }}>
          治理狀態 / {card.governanceState}
        </div>
      </div>

      {/* What it does */}
      <div>
        <div
          style={{
            fontSize: 11,
            color: "#aaa",
            fontWeight: 600,
            marginBottom: 5,
            letterSpacing: 0.4,
            textTransform: "uppercase" as const,
          }}
        >
          策略說明
        </div>
        <div style={{ fontSize: 13, color: "#d0d0d0", lineHeight: 1.6 }}>
          {card.whatItDoes}
        </div>
      </div>

      {/* Caveat — full text, prominent, no truncation */}
      <div
        style={{
          padding: "12px 14px",
          background: "rgba(255, 200, 0, 0.05)",
          border: "1px solid rgba(255, 184, 0, 0.3)",
          borderRadius: 4,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#ffb800",
            letterSpacing: 0.5,
            marginBottom: 8,
            textTransform: "uppercase" as const,
          }}
        >
          Athena 注意事項（全文 / 不截斷）
        </div>
        <div style={{ fontSize: 12, color: "#d4d4d4", lineHeight: 1.75 }}>
          {card.caveat}
        </div>
      </div>

      {/* Metrics / evidence status */}
      {card.metrics !== null && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(100,100,100,0.08)",
            border: "1px solid rgba(100,100,100,0.2)",
            borderRadius: 4,
            fontSize: 12,
            color: "#888",
          }}
        >
          <span style={{ fontWeight: 600, color: "#aaa" }}>回測數字狀態：</span> {card.metrics}
        </div>
      )}

      {/* Closed reason (KILL only) */}
      {card.closedReason !== null && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(220,60,60,0.06)",
            border: "1px solid rgba(220,60,60,0.25)",
            borderRadius: 4,
            fontSize: 12,
            color: "#c06060",
          }}
        >
          <span style={{ fontWeight: 600 }}>關閉原因：</span> {card.closedReason}
        </div>
      )}

      {/* Source attribution */}
      <div style={{ fontSize: 10, color: "#666", letterSpacing: 0.3 }}>
        來源 / {TRUTH_BOARD_SOURCE}
      </div>
    </article>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LabThreeStrategyPage() {
  return (
    <PageFrame
      code="LAB"
      title="量化研究 / 三條策略狀態"
      sub="Athena truth board v1 / 邊跑邊修"
      note="本頁顯示 IUF Quant Lab 三條策略的真實治理狀態，來源為 Athena truth board v1 (2026-05-08)。所有 caveat 全文顯示，不截斷。不顯示已驗證、approved、可上線或任何背書字樣。"
    >
      {/* Master disclaimer */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "14px 18px",
          marginBottom: 20,
          border: "1px solid rgba(220,60,60,0.4)",
          borderLeft: "3px solid #e05050",
          background: "rgba(220,60,60,0.04)",
          borderRadius: 4,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#e05050",
            letterSpacing: 0.6,
            textTransform: "uppercase" as const,
          }}
        >
          重要聲明 — 此頁為邊跑邊修狀態
        </div>
        <div style={{ fontSize: 13, color: "#ddd", lineHeight: 1.6 }}>
          以下 3 條策略均為{" "}
          <strong style={{ color: "#ffb800" }}>研究狀態，尚未進入任何交易流程</strong>
          。無策略通過完整驗證。不顯示任何勝率、報酬率或配置建議。
        </div>
        <div style={{ fontSize: 11, color: "#999" }}>
          狀態來源 / {TRUTH_BOARD_SOURCE} · 下次更新 / 2026-05-15 或 Athena 發布新 truth board 時
        </div>
      </section>

      <Panel
        code="LAB-3S"
        title="三條策略治理狀態"
        sub="Athena truth board v1 — 邊跑邊修"
        right="3 條策略"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {THREE_STRATEGIES.map((card) => (
            <StrategyCardView key={card.strategyId} card={card} />
          ))}
        </div>

        <div
          style={{
            marginTop: 20,
            padding: "10px 14px",
            background: "rgba(18,18,22,0.5)",
            border: "1px solid rgba(100,100,100,0.2)",
            borderRadius: 4,
            fontSize: 11,
            color: "#777",
            lineHeight: 1.6,
          }}
        >
          本頁只顯示候選狀態與限制。未驗證績效、配置比例與買賣建議不顯示。治理資料來源：IUF Quant
          Lab / Athena truth board v1 / dm_2026_05_08_athena_yang_truth_board_v1.md
        </div>
      </Panel>

      <div style={{ marginTop: 16 }}>
        <Link
          href="/lab/strategies"
          style={{ fontSize: 12, color: "#888", textDecoration: "underline" }}
        >
          ← 量化研究候選策略列表
        </Link>
      </div>
    </PageFrame>
  );
}
