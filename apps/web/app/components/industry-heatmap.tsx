"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { formatSectorChipCount } from "./industry-heatmap-chip";

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
  freshnessStatus?: "fresh" | "stale" | "missing" | "closed_snapshot";
  /** Jason 3-tier backend sourceState: live = KGI tick, twse_eod = TWSE EOD, cache = DB cache, no_data = no data at all */
  sourceState?: "live" | "twse_eod" | "cache" | "no_data";
  /** Human-readable source label from backend (e.g. "5/15 (五) 收盤 (週末休市)") */
  sourceLabel?: string | null;
};

type SectorKey =
  | "all"
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
  /** true = 這檔不在固定代表名單內，是缺角遞補進來的候選股（2026-07-14
   * 楊董定案：市面熱力圖標準做法——永遠是有行情的真公司，缺誰就從候選
   * 序列遞補真公司，不留洞、不用灰塊佔位）。同一支股票在不同分頁
   * （全部 vs 個別產業）可能一邊是固定代表、一邊是遞補，此旗標只對單次
   * primaryRowsForSector() 呼叫的回傳結果有意義，不寫回 prepared 原始物件。 */
  isSupplemental?: boolean;
};

type SectorOption = SectorDefinition & {
  count: number;
  availableCount: number;
  /** Size of this tab's own fixed representative candidate pool (e.g. 15 per
   * sector, 40 for "全部"/核心觀察池). Each tab's pool is an independently
   * curated list — NOT a partition of the other tabs — so per-tab counts do
   * not sum to the "全部" total. Showing count/target makes that explicit
   * instead of a bare number that looks like a fake/inconsistent count
   * (P1-3, reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md). */
  target: number;
  avgPct: number | null;
  hasData: boolean;
};

type IndustryHeatmapProps = {
  heatmap: IndustryHeatmapTile[];
  initialSector?: string | null;
  updatedAt?: string | null;
  sourceLabel: string;
  marketState: "LIVE" | "STALE" | "EMPTY" | "REVIEW" | "BLOCKED" | "DEGRADED";
  reason?: string;
};

const MAX_TILES_PER_SECTOR = 15;
const MAX_TILES_ALL = 40;
const TARGET_TILES_PER_SECTOR = 12;
const MIN_PRODUCT_COUNT = 10;

const SECTORS: SectorDefinition[] = [
  {
    key: "all",
    label: "核心觀察池",
    shortLabel: "全部",
    description: "40 檔核心權值與策略觀察股",
  },
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
  "6415": "semiconductor",
  "5274": "semiconductor",
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
  "4938": "computer",
  "6230": "computer",
  "8210": "computer",
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
  "2880": "finance",
  "2890": "finance",
  "2891": "finance",
  "2892": "finance",
  "5880": "finance",
  "5876": "finance",
  "2801": "finance",
  "2812": "finance",
  "2834": "finance",
  "2002": "steel",
  "2014": "steel",
  "2015": "steel",
  "2023": "steel",
  "2027": "steel",
  "2031": "steel",
  "9958": "steel",
  "2603": "shipping",
  "2605": "shipping",
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
  "6757": "shipping",
  "5607": "shipping",
  "5608": "shipping",
};

type RepresentativeSectorKey = Exclude<SectorKey, "all">;

const SECTOR_REPRESENTATIVES: Record<RepresentativeSectorKey, string[]> = {
  semiconductor: ["2330", "2454", "2303", "3711", "3034", "2379", "3443", "3661", "6488", "6770", "6415", "5274", "3707", "2337", "8150"],
  components: ["2308", "2317", "2327", "3037", "3044", "4958", "8046", "2492", "3013", "2368", "6176", "6269", "2354", "2059", "5269"],
  computer: ["2382", "3231", "6669", "2356", "2376", "2377", "2395", "3017", "3324", "3706", "4938", "2357", "3005", "2301", "2353"],
  communication: ["2412", "3045", "4904", "2345", "3596", "5388", "6285", "6416", "2314", "2332", "2419", "3025", "2450", "4906", "6152"],
  finance: ["2881", "2882", "2884", "2885", "2886", "2891", "2892", "5880", "5876", "2801", "2887", "2890", "2880", "2812", "2834"],
  steel: ["2002", "2006", "2014", "2015", "2023", "2027", "2031", "9958", "2007", "2008", "2010", "2022", "2009", "2013", "2029"],
  shipping: ["2603", "2609", "2615", "2636", "2605", "2606", "2610", "2618", "2646", "6757", "2607", "5608", "2608", "2617", "2637"],
};

const CORE_REPRESENTATIVES = [
  "2330", "2317", "2454", "2881", "2308", "2412", "2382", "2603",
  "2882", "2891", "3711", "2002", "3231", "2886", "2379", "2609",
  "3034", "3045", "6669", "2892", "2303", "2885", "2356", "5880",
  "2327", "2395", "2884", "3017", "2377", "5876", "4938", "2801",
  "3443", "4958", "2357", "2605", "6488", "8046", "3005", "2354",
];

const REPRESENTATIVE_COMPANY_NAMES: Record<string, string> = {
  "1560": "中砂",
  "2002": "中鋼",
  "2006": "東和鋼鐵",
  "2007": "燁興",
  "2008": "高興昌",
  "2010": "春源",
  "2014": "中鴻",
  "2015": "豐興",
  "2022": "聚亨",
  "2023": "燁輝",
  "2027": "大成鋼",
  "2031": "新光鋼",
  "2303": "聯電",
  "2308": "台達電",
  "2314": "台揚",
  "2317": "鴻海",
  "2327": "國巨",
  "2330": "台積電",
  "2332": "友訊",
  "2345": "智邦",
  "2354": "鴻準",
  "2356": "英業達",
  "2357": "華碩",
  "2368": "金像電",
  "2376": "技嘉",
  "2377": "微星",
  "2379": "瑞昱",
  "2382": "廣達",
  "2395": "研華",
  "2412": "中華電",
  "2419": "仲琦",
  "2454": "聯發科",
  "2492": "華新科",
  "2603": "長榮",
  "2605": "新興",
  "2606": "裕民",
  "2607": "榮運",
  "2609": "陽明",
  "2610": "華航",
  "2615": "萬海",
  "2618": "長榮航",
  "2636": "台驊投控",
  "2646": "星宇航空",
  "2801": "彰銀",
  "2881": "富邦金",
  "2882": "國泰金",
  "2884": "玉山金",
  "2885": "元大金",
  "2886": "兆豐金",
  "2887": "台新金",
  "2890": "永豐金",
  "2891": "中信金",
  "2892": "第一金",
  "3005": "神基",
  "3013": "晟銘電",
  "3017": "奇鋐",
  "3025": "星通",
  "3034": "聯詠",
  "3037": "欣興",
  "3044": "健鼎",
  "3045": "台灣大",
  "3231": "緯創",
  "3324": "雙鴻",
  "3443": "創意",
  "3596": "智易",
  "3661": "世芯-KY",
  "3706": "神達",
  "3711": "日月光投控",
  "4904": "遠傳",
  "4938": "和碩",
  "4958": "臻鼎-KY",
  "5274": "信驊",
  "5388": "中磊",
  "5608": "四維航",
  "5876": "上海商銀",
  "5880": "合庫金",
  "6176": "瑞儀",
  "6230": "超眾",
  "6269": "台郡",
  "6285": "啟碁",
  "6415": "矽力*-KY",
  "6416": "瑞祺電通",
  "6488": "環球晶",
  "6669": "緯穎",
  "6757": "台灣虎航",
  "6770": "力積電",
  "8046": "南電",
  "8210": "勤誠",
  "9958": "世紀鋼",
};

const REPRESENTATIVE_ORDER = [
  ...CORE_REPRESENTATIVES,
  ...Object.values(SECTOR_REPRESENTATIVES).flat(),
  ...Object.keys(SYMBOL_SECTOR),
].reduce<Record<string, number>>((acc, symbol, index) => {
  if (acc[symbol] !== undefined) return acc;
  acc[symbol] = index + 1;
  return acc;
}, {});

function representativeSymbolsForSector(sectorKey: SectorKey) {
  if (sectorKey === "all") return CORE_REPRESENTATIVES;
  return SECTOR_REPRESENTATIVES[sectorKey] ?? [];
}

function representativeCompanyName(symbol: string, rawName?: string | null) {
  const normalized = rawName?.trim();
  const fixedName = REPRESENTATIVE_COMPANY_NAMES[symbol];
  if (normalized && normalized !== symbol && !normalized.includes("�")) return normalized;
  return fixedName ?? normalized ?? symbol;
}

function representativeRank(symbol: string, fallbackRank: number) {
  return REPRESENTATIVE_ORDER[symbol] ?? 1000 + fallbackRank;
}

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
  if (tile.symbol.trim().length === 0 || tile.name.trim().length === 0) return false;
  if (tile.readiness === "blocked") return false;
  // Missing representative quotes are reported in the footer, not rendered as gray empty tiles.
  if (tile.sourceState === "no_data") return false;
  // Standard path: must have a valid price move
  if (!validMove(tile)) return false;
  if (tile.freshnessStatus === "missing") return false;
  return true;
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

// 產出「全宇宙候選池」——不限於固定代表名單，任何回傳可驗證行情且能
// 判斷所屬產業的個股都留著，給 primaryRowsForSector() 在代表股缺角時
// 當真公司遞補候選（2026-07-14 楊董定案：缺角要遞補真公司，不是灰塊）。
function prepareTiles(heatmap: IndustryHeatmapTile[]) {
  const rowsBySymbol = new Map<string, PreparedTile>();

  function addTile(tile: IndustryHeatmapTile, index: number) {
    const symbol = tile.symbol.trim();
    if (!symbol) return;
    const normalizedTile = {
      ...tile,
      symbol,
      name: representativeCompanyName(symbol, tile.name),
    };
    if (!isUsableTile(normalizedTile)) return;
    const sectorKey = normalizeSector(normalizedTile);
    if (!sectorKey) return;

    const move = deriveMove(normalizedTile);
    if (move.pct === null) return;
    const displayPct = move.pct;
    const displayChange = move.change;

    const rank = representativeRank(symbol, index);
    const weight = preparedWeight(normalizedTile, rank);
    const definition = sectorDefinition(sectorKey);
    const prepared: PreparedTile = {
      ...normalizedTile,
      sectorKey,
      sectorLabel: definition.label,
      rank,
      displayPct,
      displayChange,
      ...weight,
    };
    if (!rowsBySymbol.has(symbol)) {
      rowsBySymbol.set(symbol, prepared);
    }
  }

  heatmap.forEach((tile, index) => {
    addTile(tile, index);
  });

  return [...rowsBySymbol.values()];
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

// 市面熱力圖標準做法（2026-07-14 楊董定案，糾正先前的灰磚佔位方案）：
// 固定代表名單裡缺可驗證行情的幾檔，不留洞、不畫灰塊，而是從「候選序列」
// 遞補等量的其他真公司真行情進來——候選序列＝同一分類池（sectorKey 相同，
// "全部" 則不限分類）裡尚未被選進來、且已通過 sanity gate 的個股，依成交值
// /權重排序遞補（sortByHeatmapPriority 跟固定代表股用同一套排序，遞補股
// 插入後重新排序決定 hero/wide/密磚 slot，語意跟原稿「依成交值優先排序」
// 一致）。遞補股標記 isSupplemental=true，只給這次呼叫的回傳陣列使用，不
// 寫回 prepared 共用物件（同一支股票在別的分頁可能是固定代表）。
function primaryRowsForSector(prepared: PreparedTile[], sectorKey: SectorKey) {
  const bySymbol = new Map(prepared.map((tile) => [tile.symbol, tile] as const));
  const fixedSymbols = representativeSymbolsForSector(sectorKey);
  const fixedRows = fixedSymbols
    .map((symbol) => bySymbol.get(symbol))
    .filter((tile): tile is PreparedTile => Boolean(tile));

  const target = sectorKey === "all" ? MAX_TILES_ALL : MAX_TILES_PER_SECTOR;
  if (fixedRows.length >= target) {
    return fixedRows.sort(sortByHeatmapPriority).slice(0, target);
  }

  const pickedSymbols = new Set(fixedRows.map((tile) => tile.symbol));
  const candidatePool = sectorKey === "all" ? prepared : prepared.filter((tile) => tile.sectorKey === sectorKey);
  const backfill = candidatePool
    .filter((tile) => !pickedSymbols.has(tile.symbol))
    .sort(sortByHeatmapPriority)
    .slice(0, target - fixedRows.length)
    .map((tile) => ({ ...tile, isSupplemental: true }));

  return [...fixedRows, ...backfill].sort(sortByHeatmapPriority).slice(0, target);
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
      availableCount: primaryRows.length,
      target: representativeSymbolsForSector(sector.key).length,
      avgPct,
      // primaryRows 現在只會有真的有行情的公司（固定代表或遞補候選都一樣
      // 是通過 sanity gate 的真報價），hasData 看陣列長度即可。
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
  return options.find((option) => option.key === "all" && option.hasData)?.key
    ?? options.find((option) => option.key === "semiconductor" && option.hasData)?.key
    ?? options.find((option) => option.hasData)?.key
    ?? "all";
}

// ── 原稿磚格視覺（2026-07-14 楊董定案：呈現層照 artifact byte-exact 磚格，
//    資料分組/排序/篩選引擎（prepareTiles/buildOptions/rowsForSector 以上）
//    完全不動）。原稿是固定 CSS Grid repeat(8,1fr)：rank 1 = hero(2x2)，
//    rank 2-8 = wide(2x1)，其餘 = 一般密磚（1x1，由 grid 隱式排版自動填滿），
//    取代先前版本的連續漸層 squarified treemap。 */
type TileVariant = "hero" | "wide" | "";

// 磚型分配精算填滿（2026-07-14 楊董二次糾正：舊版 hero(1)+wide(7)+standard(32)
// 在 8 欄 grid 吃掉 4+14+32=50 格，50/8=6.25 列→第 7 列孤懸只填 2 磚、右側
// 大片空洞。改 hero(1)+wide(5)+standard(N-6) — 40 檔核心觀察池時
// 4+10+34=48 格＝8 欄×6 列整除，grid 永遠無孤行無空洞；產業 tab（15 檔
// 目標）用同一規則算出 23 格/8=3 列（最後一列僅缺 1 格），同樣遠比舊版
// 整齊。）
function tileVariantForRank(index: number): TileVariant {
  if (index === 0) return "hero";
  if (index >= 1 && index <= 5) return "wide";
  return "";
}

// 原稿固定 10 階色階（u1-5 漲／d1-5 跌／z0 平盤），依 |pct| 相對於 3%（既有
// 熱力圖飽和度基準，見 heat-scale「≤-3% / ≥+3%」）切 5 個等距桶：
// 0.6/1.2/1.8/2.4% 為桶界，對應 3% 的 20/40/60/80%。
function pctBucketClass(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "z0";
  const abs = Math.abs(pct);
  if (abs < 0.01) return "z0";
  const sign = pct > 0 ? "u" : "d";
  const level = abs <= 0.6 ? 1 : abs <= 1.2 ? 2 : abs <= 1.8 ? 3 : abs <= 2.4 ? 4 : 5;
  return `${sign}${level}`;
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

function staleDotLabel(sourceState: PreparedTile["sourceState"]) {
  if (sourceState === "twse_eod") return "收盤資料";
  if (sourceState === "cache") return "緩存資料";
  if (sourceState === "no_data") return "暫無資料";
  return null;
}

function TileTooltip({ tile }: { tile: PreparedTile }) {
  const staleLabel = staleDotLabel(tile.sourceState);
  return (
    <span className="tac-heat-tooltip" role="tooltip">
      <strong>{tile.symbol} {tile.name}</strong>
      <span>漲跌幅 {formatPercent(tile.displayPct)}</span>
      {tile.displayChange !== null && <span>漲跌 {formatPrice(tile.displayChange)}</span>}
      <span>收盤 {formatPrice(tile.close ?? tile.price)}</span>
      <span>{tile.weightLabel}</span>
      {tile.date && <span>日期 {tile.date}</span>}
      {staleLabel && <span>來源 {tile.sourceLabel ?? staleLabel}</span>}
    </span>
  );
}

// 原稿磚：離散 CSS Grid 磚（.tile/.tile.hero/.tile.wide），固定 10 階色階，
// 不再是連續 --heat 漸層。缺可驗證行情的代表股不再渲染成灰塊佔位——
// primaryRowsForSector() 已經用候選序列遞補了等量真公司真行情進來，這裡
// 收到的 tile 一律是有效報價（2026-07-14 楊董定案：市面熱力圖標準做法，
// grid 永遠是有行情的真公司，缺誰就遞補誰，不留洞也不畫灰塊）。
function HeatmapTile({ tile, variant }: { tile: PreparedTile; variant: TileVariant }) {
  const isStale = tile.sourceState === "twse_eod" || tile.sourceState === "cache";
  const bucket = pctBucketClass(tile.displayPct);
  const sourceDesc = isStale ? (staleDotLabel(tile.sourceState) ?? "") : "";
  const title = `${tile.symbol} ${tile.name}，漲跌幅 ${formatPercent(tile.displayPct)}，${tile.weightLabel}${sourceDesc ? "，" + sourceDesc : ""}`;

  return (
    <Link
      href={`/companies/${encodeURIComponent(tile.symbol)}`}
      className={`tile ${bucket} ${variant} ${isStale ? "is-stale" : ""}`}
      style={variant === "hero" ? { gridColumn: "span 2", gridRow: "span 2" } : variant === "wide" ? { gridColumn: "span 2" } : undefined}
      aria-label={title}
    >
      {isStale && <span className="tile-stale-dot" aria-hidden="true" />}
      <div className="tl">
        <b>{tile.symbol}</b>
        <span className="nm">{tile.name}</span>
      </div>
      {variant === "hero" && <div className="meta">{tile.weightLabel}</div>}
      <div className="pc">{formatPercent(tile.displayPct)}</div>
      <TileTooltip tile={tile} />
    </Link>
  );
}

/** F3: Compute source breakdown note for footer */
function buildSourceBreakdown(tiles: IndustryHeatmapTile[]) {
  const total = tiles.length;
  if (total === 0) return null;
  const liveCount = tiles.filter((t) => t.sourceState === "live" || (!t.sourceState && t.pct !== null)).length;
  const eodCount = tiles.filter((t) => t.sourceState === "twse_eod").length;
  const cacheCount = tiles.filter((t) => t.sourceState === "cache").length;
  const noDataCount = tiles.filter((t) => t.sourceState === "no_data").length;
  const parts: string[] = [];
  if (liveCount > 0) parts.push(`${Math.round((liveCount / total) * 100)}% 即時`);
  if (eodCount > 0) parts.push(`${Math.round((eodCount / total) * 100)}% 收盤`);
  if (cacheCount > 0) parts.push(`${Math.round((cacheCount / total) * 100)}% 緩存`);
  if (noDataCount > 0) parts.push(`${noDataCount} 檔暫無資料`);
  return parts.length > 1 ? parts.join(" · ") : null;
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
  const selectedAvg = activeOption?.avgPct ?? null;
  const availableRows = selectedRows.length;
  const hasEnoughForProduct = availableRows >= MIN_PRODUCT_COUNT;
  const representativeTarget = representativeSymbolsForSector(activeKey).length;
  // 缺角遞補揭露（2026-07-14 楊董定案）：固定代表股缺可驗證行情時改遞補
  // 其他真公司真行情，不再是「缺 N 檔」的負面措辭，而是誠實標示「核心＋
  // 遞補」的組成，讓操作員知道這是真公司只是不在原本固定代表名單內。
  const backfillCount = selectedRows.filter((tile) => tile.isSupplemental).length;
  const coreCount = availableRows - backfillCount;
  const missingRepresentativeNote = backfillCount > 0
    ? `${availableRows} 檔代表池 · ${coreCount} 核心＋${backfillCount} 遞補`
    : null;
  const sourceBreakdown = useMemo(() => buildSourceBreakdown(selectedRows), [selectedRows]);

  // F3: Only show true empty state when backend sends 0 tiles AND state is bad
  const hasTilesFromBackend = heatmap.length > 0;
  const emptyReason = marketState === "BLOCKED"
    ? (reason ?? "市場資料目前無法更新。")
    : hasTilesFromBackend
      ? "此產業代表股目前沒有可驗證行情，未渲染空白灰塊。"
      : "此產業目前沒有足夠正式行情，先不顯示熱力圖。";

  function handleSectorChange(nextKey: SectorKey) {
    if (nextKey === activeKey) return;
    setSwitching(true);
    setActiveKey(nextKey);
    updateSectorQuery(nextKey);
    window.setTimeout(() => setSwitching(false), 180);
  }

  return (
    <div className={`tac-industry-heatmap ${switching ? "is-switching" : ""}`}>
      <div className="heat-toolbar">
        <div className="tab dim">產業熱力圖 <span className="en">CORE POOL</span></div>
        <div className="heat-stats" aria-label="熱力圖摘要">
          <span>更新 <b>{formatDateTime(updatedAt)}</b></span>
          <span><b>{representativeTarget}</b> 檔代表池</span>
          <span><b>{availableRows}</b> 檔有行情</span>
          <span>均幅 <b className={toneForMove(selectedAvg)}>{formatPercent(selectedAvg)}</b></span>
        </div>
      </div>

      <div className="heat-kicker">
        <span>面積代表權重，顏色代表漲跌幅</span>
        <strong>{activeOption?.description ?? "依產業查看代表股表現"}</strong>
      </div>

      <div className="heat-chips" aria-label="選擇熱力圖產業">
        {options.map((option) => (
          <button
            type="button"
            className={`${option.key === activeKey ? "is-active" : ""} ${option.hasData ? "" : "is-muted"}`}
            aria-pressed={option.key === activeKey}
            aria-label={option.label}
            title={option.label}
            onClick={() => handleSectorChange(option.key)}
            key={option.key}
          >
            {/* 側欄常駐後 heatzone 實際可用寬度遠窄於原稿 mock（見
                globals.css .home-ledger-shell 註解），8 個產業 chip 用全名
                在窄欄下會裹成 4-5 行、把磚格擠成扁條——shortLabel 欄位本來
                就是為這個場景準備、先前未接上，這裡改用縮寫，chip 列縮到
                1-2 行還給 heatmapgrid 高度（楊董 2026-07-14 二次糾正）。 */}
            <b>{option.shortLabel}</b>
            <span>{formatSectorChipCount(option.availableCount, option.target)}</span>
          </button>
        ))}
      </div>

      {selectedRows.length > 0 ? (
        <div className="heatmapgrid">
          {selectedRows.map((tile, index) => (
            <HeatmapTile tile={tile} variant={tileVariantForRank(index)} key={tile.symbol} />
          ))}
        </div>
      ) : (
        <div className="tac-heat-empty" role="status">
          <span>{activeOption?.label ?? "產業"} · 公開資料更新中</span>
          <strong>{emptyReason}</strong>
          <small>{sourceLabel} · 資料約 5-15 秒延遲</small>
        </div>
      )}

      <div className="heat-footer">
        <span className="lead">
          {hasEnoughForProduct ? "固定代表股池完成" : "代表池不足，僅顯示可驗證資料"} · 依成交值優先排序 · {sourceLabel}
          {missingRepresentativeNote && <> · {missingRepresentativeNote}</>}
          {sourceBreakdown && <> · {sourceBreakdown}</>}
        </span>
        <span className="heat-scale" aria-label="漲跌幅色階">
          <em>≤ -3%</em>
          <span className="sw"><i className="d5" /><i className="d3" /><i className="d1" /><i className="z0" /><i className="u1" /><i className="u3" /><i className="u5" /></span>
          <em>≥ +3%</em>
        </span>
      </div>
    </div>
  );
}
