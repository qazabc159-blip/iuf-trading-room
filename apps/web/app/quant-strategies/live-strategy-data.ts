import { getLabStrategySnapshot } from "@/lib/api";
import { getS1SimBasket, getS1SimStatus } from "@/lib/fauto-sim-api";

import {
  QUANT_STRATEGIES,
  getQuantStrategy,
  hydrateQuantStrategy,
  type QuantStrategy,
} from "./strategy-data";

export async function loadQuantStrategy(strategyId: string): Promise<QuantStrategy | null> {
  const [snapshot, statusResult] = await Promise.all([
    getLabStrategySnapshot(strategyId),
    getS1SimStatus(),
  ]);
  const status = statusResult.ok ? statusResult.data : null;
  const basketResult = status?.lastSignalDate
    ? await getS1SimBasket(status.lastSignalDate)
    : null;
  const basket = basketResult?.ok ? basketResult.data : null;

  return getQuantStrategy(strategyId, { snapshot, status, basket });
}

export async function loadQuantStrategies(): Promise<QuantStrategy[]> {
  const [snapshot, statusResult] = await Promise.all([
    getLabStrategySnapshot("cont_liq_v36"),
    getS1SimStatus(),
  ]);
  const status = statusResult.ok ? statusResult.data : null;
  const basketResult = status?.lastSignalDate
    ? await getS1SimBasket(status.lastSignalDate)
    : null;
  const basket = basketResult?.ok ? basketResult.data : null;

  return QUANT_STRATEGIES.map((strategy) =>
    hydrateQuantStrategy(strategy, { snapshot, status, basket }),
  );
}
