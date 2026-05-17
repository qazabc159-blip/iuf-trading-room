/**
 * openalice-brief-sanitizer.ts -- Write-time sanitizer for daily brief body text.
 *
 * Extracted from openalice-pipeline.ts (PR #471) into a standalone module so that
 * content-draft-store.ts can import it at write-time without creating a circular
 * dependency (pipeline -> content-draft-store -> pipeline).
 *
 * Root cause of 5/15-5/17 FFFD regression (Bruce P1 audit 2026-05-17):
 *   - PR #471 applied sanitizeBriefBody only in parseDirectBriefPayload (direct/cron path).
 *   - OpenAlice device-submitted briefs (device -> submitOpenAliceResult -> createContentDraft
 *     -> approveContentDraft) bypassed the sanitizer entirely.
 *   - Fix: apply at write-time in approveContentDraft for ALL paths.
 *
 * Hard lines:
 *   - NEVER change sanitizer logic (stable since PR #471).
 *   - Only expand coverage -- do NOT narrow what is scrubbed.
 *   - Do NOT add new scrub patterns without a unit test per pattern.
 */

// P0-1: Encoding scrubber

/**
 * Strip U+FFFD replacement characters (and consecutive runs) from brief body text.
 * These arise when CP950/Big5-encoded source text is piped into a UTF-8 prompt without
 * proper translit -- LLM echoes the replacement chars verbatim into the output.
 * After stripping, collapse double-spaces left behind and trim.
 *
 * Implementation mirrors openalice-pipeline.ts scrubReplacementChars (same logic).
 */
export function scrubReplacementChars(text: string): string {
  // Remove runs of replacement chars, optionally surrounded by spaces
  return text.replace(/[�]+/g, "").replace(/\s{2,}/g, " ").trim();
}

// P0-2: Template residue scrubber

/**
 * Forbidden phrases that must never appear in user-visible brief output.
 * These are LLM prompt template instructions that occasionally leak into the final text.
 * Ordered from most-specific (full sentence) to least-specific (substring) to maximise
 * surgical removal without over-stripping adjacent content.
 *
 * Implementation mirrors openalice-pipeline.ts FORBIDDEN_BRIEF_PHRASES (same list).
 */
export const FORBIDDEN_BRIEF_PHRASES: ReadonlyArray<string | RegExp> = [
  // Exact strings (full sentences or clauses)
  "此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向。",
  "此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向",
  "供人員審閱後再決定後續分析方向",
  "內部研究草稿",
  "供人員審閱",
  "後續分析方向",
  /Generated:\s*\d{4}-\d{2}-\d{2}\s*\(rule-template fallback\)/,
  /\(rule-template fallback\)/,
  "internal research draft",
  "for internal review",
  "TODO:",
  "FIXME:",
  "placeholder",
];

/**
 * Scrub forbidden internal-template phrases from a brief body string.
 * For each forbidden phrase: remove the phrase and trim surrounding whitespace.
 */
export function scrubForbiddenPhrases(text: string): string {
  let result = text;
  for (const phrase of FORBIDDEN_BRIEF_PHRASES) {
    if (typeof phrase === "string") {
      result = result.split(phrase).join("").replace(/\s{2,}/g, " ").trim();
    } else {
      result = result
        .replace(
          new RegExp(phrase.source, phrase.flags.includes("g") ? phrase.flags : phrase.flags + "g")
        , "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }
  return result;
}

/**
 * Apply both encoding scrub and template-residue scrub to a brief body.
 * Use this on every LLM-generated section body before it reaches the publish gate.
 *
 * NOTE: openalice-pipeline.ts has its own copy of this logic (not imported from here).
 * This file exists to allow content-draft-store.ts to import without circular dependency.
 */
export function sanitizeBriefBody(text: string): string {
  return scrubForbiddenPhrases(scrubReplacementChars(text));
}
