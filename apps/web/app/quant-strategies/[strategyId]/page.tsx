import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { PageFrame, Panel } from "@/components/PageFrame";
import {
  QUANT_COMPLIANCE_FOOTER,
  QUANT_GOVERNANCE_NOTES,
  formatMilestoneDate,
  getQuantStrategyContent,
} from "@/lib/quant-strategies-content";
import { MilestoneTrack } from "../MilestoneTrack";
import styles from "../QuantStrategies.module.css";

// v9.1（2026-07-19）：詳情頁沿用既有 PageFrame QNT- 家族 routing pattern，內容
// 改為純 fact-sheet（0 運行績效數字），不再打後端 basket/subscribe API。

export default async function QuantStrategyDetailPage({
  params,
}: {
  params: Promise<{ strategyId: string }>;
}) {
  const { strategyId } = await params;
  const strategy = getQuantStrategyContent(strategyId);
  if (!strategy) notFound();

  return (
    <PageFrame
      code="QNT-D"
      title={strategy.name}
      sub={strategy.oneLiner}
      note="里程碑進度 · 非即時績效"
    >
      <Panel
        code="QNT-D01"
        title={strategy.statusBadge}
        sub={`下一個動作 · ${strategy.nextAction.label} · ${formatMilestoneDate(strategy.nextAction.date)}`}
      >
        <div className={styles.chips}>
          {strategy.chips.map((chip) => (
            <span key={chip} className={styles.chip}>
              {chip}
            </span>
          ))}
        </div>

        <MilestoneTrack milestones={strategy.milestones} />

        <div className={styles.band}>
          <h2>策略說明</h2>
          <p className={styles.signal}>{strategy.detail.summary}</p>
          <ul className={styles.list}>
            {strategy.detail.mechanics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className={styles.navPlaceholder}>淨值曲線 · 將揭露</div>

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

      <Link href="/quant-strategies" className={styles.cta} style={{ maxWidth: 200, marginTop: 16 }}>
        <ArrowLeft size={16} strokeWidth={1.9} /> 返回量化策略
      </Link>
    </PageFrame>
  );
}
