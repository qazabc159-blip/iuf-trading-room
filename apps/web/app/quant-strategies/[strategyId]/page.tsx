import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "../QuantStrategies.module.css";
import { loadQuantStrategy } from "../live-strategy-data";
import { StrategyDetailClient } from "./StrategyDetailClient";

export const dynamic = "force-dynamic";

export default async function QuantStrategyDetailPage({
  params,
}: {
  params: Promise<{ strategyId: string }>;
}) {
  const { strategyId } = await params;
  const strategy = await loadQuantStrategy(strategyId);
  if (!strategy) notFound();

  return (
    <main className={styles.shell}>
      <div className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>IUF QUANT STRATEGY</p>
          <h1 className={styles.title}>{strategy.name}</h1>
          <p className={styles.sub}>
            {strategy.role} / {strategy.cadence} / {strategy.basketSize}
          </p>
        </div>
        <div className={styles.statusRail} aria-label="S1 strategy status">
          <div className={styles.statusCell}>
            <span>狀態</span>
            <strong>{strategy.current.status}</strong>
          </div>
          <div className={styles.statusCell}>
            <span>最新 basket</span>
            <strong>{strategy.holdings.length}</strong>
          </div>
          <div className={styles.statusCell}>
            <span>研究樣本</span>
            <strong>{strategy.metrics.sampleCount ?? "--"}</strong>
          </div>
        </div>
      </div>

      <StrategyDetailClient strategy={strategy} />

      <Link href="/quant-strategies" className={styles.cta} style={{ maxWidth: 180, marginTop: 10 }}>
        返回量化策略
      </Link>
    </main>
  );
}
