import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PageFrame, Panel } from "@/components/PageFrame";
import {
  QUANT_COMPLIANCE_FOOTER,
  QUANT_GOVERNANCE_NOTES,
  QUANT_PAGE_HEADER,
  QUANT_STRATEGIES_CONTENT,
  formatMilestoneDate,
  type QuantStrategyContent,
} from "@/lib/quant-strategies-content";
import { MilestoneTrack } from "./MilestoneTrack";
import { QuantSectionTag } from "./QuantSectionTag";
import styles from "./QuantStrategies.module.css";

// v9.1（2026-07-19，楊董 ACK）：本頁改為純內容的策略 fact-sheet，不再打任何
// 後端績效 API（0 運行績效數字，Athena §2）。沒有 per-request 資料，頁面本身
// 不需要 force-dynamic。

function StrategyFactCard({ strategy }: { strategy: QuantStrategyContent }) {
  return (
    <article className={styles.card} data-testid="quant-strategy-card">
      <div className={styles.cardHead}>
        <h2>{strategy.name}</h2>
        <span className={styles.badge}>{strategy.statusBadge}</span>
      </div>
      <p className={styles.oneLiner}>{strategy.oneLiner}</p>
      <div className={styles.chips}>
        {strategy.chips.map((chip) => (
          <span key={chip} className={styles.chip}>
            {chip}
          </span>
        ))}
      </div>
      <div className={styles.nextAction}>
        <span>下一個動作</span>
        <strong>
          {strategy.nextAction.label} · {formatMilestoneDate(strategy.nextAction.date)}
        </strong>
      </div>
      <MilestoneTrack milestones={strategy.milestones} />
      <div className={styles.navPlaceholder}>淨值曲線 · 將揭露</div>
      <Link className={styles.cta} href={`/quant-strategies/${strategy.id}`}>
        查看策略詳情 <ArrowRight size={16} strokeWidth={1.9} />
      </Link>
    </article>
  );
}

export default function QuantStrategiesPage() {
  return (
    <PageFrame code="QNT" title={QUANT_PAGE_HEADER.title} sub={QUANT_PAGE_HEADER.subtitle} note={QUANT_PAGE_HEADER.note}>
      <Panel code="QNT-01" title="策略總覽" sub="里程碑進度 · 非即時績效">
        <QuantSectionTag zh="策略總覽" en="STRATEGY OVERVIEW" />
        <div className={styles.grid}>
          {QUANT_STRATEGIES_CONTENT.map((strategy) => (
            <StrategyFactCard key={strategy.id} strategy={strategy} />
          ))}
        </div>
        <div className={styles.governanceBand}>
          <h3>治理與保護</h3>
          <ul className={styles.list}>
            {QUANT_GOVERNANCE_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
        <p className={styles.complianceFooter}>{QUANT_COMPLIANCE_FOOTER}</p>
      </Panel>
    </PageFrame>
  );
}
