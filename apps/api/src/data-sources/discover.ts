/**
 * discover.ts — Buzzword → company 3-layer fallback discovery
 *
 * Ports the logic from My-TW-Coverage/scripts/discover.py to the IUF backend.
 *
 * Layer 1: Exact wikilink match via findCompaniesByWikilink()
 * Layer 2: Fuzzy match — Levenshtein distance + substring against all known wikilinks
 * Layer 3: LLM inference — gpt-4o-mini infers related wikilinks, then exact-matches each
 *
 * Hard lines:
 *   - Read-only. Never writes to coverage files.
 *   - No DB writes. No secrets leaked.
 *   - LLM fallback: max 5 calls/min (in-process rate limit), guarded by openai-quota-guard.
 *   - NEVER throws — returns structured result on all paths.
 */

import {
  findCompaniesByWikilink,
  getAllWikilinks,
} from "./tw-coverage-loader.js";
import {
  callOpenAi,
  MODEL_ROUTINE,
  stripCodeFences,
} from "../openai-quota-guard.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoverMatch {
  ticker: string;
  companyName: string;
  relatedWikilink: string;
  confidence: number;
}

export type MatchStrategy = "exact" | "fuzzy" | "llm_inference" | "no_match";

export interface DiscoverResult {
  buzzword: string;
  matchStrategy: MatchStrategy;
  matches: DiscoverMatch[];
  inferredWikilinks?: string[]; // present when matchStrategy === 'llm_inference'
}

export interface DiscoverOptions {
  fuzzyThreshold?: number; // 0–1, default 0.7
  llmFallback?: boolean;   // default true
}

// ---------------------------------------------------------------------------
// LLM rate limiter — max 5 calls/min (in-process)
// ---------------------------------------------------------------------------

const _llmCallTimestamps: number[] = [];
const LLM_MAX_PER_MIN = 5;

function canCallLlm(): boolean {
  const now = Date.now();
  // Purge entries older than 60s
  while (_llmCallTimestamps.length > 0 && now - _llmCallTimestamps[0]! > 60_000) {
    _llmCallTimestamps.shift();
  }
  return _llmCallTimestamps.length < LLM_MAX_PER_MIN;
}

function recordLlmCall(): void {
  _llmCallTimestamps.push(Date.now());
}

/** For test isolation only */
export function _resetDiscoverLlmRateLimit(): void {
  _llmCallTimestamps.length = 0;
}

// ---------------------------------------------------------------------------
// Levenshtein distance (iterative, O(m×n))
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single array (row rolling)
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,        // deletion
        curr[j - 1]! + 1,    // insertion
        prev[j - 1]! + cost  // substitution
      );
    }
    prev = curr;
  }
  return prev[n]!;
}

/**
 * Similarity score in [0, 1].
 * 1.0 = identical, 0.0 = completely different.
 */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshtein(a, b) / maxLen;
}

// ---------------------------------------------------------------------------
// Fuzzy matching against wikilink index
// ---------------------------------------------------------------------------

interface FuzzyCandidate {
  wikilink: string;
  score: number;
}

function fuzzyMatchWikilinks(
  buzzword: string,
  allWikilinks: string[],
  threshold: number
): FuzzyCandidate[] {
  const bLower = buzzword.toLowerCase();
  const candidates: FuzzyCandidate[] = [];

  for (const wl of allWikilinks) {
    const wlLower = wl.toLowerCase();

    // Substring match gets a high score
    let score: number;
    if (wlLower.includes(bLower) || bLower.includes(wlLower)) {
      // Use overlap ratio
      const overlapLen = Math.min(buzzword.length, wl.length);
      const maxLen = Math.max(buzzword.length, wl.length);
      score = overlapLen / maxLen;
      // Boost perfect sub-string matches
      if (wlLower.includes(bLower) && buzzword.length >= 2) {
        score = Math.max(score, 0.8);
      }
    } else {
      score = similarity(bLower, wlLower);
    }

    if (score >= threshold) {
      candidates.push({ wikilink: wl, score });
    }
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ---------------------------------------------------------------------------
// LLM inference
// ---------------------------------------------------------------------------

async function inferWikilinksByLlm(
  buzzword: string,
  sampleWikilinks: string[]
): Promise<string[] | null> {
  if (!canCallLlm()) {
    console.warn(`[discover] LLM rate limit reached (max ${LLM_MAX_PER_MIN}/min) — skip LLM fallback`);
    return null;
  }

  recordLlmCall();

  // Sample up to 200 wikilinks for the prompt (keep tokens low)
  const sample = sampleWikilinks.slice(0, 200).join("、");

  const prompt = `你是台股產業分析助理。使用者搜尋「${buzzword}」，請從以下台股已知主題標籤（wikilinks）清單中，推論最相關的 3 至 5 個標籤。

已知主題清單（部分）：
${sample}

請只輸出一個 JSON 陣列，包含你推論最相關的標籤，格式如：["散熱模組", "均熱片", "3D VC"]。
不要輸出任何解釋，只輸出 JSON 陣列。`;

  const content = await callOpenAi({
    model: MODEL_ROUTINE,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
    temperature: 0.2,
    label: "discover/llm-inference",
  });

  if (!content) return null;

  try {
    const cleaned = stripCodeFences(content.trim());
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
  } catch {
    console.warn(`[discover] LLM response parse failed: ${content.slice(0, 100)}`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

export async function discoverCompaniesByBuzzword(
  buzzword: string,
  opts?: DiscoverOptions
): Promise<DiscoverResult> {
  const normalised = buzzword.trim();
  const threshold = opts?.fuzzyThreshold ?? 0.7;
  const useLlm = opts?.llmFallback !== false; // default true

  // ── Layer 1: Exact match ──────────────────────────────────────────────────
  const exactResult = await findCompaniesByWikilink(normalised);
  if (exactResult.matches.length > 0) {
    return {
      buzzword: normalised,
      matchStrategy: "exact",
      matches: exactResult.matches.map((m) => ({
        ticker: m.ticker,
        companyName: m.companyName,
        relatedWikilink: normalised,
        confidence: 1.0,
      })),
    };
  }

  // ── Layer 2: Fuzzy match ──────────────────────────────────────────────────
  const allWikilinks = await getAllWikilinks();

  if (allWikilinks.length > 0) {
    const fuzzyHits = fuzzyMatchWikilinks(normalised, allWikilinks, threshold);

    if (fuzzyHits.length > 0) {
      // Try each fuzzy candidate (up to top 5) and collect company matches
      const seen = new Set<string>(); // dedup by ticker
      const matches: DiscoverMatch[] = [];

      for (const hit of fuzzyHits.slice(0, 5)) {
        const result = await findCompaniesByWikilink(hit.wikilink);
        for (const m of result.matches) {
          if (!seen.has(m.ticker)) {
            seen.add(m.ticker);
            matches.push({
              ticker: m.ticker,
              companyName: m.companyName,
              relatedWikilink: hit.wikilink,
              confidence: Math.round(hit.score * 100) / 100,
            });
          }
        }
      }

      if (matches.length > 0) {
        return {
          buzzword: normalised,
          matchStrategy: "fuzzy",
          matches,
        };
      }
    }
  }

  // ── Layer 3: LLM inference ────────────────────────────────────────────────
  if (useLlm) {
    const inferredWikilinks = await inferWikilinksByLlm(normalised, allWikilinks);

    if (inferredWikilinks && inferredWikilinks.length > 0) {
      const seen = new Set<string>();
      const matches: DiscoverMatch[] = [];

      for (const wl of inferredWikilinks) {
        const result = await findCompaniesByWikilink(wl);
        for (const m of result.matches) {
          if (!seen.has(m.ticker)) {
            seen.add(m.ticker);
            matches.push({
              ticker: m.ticker,
              companyName: m.companyName,
              relatedWikilink: wl,
              confidence: 0.6, // LLM inference confidence
            });
          }
        }
      }

      if (matches.length > 0) {
        return {
          buzzword: normalised,
          matchStrategy: "llm_inference",
          matches,
          inferredWikilinks,
        };
      }

      // LLM ran but no matches found via inferred wikilinks
      return {
        buzzword: normalised,
        matchStrategy: "no_match",
        matches: [],
        inferredWikilinks,
      };
    }
  }

  // ── No match ──────────────────────────────────────────────────────────────
  return {
    buzzword: normalised,
    matchStrategy: "no_match",
    matches: [],
  };
}
