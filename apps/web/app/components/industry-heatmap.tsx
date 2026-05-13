"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

export type IndustryHeatmapTile = {
  symbol: string;
  name: string;
  sector?: string | null;
  pct: number | null;
  weight: number;
  source: string;
  price: number | null;
  date?: string | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  prevClose?: number | null;
  change?: number | null;
  volume?: number | null;
  readiness?: "ready" | "degraded" | "blocked";
  freshnessStatus?: "fresh" | "stale" | "missing";
};

type SectorKey =
  | "semiconductor"
  | "components"
  | "computer"
  | "communication"
  | "finance"
  | "steel"
  | "shipping";

type SectorDefinition = {
  key: SectorKey;
  label: string;
  shortLabel: string;
  description: string;
};

type PreparedTile = IndustryHeatmapTile & {
  sectorKey: SectorKey;
  sectorLabel: string;
  rank: number;
  tradingValue: number | null;
  areaWeight: number;
  weightLabel: string;
  displayPct: number;
  displayChange: number | null;
  isSupplemental?: boolean;
};

type SectorOption = SectorDefinition & {
  count: number;
  avgPct: number | null;
  hasData: boolean;
};

type LayoutTile = PreparedTile & {
  x: number;
  y: number;
  w: number;
  h: number;
  labelMode: "hero" | "large" | "medium" | "small";
};

type IndustryHeatmapProps = {
  heatmap: IndustryHeatmapTile[];
  initialSector?: string | null;
  updatedAt?: string | null;
  sourceLabel: string;
  marketState: "LIVE" | "STALE" | "EMPTY" | "REVIEW" | "BLOCKED" | "DEGRADED";
  reason?: string;
};

const MAX_TILES_PER_SECTOR = 13;
const TARGET_TILES_PER_SECTOR = 12;
const MIN_PRODUCT_COUNT = 10;

const SECTORS: SectorDefinition[] = [
  {
    key: "semiconductor",
    label: "半導體業",
    shortLabel: "半導體",
    description: "晶圓代工、IC 設計、封測與記憶體",
  },
  {
    key: "components",
    label: "電子零組件",
    shortLabel: "零組件",
    description: "PCB、被動元件、連接器與電源",
  },
  {
    key: "computer",
    label: "電腦及週邊設備",
    shortLabel: "電腦週邊",
    description: "伺服器、AI PC、品牌與散熱",
  },
  {
    key: "communication",
    label: "通信網路",
    shortLabel: "通信網路",
    description: "電信、交換器、網通設備",
  },
  {
    key: "finance",
    label: "金融保險",
    shortLabel: "金融",
    description: "金控、銀行、證券與保險",
  },
  {
    key: "steel",
    label: "鋼鐵工業",
    shortLabel: "鋼鐵",
    description: "鋼品、盤元、不鏽鋼與金屬加工",
  },
  {
    key: "shipping",
    label: "航運業",
    shortLabel: "航運",
    description: "貨櫃、散裝、航空與陸運",
  },
];

const SYMBOL_SECTOR: Record<string, SectorKey> = {
  "2330": "semiconductor",
  "2454": "semiconductor",
  "2303": "semiconductor",
  "2379": "semiconductor",
  "3034": "semiconductor",
  "3711": "semiconductor",
  "3443": "semiconductor",
  "3661": "semiconductor",
  "6488": "semiconductor",
  "2408": "semiconductor",
  "2344": "semiconductor",
  "2449": "semiconductor",
  "6239": "semiconductor",
  "3260": "semiconductor",
  "6531": "semiconductor",
  "3105": "semiconductor",
  "2327": "components",
  "2308": "components",
  "2313": "components",
  "2368": "components",
  "3037": "components",
  "8046": "components",
  "4958": "components",
  "6176": "components",
  "6269": "components",
  "3189": "components",
  "3533": "components",
  "5439": "components",
  "2382": "computer",
  "2356": "computer",
  "3231": "computer",
  "6669": "computer",
  "2357": "computer",
  "2376": "computer",
  "2377": "computer",
  "2395": "computer",
  "3017": "computer",
  "2301": "computer",
  "2353": "computer",
  "2412": "communication",
  "3045": "communication",
  "4904": "communication",
  "3596": "communication",
  "5388": "communication",
  "6285": "communication",
  "2345": "communication",
  "3706": "computer",
  "2881": "finance",
  "2882": "finance",
  "2883": "finance",
  "2884": "finance",
  "2885": "finance",
  "2886": "finance",
  "2887": "finance",
  "2890": "finance",
  "2891": "finance",
  "2892": "finance",
  "5880": "finance",
  "5876": "finance",
  "2002": "steel",
  "2014": "steel",
  "2015": "steel",
  "2023": "steel",
  "2027": "steel",
  "2031": "steel",
  "9958": "steel",
  "2603": "shipping",
  "2609": "shipping",
  "2615": "shipping",
  "2618": "shipping",
  "2610": "shipping",
  "2633": "shipping",
  "2606": "shipping",
  "2617": "shipping",
  "1560": "components",
  "1582": "components",
  "2059": "components",
  "2317": "components",
  "2337": "semiconductor",
  "2360": "computer",
  "2362": "computer",
  "2365": "computer",
  "2385": "computer",
  "2409": "semiconductor",
  "2439": "components",
  "2474": "computer",
  "2481": "components",
  "2492": "components",
  "3005": "computer",
  "3013": "components",
  "3042": "computer",
  "3044": "computer",
  "3090": "components",
  "3234": "computer",
  "3299": "semiconductor",
  "3481": "computer",
  "3532": "semiconductor",
  "3653": "semiconductor",
  "3702": "computer",
  "3707": "semiconductor",
  "3714": "computer",
  "4915": "components",
  "4991": "semiconductor",
  "5269": "components",
  "5347": "semiconductor",
  "5483": "semiconductor",
  "6182": "computer",
  "6147": "computer",
  "6770": "semiconductor",
  "8150": "semiconductor",
  "1605": "components",
  "1717": "components",
  "2006": "steel",
  "2007": "steel",
  "2008": "steel",
  "2009": "steel",
  "2010": "steel",
  "2012": "steel",
  "2013": "steel",
  "2017": "steel",
  "2020": "steel",
  "2022": "steel",
  "2024": "steel",
  "2025": "steel",
  "2028": "steel",
  "2029": "steel",
  "2030": "steel",
  "2032": "steel",
  "2033": "steel",
  "2034": "steel",
  "2314": "communication",
  "2332": "communication",
  "2354": "components",
  "2419": "communication",
  "2450": "communication",
  "2485": "communication",
  "3025": "communication",
  "3062": "communication",
  "3380": "communication",
  "3491": "communication",
  "4906": "communication",
  "6152": "communication",
  "6416": "communication",
  "2607": "shipping",
  "2608": "shipping",
  "2611": "shipping",
  "2612": "shipping",
  "2613": "shipping",
  "2634": "shipping",
  "2636": "shipping",
  "2637": "shipping",
  "2646": "shipping",
  "5607": "shipping",
  "5608": "shipping",
};

const REPRESENTATIVE_ORDER = Object.keys(SYMBOL_SECTOR).reduce<Record<string, number>>((acc, symbol, index) => {
  acc[symbol] = index + 1;
  return acc;
}, {});

function sectorDefinition(key: SectorKey) {
  return SECTORS.find((sector) => sector.key === key) ?? SECTORS[0];
}

function normalizeSector(tile: IndustryHeatmapTile): SectorKey | null {
  const mapped = SYMBOL_SECTOR[tile.symbol];
  if (mapped) return mapped;

  const raw = `${tile.sector ?? ""} ${tile.name ?? ""}`.trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("半導體") || raw.includes("semiconductor") || raw.includes("ic design") || raw.includes("foundry")) {
    return "semiconductor";
  }
  if (raw.includes("電子零組件") || raw.includes("被動元件") || raw.includes("pcb") || raw.includes("component") || raw.includes("connector")) {
    return "components";
  }
  if (raw.includes("電腦") || raw.includes("週邊") || raw.includes("伺服器") || raw.includes("computer") || raw.includes("hardware") || raw.includes("server")) {
    return "computer";
  }
  if (raw.includes("通信") || raw.includes("網路") || raw.includes("電信") || raw.includes("communication") || raw.includes("telecom") || raw.includes("network")) {
    return "communication";
  }
  if (raw.includes("金融") || raw.includes("保險") || raw.includes("銀行") || raw.includes("金控") || raw.includes("bank") || raw.includes("insurance") || raw.includes("financial")) {
    return "finance";
  }
  if (raw.includes("鋼鐵") || raw.includes("steel")) {
    return "steel";
  }
  if (raw.includes("航運") || raw.includes("海運") || raw.includes("航空") || raw.includes("shipping") || raw.includes("airline") || raw.includes("transport")) {
    return "shipping";
  }
  return null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMove(value: number) {
  return Math.round(value * 100) / 100;
}

function deriveMove(tile: IndustryHeatmapTile) {
  const close = finiteNumber(tile.close ?? tile.price);
  const prevClose = finiteNumber(tile.prevClose);
  if (close !== null && prevClose !== null && prevClose > 0) {
    const change = roundMove(close - prevClose);
    return {
      pct: roundMove((change / prevClose) * 100),
      change,
    };
  }

  const change = finiteNumber(tile.change);
  if (close !== null && change !== null) {
    const derivedPrevClose = close - change;
    if (derivedPrevClose > 0) {
      return {
        pct: roundMove((change / derivedPrevClose) * 100),
        change: roundMove(change),
      };
    }
  }

  const pct = finiteNumber(tile.pct);
  if (pct !== null) {
    const derivedChange = close !== null && pct > -99.99 ? roundMove(close - close / (1 + pct / 100)) : null;
    return {
      pct: roundMove(pct),
      change: derivedChange,
    };
  }

  const open = finiteNumber(tile.open);
  if (close !== null && open !== null && open > 0) {
    const intradayChange = roundMove(close - open);
    return {
      pct: roundMove((intradayChange / open) * 100),
      change: intradayChange,
    };
  }

  return {
    pct: null,
    change: null,
  };
}

function validMove(tile: IndustryHeatmapTile) {
  return deriveMove(tile).pct !== null;
}

function isUsableTile(tile: IndustryHeatmapTile) {
  return (
    tile.symbol.trim().length > 0 &&
    tile.name.trim().length > 0 &&
    validMove(tile) &&
    tile.readiness !== "blocked" &&
    tile.freshnessStatus !== "missing"
  );
}

function estimatedTradingValue(tile: IndustryHeatmapTile) {
  const price = tile.close ?? tile.price;
  if (typeof price !== "number" || price <= 0) return null;
  if (typeof tile.volume !== "number" || tile.volume <= 0) return null;
  return price * tile.volume;
}

function preparedWeight(tile: IndustryHeatmapTile, fallbackRank: number) {
  const tradingValue = estimatedTradingValue(tile);
  if (tradingValue && tradingValue > 0) {
    return {
      tradingValue,
      areaWeight: Math.pow(tradingValue, 0.34),
      weightLabel: `成交值 ${formatMoney(tradingValue)}`,
    };
  }
  if (typeof tile.weight === "number" && Number.isFinite(tile.weight) && tile.weight > 0) {
    return {
      tradingValue: null,
      areaWeight: Math.max(1, Math.pow(tile.weight, 0.58)),
      weightLabel: `權重 ${formatCompact(tile.weight)}`,
    };
  }
  return {
    tradingValue: null,
    areaWeight: Math.max(1, 34 - fallbackRank),
    weightLabel: "代表股權重",
  };
}

function prepareTiles(heatmap: IndustryHeatmapTile[]) {
  const seen = new Set<string>();
  const rows: PreparedTile[] = [];

  heatmap.forEach((tile, index) => {
    if (seen.has(tile.symbol)) return;
    seen.add(tile.symbol);
    if (!isUsableTile(tile)) return;
    const sectorKey = normalizeSector(tile);
    if (!sectorKey) return;
    const move = deriveMove(tile);
    if (move.pct === null) return;
    const rank = REPRESENTATIVE_ORDER[tile.symbol] ?? 1000 + index;
    const weight = preparedWeight(tile, rank);
    const definition = sectorDefinition(sectorKey);
    rows.push({
      ...tile,
      sectorKey,
      sectorLabel: definition.label,
      rank,
      displayPct: move.pct,
      displayChange: move.change,
      ...weight,
    });
  });

  return rows;
}

function sortByHeatmapPriority(left: PreparedTile, right: PreparedTile) {
  const tradingDelta = (right.tradingValue ?? 0) - (left.tradingValue ?? 0);
  if (Math.abs(tradingDelta) > 0.001) return tradingDelta;
  const weightDelta = right.areaWeight - left.areaWeight;
  if (Math.abs(weightDelta) > 0.001) return weightDelta;
  const moveDelta = Math.abs(right.displayPct) - Math.abs(left.displayPct);
  if (Math.abs(moveDelta) > 0.001) return moveDelta;
  return left.rank - right.rank;
}

function primaryRowsForSector(prepared: PreparedTile[], sectorKey: SectorKey) {
  return prepared
    .filter((tile) => tile.sectorKey === sectorKey)
    .sort(sortByHeatmapPriority)
    .slice(0, MAX_TILES_PER_SECTOR);
}

function rowsForSector(prepared: PreparedTile[], sectorKey: SectorKey) {
  return primaryRowsForSector(prepared, sectorKey);
}

function buildOptions(prepared: PreparedTile[]): SectorOption[] {
  return SECTORS.map((sector) => {
    const primaryRows = primaryRowsForSector(prepared, sector.key);
    const avgPct = primaryRows.length > 0
      ? primaryRows.reduce((sum, tile) => sum + tile.displayPct, 0) / primaryRows.length
      : null;
    return {
      ...sector,
      count: primaryRows.length,
      avgPct,
      hasData: primaryRows.length > 0,
    };
  });
}

function chooseInitialSector(options: SectorOption[], requested?: string | null) {
  let normalized = (requested ?? "").trim();
  try {
    normalized = decodeURIComponent(normalized).trim();
  } catch {
    normalized = (requested ?? "").trim();
  }
  const requestedMatch = options.find((option) => option.key === normalized || option.label === normalized);
  if (requestedMatch) return requestedMatch.key;
  return options.find((option) => option.key === "semiconductor" && option.hasData)?.key
    ?? options.find((option) => option.hasData)?.key
    ?? "semiconductor";
}

function buildTreemapLayout(items: PreparedTile[]): LayoutTile[] {
  const sorted = [...items].sort((left, right) => right.areaWeight - left.areaWeight);
  const totalWeight = sorted.reduce((sum, item) => sum + Math.max(1, item.areaWeight), 0);
  if (totalWeight <= 0) return [];

  const nodes = sorted.map((item) => ({
    item,
    area: (Math.max(1, item.areaWeight) / totalWeight) * 10_000,
  }));
  const rect = { x: 0, y: 0, w: 100, h: 100 };
  const layout: LayoutTile[] = [];
  let row: typeof nodes = [];

  function worstAspect(candidate: typeof nodes, side: number) {
    if (candidate.length === 0 || side <= 0) return Number.POSITIVE_INFINITY;
    const areas = candidate.map((node) => Math.max(0.01, node.area));
    const sum = areas.reduce((acc, area) => acc + area, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  }

  function labelMode(w: number, h: number): LayoutTile["labelMode"] {
    const area = w * h;
    if (area >= 600 && w >= 18 && h >= 18) return "hero";
    if (area >= 260 && w >= 11 && h >= 12) return "large";
    if (area >= 92 && w >= 6.5 && h >= 8) return "medium";
    return "small";
  }

  function pushRow(nodesInRow: typeof nodes) {
    if (nodesInRow.length === 0 || rect.w <= 0 || rect.h <= 0) return;
    const rowArea = nodesInRow.reduce((sum, node) => sum + node.area, 0);

    if (rect.w < rect.h) {
      const rowH = Math.min(rect.h, rowArea / rect.w);
      let xCursor = rect.x;
      nodesInRow.forEach((node, index) => {
        const tileW = index === nodesInRow.length - 1 ? rect.x + rect.w - xCursor : node.area / rowH;
        const mode = labelMode(tileW, rowH);
        layout.push({ ...node.item, x: xCursor, y: rect.y, w: tileW, h: rowH, labelMode: mode });
        xCursor += tileW;
      });
      rect.y += rowH;
      rect.h -= rowH;
      return;
    }

    const rowW = Math.min(rect.w, rowArea / rect.h);
    let yCursor = rect.y;
    nodesInRow.forEach((node, index) => {
      const tileH = index === nodesInRow.length - 1 ? rect.y + rect.h - yCursor : node.area / rowW;
      const mode = labelMode(rowW, tileH);
      layout.push({ ...node.item, x: rect.x, y: yCursor, w: rowW, h: tileH, labelMode: mode });
      yCursor += tileH;
    });
    rect.x += rowW;
    rect.w -= rowW;
  }

  for (const node of nodes) {
    const side = Math.min(rect.w, rect.h);
    const nextRow = [...row, node];
    if (row.length === 0 || worstAspect(nextRow, side) <= worstAspect(row, side)) {
      row = nextRow;
    } else {
      pushRow(row);
      row = [node];
    }
  }
  pushRow(row);

  return layout;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "更新中";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatPrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "更新中";
  return value >= 1000 ? value.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : value.toFixed(2);
}

function formatCompact(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "更新中";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "更新中";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 億`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(0)} 萬`;
  return formatCompact(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "尚未更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const month = lookup.month ?? "??";
  const day = lookup.day ?? "??";
  const hour = lookup.hour ?? "??";
  const minute = lookup.minute ?? "??";
  return `${month}/${day} ${hour}:${minute}`;
}

function toneForMove(value: number | null | undefined) {
  if (typeof value !== "number" || Math.abs(value) < 0.01) return "flat";
  return value > 0 ? "up" : "down";
}

function updateSectorQuery(nextKey: SectorKey) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("sector", nextKey);
  window.history.replaceState(null, "", url);
}

function TileTooltip({ tile }: { tile: LayoutTile }) {
  return (
    <span className="tac-heat-tooltip" role="tooltip">
      <strong>{tile.symbol} {tile.name}</strong>
      <span>漲跌幅 {formatPercent(tile.displayPct)}</span>
      {tile.displayChange !== null && <span>漲跌 {formatPrice(tile.displayChange)}</span>}
      <span>{tile.weightLabel}</span>
      <span>收盤 {formatPrice(tile.close ?? tile.price)}</span>
      {tile.date && <span>日期 {tile.date}</span>}
    </span>
  );
}

function HeatmapTile({ tile }: { tile: LayoutTile }) {
  const pct = tile.displayPct;
  const abs = Math.min(1, Math.abs(pct) / 3);
  const tone = toneForMove(pct);
  const style = {
    "--heat": String(0.28 + abs * 0.58),
    left: `${tile.x}%`,
    top: `${tile.y}%`,
    width: `${tile.w}%`,
    height: `${tile.h}%`,
  } as CSSProperties;
  const title = `${tile.symbol} ${tile.name}，漲跌幅 ${formatPercent(tile.displayPct)}，${tile.weightLabel}`;

  return (
    <Link
      href={`/companies/${encodeURIComponent(tile.symbol)}`}
      className={`tac-heat-tile ${tone} ${tile.labelMode} ${tile.isSupplemental ? "is-supplemental" : ""}`}
      style={style}
      aria-label={title}
    >
      <span className="tile-symbol">{tile.symbol}</span>
      {(tile.labelMode === "hero" || tile.labelMode === "large" || tile.labelMode === "medium") && (
        <small className="tile-name">{tile.name}</small>
      )}
      <b className="tile-pct">{formatPercent(tile.displayPct)}</b>
      {tile.labelMode === "hero" && <em className="tile-meta">{tile.weightLabel}</em>}
      <TileTooltip tile={tile} />
    </Link>
  );
}

export function IndustryHeatmap({
  heatmap,
  initialSector,
  updatedAt,
  sourceLabel,
  marketState,
  reason,
}: IndustryHeatmapProps) {
  const prepared = useMemo(() => prepareTiles(heatmap), [heatmap]);
  const options = useMemo(() => buildOptions(prepared), [prepared]);
  const [activeKey, setActiveKey] = useState<SectorKey>(() => chooseInitialSector(options, initialSector));
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const next = chooseInitialSector(options, initialSector);
    setActiveKey((current) => (options.some((option) => option.key === current) ? current : next));
  }, [initialSector, options]);

  const activeOption = options.find((option) => option.key === activeKey) ?? options[0];
  const selectedRows = useMemo(() => rowsForSector(prepared, activeKey), [prepared, activeKey]);
  const layout = useMemo(() => buildTreemapLayout(selectedRows), [selectedRows]);
  const selectedAvg = activeOption?.avgPct ?? null;
  const hasEnoughForProduct = selectedRows.length >= MIN_PRODUCT_COUNT;
  const emptyReason = marketState === "BLOCKED"
    ? (reason ?? "市場資料目前無法更新。")
    : "此產業目前沒有足夠正式行情，先不顯示熱力圖。";

  function handleSectorChange(nextKey: SectorKey) {
    if (nextKey === activeKey) return;
    setSwitching(true);
    setActiveKey(nextKey);
    updateSectorQuery(nextKey);
    window.setTimeout(() => setSwitching(false), 180);
  }

  return (
    <div className="tac-industry-heatmap">
      <div className="tac-heat-toolbar">
        <div>
          <span className="tac-heat-kicker">面積代表權重，顏色代表漲跌幅</span>
          <strong>{activeOption?.description ?? "依產業查看代表股表現"}</strong>
        </div>
        <div className="tac-heat-stats" aria-label="熱力圖摘要">
          <span>更新 {formatDateTime(updatedAt)}</span>
          <span>{selectedRows.length} 檔</span>
          <span className={toneForMove(selectedAvg)}>均幅 {formatPercent(selectedAvg)}</span>
        </div>
      </div>

      <div className="tac-heat-sector-tabs" aria-label="選擇熱力圖產業">
        {options.map((option) => (
          <button
            type="button"
            className={`${option.key === activeKey ? "is-active" : ""} ${option.hasData ? "" : "is-muted"}`}
            aria-pressed={option.key === activeKey}
            onClick={() => handleSectorChange(option.key)}
            key={option.key}
          >
            <b>{option.label}</b>
            <span>{option.count} 檔</span>
          </button>
        ))}
      </div>

      <div className={`tac-heatmap ${switching ? "is-switching" : ""}`}>
        {layout.length > 0 ? (
          <div className="tac-heatmap-canvas tac-market-heatmap-canvas">
            {layout.map((tile) => <HeatmapTile tile={tile} key={tile.symbol} />)}
          </div>
        ) : (
          <div className="tac-heat-empty" role="status">
            <span>{activeOption?.label ?? "產業"} · 公開資料更新中</span>
            <strong>{emptyReason}</strong>
            <small>{sourceLabel} · 資料約 5-15 秒延遲</small>
          </div>
        )}
      </div>

      <div className="tac-heat-footer">
        <span>
          {hasEnoughForProduct ? "代表股篩選完成" : "檔數不足時只顯示可驗證資料"} · 依成交值優先排序 · {sourceLabel}
        </span>
        <span className="tac-heat-scale" aria-label="漲跌幅色階">
          <em>≤ -3%</em>
          <i />
          <em>≥ +3%</em>
        </span>
      </div>
    </div>
  );
}
