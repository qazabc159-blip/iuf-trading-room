import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "../QuantStrategies.module.css";
import { getQuantStrategy } from "../strategy-data";
import { StrategyDetailClient } from "./StrategyDetailClient";

export const dynamic = "force-dynamic";

export default async function QuantStrategyDetailPage({
  params,
}: {
  params: Promise<{ strategyId: string }>;
}) {
  const { strategyId } = await params;
  const strategy = getQuantStrategy(strategyId);
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
        <div className={styles.statusRail} aria-label="策略狀態">
          <div className={styles.statusCell}>
            <span>狀態</span>
            <strong>{strategy.current.status}</strong>
          </div>
          <div className={styles.statusCell}>
            <span>籃子</span>
            <strong>{strategy.holdings.length}</strong>
          </div>
          <div className={styles.statusCell}>
            <span>樣本</span>
            <strong>{strategy.metrics.sampleCount}</strong>
          </div>
        </div>
      </div>

      <StrategyDetailClient strategy={strategy} />

      <Link href="/quant-strategies" className={styles.cta} style={{ maxWidth: 180, marginTop: 10 }}>
        回策略總覽
      </Link>
    </main>
  );
}

