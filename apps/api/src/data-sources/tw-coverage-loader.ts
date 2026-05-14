/**
 * tw-coverage-loader.ts — My-TW-Coverage integration
 *
 * Reads 1,735 ticker markdown files from the My-TW-Coverage repo and parses
 * them into structured data for IUF consumers (OpenAlice briefing, strategy
 * engine supply-chain context, etc.).
 *
 * Strategy: (A) on-demand file read with in-process LRU cache (30-entry, 5-min TTL).
 * Files are small (~5–20 KB each); cold read is negligible.
 *
 * Path resolution (in priority order):
 *   1. process.env.TW_COVERAGE_PATH  — operator override
 *   2. apps/api/data/tw-coverage/    — bundled copy (deployed to Railway via sync script)
 *   3. ../../My-TW-Coverage/Pilot_Reports  — local dev fallback (relative to this file)
 *
 * Hard lines:
 *   - Read-only. Never write to My-TW-Coverage.
 *   - Missing file → return null (graceful degrade). Never throw to callers.
 *   - No DB writes. No secrets. No network.
 *   - MIT licence — safe to bundle and ship.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupplyChainGroup {
  category: string;
  companies: string[];
}

export interface CompanyCoverageBrief {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: string;      // e.g. "47845508 百萬台幣"
  enterpriseValue: string; // e.g. "45886629 百萬台幣" or "N/A 百萬台幣"
  businessOverview: string; // Traditional Chinese paragraph
  supplyChain: {
    upstream: SupplyChainGroup[];
    midstream: SupplyChainGroup[];
    downstream: SupplyChainGroup[];
  };
  majorCustomers: string[];
  majorSuppliers: string[];
  rawMarkdown: string;
}

export interface WikilinkMatch {
  ticker: string;
  companyName: string;
  sector: string;
  relation: "customer" | "supplier" | "upstream" | "downstream" | "related";
}

export interface WikilinkSearchResult {
  token: string;
  matches: WikilinkMatch[];
}

export interface SectorCompany {
  ticker: string;
  companyName: string;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveCoveragePath(): string {
  if (process.env.TW_COVERAGE_PATH) {
    return process.env.TW_COVERAGE_PATH;
  }
  // Bundled path: apps/api/data/tw-coverage (ships to Railway)
  const bundled = path.resolve(__dirname, "../../data/tw-coverage");
  // Local-dev fallback: sibling repo
  const localDev = path.resolve(__dirname, "../../../../../My-TW-Coverage/Pilot_Reports");
  // We return bundled by default; callers fall back on readdir failure.
  return bundled;
}

function localDevFallback(): string {
  // From apps/api/src/data-sources/, go up to repo root then sibling My-TW-Coverage
  // Structure: {交易}/IUF_TRADING_ROOM_APP/apps/api/src/data-sources/ → {交易}/My-TW-Coverage/Pilot_Reports
  return path.resolve(__dirname, "../../../../../My-TW-Coverage/Pilot_Reports");
}

// ---------------------------------------------------------------------------
// Simple in-process LRU cache (30 slots, 5-min TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: CompanyCoverageBrief;
  expires: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 30;
const _briefCache = new Map<string, CacheEntry>();

function cacheGet(ticker: string): CompanyCoverageBrief | undefined {
  const entry = _briefCache.get(ticker);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    _briefCache.delete(ticker);
    return undefined;
  }
  return entry.value;
}

function cacheSet(ticker: string, value: CompanyCoverageBrief): void {
  if (_briefCache.size >= CACHE_MAX) {
    // Evict oldest entry
    const firstKey = _briefCache.keys().next().value;
    if (firstKey !== undefined) _briefCache.delete(firstKey);
  }
  _briefCache.set(ticker, { value, expires: Date.now() + CACHE_TTL_MS });
}

/** For test isolation only */
export function _resetCoverageCache(): void {
  _briefCache.clear();
}

// ---------------------------------------------------------------------------
// File discovery helpers
// ---------------------------------------------------------------------------

/**
 * Find the md file for a given ticker across all sector folders.
 * Returns [filePath, sector] or null.
 */
async function findTickerFile(
  ticker: string,
  rootPath: string
): Promise<{ filePath: string; sector: string } | null> {
  let sectors: string[];
  try {
    sectors = await readdir(rootPath);
  } catch {
    return null;
  }

  for (const sector of sectors) {
    const sectorPath = path.join(rootPath, sector);
    let files: string[];
    try {
      files = await readdir(sectorPath);
    } catch {
      continue;
    }
    const match = files.find((f) => f.startsWith(`${ticker}_`) && f.endsWith(".md"));
    if (match) {
      return { filePath: path.join(sectorPath, match), sector };
    }
  }
  return null;
}

async function readTickerMarkdown(ticker: string): Promise<{ md: string; sector: string } | null> {
  const primaryRoot = resolveCoveragePath();
  const fallbackRoot = localDevFallback();

  for (const root of [primaryRoot, fallbackRoot]) {
    const found = await findTickerFile(ticker, root);
    if (found) {
      try {
        const md = await readFile(found.filePath, "utf-8");
        return { md, sector: found.sector };
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Markdown parser
// ---------------------------------------------------------------------------

/** Extract all wikilink tokens [[...]] from a text block */
function extractWikilinks(text: string): string[] {
  const results: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].trim();
    if (token) results.push(token);
  }
  return [...new Set(results)];
}

/** Strip wikilink brackets: [[Foo]] → Foo */
function stripWikilinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, "$1");
}

/** Extract metadata field value: **板塊:** Semiconductors → "Semiconductors" */
function extractMeta(md: string, field: string): string {
  const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`);
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

/** Extract company name from title line: # 2330 - [[台積電]] → 台積電 */
function extractCompanyName(md: string): string {
  const m = md.match(/^#\s+\d+\s+-\s+\[\[([^\]]+)\]\]/m);
  return m ? m[1].trim() : "";
}

/**
 * Parse a supply chain section block (上游/中游/下游) into groups.
 * Each group: a bold header line followed by bullet content.
 */
function parseSupplyChainBlock(block: string): SupplyChainGroup[] {
  if (!block.trim()) return [];

  const groups: SupplyChainGroup[] = [];
  // Split on bold category headers like "**設備:**" or "- **晶圓代工:**"
  const lines = block.split("\n");
  let currentCategory = "";
  let currentCompanies: string[] = [];

  const flushGroup = () => {
    if (currentCategory && currentCompanies.length > 0) {
      groups.push({ category: currentCategory, companies: currentCompanies });
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("**上游") || trimmed.startsWith("**中游") || trimmed.startsWith("**下游")) {
      continue;
    }
    // Bold category header within section: "- **設備:**" or "**主要平台:**"
    const catMatch = trimmed.match(/^-?\s*\*\*([^*]+):\*\*(.*)$/);
    if (catMatch) {
      flushGroup();
      currentCategory = catMatch[1].trim();
      currentCompanies = [];
      // Inline companies on same line after the colon
      const inline = catMatch[2].trim();
      if (inline) {
        const names = extractNamesFromLine(inline);
        currentCompanies.push(...names);
      }
    } else if (trimmed.startsWith("-") && currentCategory) {
      // Bullet item under current category
      const content = trimmed.replace(/^-\s*/, "");
      const names = extractNamesFromLine(content);
      currentCompanies.push(...names);
    }
  }
  flushGroup();
  return groups;
}

/**
 * Extract company/entity names from a line.
 * Prefers wikilinked names; falls back to plain text comma-separated tokens.
 */
function extractNamesFromLine(line: string): string[] {
  const wikiNames = extractWikilinks(line);
  if (wikiNames.length > 0) return wikiNames;
  // Fallback: strip markdown formatting and split on comma/semicolon
  const plain = line
    .replace(/\*\*/g, "")
    .replace(/\[.*?\]/g, "")
    .split(/[,;、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 60);
  return plain;
}

/** Extract a named section from the markdown */
function extractSection(md: string, sectionHeader: string): string {
  // Lookahead anchored to start-of-line to avoid matching inside ### sub-headings.
  // Handles both \r\n (Windows) and \n (Unix) line endings.
  const re = new RegExp(`## ${sectionHeader}([\\s\\S]*?)(?=\\r?\\n## |$)`);
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

/**
 * Parse the business overview paragraph.
 * The 業務簡介 section starts with metadata lines (**板塊:** etc.) followed by the prose.
 */
function parseBusinessOverview(sectionBody: string): string {
  // Skip metadata lines (starting with **板塊:**, **產業:**, **市值:**, **企業價值:**)
  const lines = sectionBody.split("\n");
  const prose: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\*\*(板塊|產業|市值|企業價值):\*\*/.test(trimmed)) continue;
    if (trimmed) prose.push(trimmed);
  }
  // Strip wikilink brackets from the prose for cleaner text
  return prose.join(" ").trim();
}

/**
 * Parse 主要客戶及供應商 section into customer/supplier lists.
 */
function parseCustomersAndSuppliers(
  sectionBody: string
): { customers: string[]; suppliers: string[] } {
  const customerSection = sectionBody.match(/###\s+主要客戶([\s\S]*?)(?=###|$)/)?.[1] ?? "";
  const supplierSection = sectionBody.match(/###\s+主要供應商([\s\S]*?)(?=###|$)/)?.[1] ?? "";

  const extractFromSection = (text: string): string[] => {
    const names: string[] = [];
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("-")) continue;
      const content = trimmed.replace(/^-\s*/, "");
      const found = extractNamesFromLine(content);
      names.push(...found);
    }
    return [...new Set(names)];
  };

  return {
    customers: extractFromSection(customerSection),
    suppliers: extractFromSection(supplierSection),
  };
}

/**
 * Parse the full supply chain section into upstream / midstream / downstream.
 */
function parseSupplyChain(sectionBody: string): {
  upstream: SupplyChainGroup[];
  midstream: SupplyChainGroup[];
  downstream: SupplyChainGroup[];
} {
  // Split into sub-blocks by 上游/中游/下游 headers
  const upstreamMatch = sectionBody.match(/\*\*上游[^*]*\*\*:?([\s\S]*?)(?=\*\*中游|\*\*下游|$)/);
  const midstreamMatch = sectionBody.match(/\*\*中游[^*]*\*\*:?([\s\S]*?)(?=\*\*上游|\*\*下游|$)/);
  const downstreamMatch = sectionBody.match(/\*\*下游[^*]*\*\*:?([\s\S]*?)(?=\*\*上游|\*\*中游|$)/);

  return {
    upstream: upstreamMatch ? parseSupplyChainBlock(upstreamMatch[1]) : [],
    midstream: midstreamMatch ? parseSupplyChainBlock(midstreamMatch[1]) : [],
    downstream: downstreamMatch ? parseSupplyChainBlock(downstreamMatch[1]) : [],
  };
}

/** Full parse of a single md file */
function parseCoverageMarkdown(
  ticker: string,
  sector: string,
  md: string
): CompanyCoverageBrief {
  const companyName = extractCompanyName(md);

  const overviewSection = extractSection(md, "業務簡介");
  const supplyChainSection = extractSection(md, "供應鏈位置");
  const csSection = extractSection(md, "主要客戶及供應商");

  const rawMarketCap = extractMeta(md, "市值");
  const rawEV = extractMeta(md, "企業價值");
  const rawSector = extractMeta(md, "板塊");
  const industry = extractMeta(md, "產業");

  const businessOverview = parseBusinessOverview(overviewSection);
  const supplyChain = parseSupplyChain(supplyChainSection);
  const { customers, suppliers } = parseCustomersAndSuppliers(csSection);

  return {
    ticker,
    companyName: companyName || ticker,
    sector: rawSector || sector,
    industry,
    // rawMarketCap already contains "百萬台幣" from the source md; use as-is.
    marketCap: rawMarketCap || "N/A",
    enterpriseValue: rawEV || "N/A",
    businessOverview,
    supplyChain,
    majorCustomers: customers,
    majorSuppliers: suppliers,
    rawMarkdown: md,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch complete structured coverage brief for a single ticker.
 * Returns null if ticker not found or file unreadable.
 */
export async function getCompanyCoverageBrief(
  ticker: string
): Promise<CompanyCoverageBrief | null> {
  const normalised = ticker.trim();

  const cached = cacheGet(normalised);
  if (cached) return cached;

  const result = await readTickerMarkdown(normalised);
  if (!result) return null;

  const brief = parseCoverageMarkdown(normalised, result.sector, result.md);
  cacheSet(normalised, brief);
  return brief;
}

/**
 * Reverse-search: find all companies that mention a given wikilink token.
 * Searches across all tickers in all sectors.
 * Relation is inferred from which section the token appears in.
 */
export async function findCompaniesByWikilink(
  token: string
): Promise<WikilinkSearchResult> {
  const normalised = token.trim();
  const matches: WikilinkMatch[] = [];

  const primaryRoot = resolveCoveragePath();
  const fallbackRoot = localDevFallback();

  let rootPath = primaryRoot;
  let sectors: string[] | null = null;

  for (const root of [primaryRoot, fallbackRoot]) {
    try {
      sectors = await readdir(root);
      rootPath = root;
      break;
    } catch {
      continue;
    }
  }

  if (!sectors) return { token: normalised, matches: [] };

  for (const sector of sectors) {
    const sectorPath = path.join(rootPath, sector);
    let files: string[];
    try {
      files = await readdir(sectorPath);
    } catch {
      continue;
    }

    const mdFiles = files.filter((f) => f.endsWith(".md"));

    for (const file of mdFiles) {
      const tickerMatch = file.match(/^(\d+)_(.+)\.md$/);
      if (!tickerMatch) continue;
      const fileTicker = tickerMatch[1];
      const fileCompany = tickerMatch[2];

      let md: string;
      try {
        md = await readFile(path.join(sectorPath, file), "utf-8");
      } catch {
        continue;
      }

      // Quick pre-filter: does the token appear in the file at all?
      if (!md.includes(normalised) && !md.includes(`[[${normalised}]]`)) continue;

      // Determine relation based on which section it appears
      const customerSection = extractSection(md, "主要客戶及供應商");
      const supplyChainSection = extractSection(md, "供應鏈位置");

      let relation: WikilinkMatch["relation"] = "related";

      const inCustomerSection = customerSection.includes(normalised);
      const inSupplyChain = supplyChainSection.includes(normalised);

      if (inCustomerSection) {
        const csLower = customerSection.toLowerCase();
        const tokenPos = csLower.indexOf(normalised.toLowerCase());
        const before = csLower.substring(Math.max(0, tokenPos - 300), tokenPos);
        if (before.includes("供應商") || before.includes("supplier")) {
          relation = "supplier";
        } else if (before.includes("客戶") || before.includes("customer")) {
          relation = "customer";
        } else {
          relation = "related";
        }
      } else if (inSupplyChain) {
        const scLower = supplyChainSection.toLowerCase();
        const tokenPos = scLower.indexOf(normalised.toLowerCase());
        const before = scLower.substring(Math.max(0, tokenPos - 200), tokenPos);
        if (before.includes("上游")) {
          relation = "upstream";
        } else if (before.includes("下游")) {
          relation = "downstream";
        } else {
          relation = "related";
        }
      }

      matches.push({
        ticker: fileTicker,
        companyName: stripWikilinks(fileCompany),
        sector,
        relation,
      });
    }
  }

  return { token: normalised, matches };
}

/**
 * List all companies in a given sector folder.
 * Sector name must match exactly the folder name (e.g. "Semiconductors").
 */
export async function listSectorCompanies(sector: string): Promise<SectorCompany[]> {
  const primaryRoot = resolveCoveragePath();
  const fallbackRoot = localDevFallback();

  for (const root of [primaryRoot, fallbackRoot]) {
    const sectorPath = path.join(root, sector);
    let files: string[];
    try {
      files = await readdir(sectorPath);
    } catch {
      continue;
    }

    const results: SectorCompany[] = [];
    for (const file of files) {
      const m = file.match(/^(\d+)_(.+)\.md$/);
      if (!m) continue;
      results.push({ ticker: m[1], companyName: stripWikilinks(m[2]) });
    }
    return results;
  }

  return [];
}
