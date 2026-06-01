import { normalizeTwseIndustryZhTw } from "./twse-industry-normalize.js";

export interface NormalizableHeatmapTile {
  industry: string;
  avgChangePct: number;
  gainerCount: number;
  loserCount: number;
  flatCount: number;
  stockCount: number;
  source?: string;
}

interface HeatmapAccumulator<T extends NormalizableHeatmapTile> {
  sample: T;
  industry: string;
  weightedChangeSum: number;
  weight: number;
  gainerCount: number;
  loserCount: number;
  flatCount: number;
  stockCount: number;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function tileWeight(tile: NormalizableHeatmapTile): number {
  return Number.isFinite(tile.stockCount) && tile.stockCount > 0 ? tile.stockCount : 1;
}

export function normalizeAndMergeTwseHeatmapTiles<T extends NormalizableHeatmapTile>(
  tiles: readonly T[]
): T[] {
  const byIndustry = new Map<string, HeatmapAccumulator<T>>();

  for (const tile of tiles) {
    const industry = normalizeTwseIndustryZhTw(tile.industry);
    const weight = tileWeight(tile);
    const existing = byIndustry.get(industry);

    if (!existing) {
      byIndustry.set(industry, {
        sample: tile,
        industry,
        weightedChangeSum: tile.avgChangePct * weight,
        weight,
        gainerCount: tile.gainerCount,
        loserCount: tile.loserCount,
        flatCount: tile.flatCount,
        stockCount: tile.stockCount,
      });
      continue;
    }

    existing.weightedChangeSum += tile.avgChangePct * weight;
    existing.weight += weight;
    existing.gainerCount += tile.gainerCount;
    existing.loserCount += tile.loserCount;
    existing.flatCount += tile.flatCount;
    existing.stockCount += tile.stockCount;
  }

  return Array.from(byIndustry.values())
    .map((entry) => ({
      ...entry.sample,
      industry: entry.industry,
      avgChangePct: roundPct(entry.weightedChangeSum / Math.max(1, entry.weight)),
      gainerCount: entry.gainerCount,
      loserCount: entry.loserCount,
      flatCount: entry.flatCount,
      stockCount: entry.stockCount,
    }) as T)
    .sort((a, b) => {
      const absDelta = Math.abs(b.avgChangePct) - Math.abs(a.avgChangePct);
      if (absDelta !== 0) return absDelta;
      return b.stockCount - a.stockCount;
    });
}
