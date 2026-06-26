/**
 * openai-quota-guard.ts — Shared daily call quota guard for all OpenAI scenarios.
 *
 * Hard rules:
 *   - Quota resets at midnight UTC.
 *   - Default limit: OPENAI_DAILY_LIMIT env var, fallback 200.
 *   - When quota is exhausted: `checkQuota()` returns false — caller must use fallback.
 *   - No call to OpenAI when OPENAI_API_KEY is absent.
 *   - NEVER throw — returns structured result.
 *
 * Budget estimate (gpt-4o-mini at $0.15/1M tokens):
 *   200 calls × ~800 tokens avg = 160k tokens/day ≈ $0.024/day
 *
 * Brain Phase A note (2026-05-17):
 *   Modules migrated to callLlm() (llm/llm-gateway.ts) bypass this guard and use
 *   DB-backed budget enforcement instead. This file remains for modules not yet migrated.
 */

// ── State ─────────────────────────────────────────────────────────────────────

let _callCount = 0;
let _resetDay = "";   // "YYYY-MM-DD" UTC

function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureReset(): void {
  const today = getTodayUtc();
  if (_resetDay !== today) {
    _callCount = 0;
    _resetDay = today;
  }
}

export function getDailyLimit(): number {
  const env = process.env["OPENAI_DAILY_LIMIT"];
  const parsed = env ? parseInt(env, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
}

/**
 * Returns true if a call is allowed, false if quota is exhausted.
 * Also returns false if OPENAI_API_KEY is not set.
 * Side-effect: increments the counter when returning true.
 */
export function checkAndConsumeQuota(label: string): boolean {
  if (!process.env["OPENAI_API_KEY"]) {
    return false;
  }
  ensureReset();
  const limit = getDailyLimit();
  if (_callCount >= limit) {
    console.warn(`[openai-quota-guard] Daily limit ${limit} reached — label=${label} — using fallback`);
    return false;
  }
  _callCount++;
  return true;
}

/** Peek at current usage without consuming quota. */
export function getQuotaStatus(): { used: number; limit: number; resetDay: string } {
  ensureReset();
  return { used: _callCount, limit: getDailyLimit(), resetDay: _resetDay };
}

/**
 * Refund a quota slot reserved by checkAndConsumeQuota when the call ultimately
 * failed (HTTP error, network, parse, empty content). A failed call costs
 * nothing and must not burn the daily quota — otherwise a provider billing
 * outage's failed retries drain the quota and lock the gateway out for the rest
 * of the UTC day even after the account is topped up (2026-06-26 repro on the
 * sibling llm-gateway path). callOpenAi reserves up-front (burst-safe) and
 * releases on every failure path.
 */
export function releaseQuota(): void {
  ensureReset();
  if (_callCount > 0) _callCount--;
}

/** For tests: reset counter. */
export function _resetQuotaGuard(): void {
  _callCount = 0;
  _resetDay = "";
}

// ── Shared OpenAI HTTP helper ─────────────────────────────────────────────────

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
/** Routine tasks: gpt-4o-mini (fast, cheap). */
export const MODEL_ROUTINE = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
/** Heavy factual tasks: gpt-4.1. */
export const MODEL_FACTUAL = "gpt-4.1";

const DEFAULT_TIMEOUT_MS = 20_000;

export interface OpenAiCallParams {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens: number;
  temperature?: number;
  timeoutMs?: number;
  label: string;
}

/**
 * Shared OpenAI chat completions call with quota guard + error handling.
 * Returns raw content string or null on any failure.
 * NEVER throws.
 */
export async function callOpenAi(params: OpenAiCallParams): Promise<string | null> {
  if (!checkAndConsumeQuota(params.label)) {
    return null;
  }
  const apiKey = process.env["OPENAI_API_KEY"]!;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.max_tokens,
        temperature: params.temperature ?? 0.2
      })
    });
    clearTimeout(timeout);
  } catch (e) {
    clearTimeout(timeout);
    console.warn(`[openai-quota-guard][${params.label}] fetch failed:`, e instanceof Error ? e.message : String(e));
    releaseQuota();
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    console.warn(`[openai-quota-guard][${params.label}] HTTP ${res.status}: ${body.slice(0, 120)}`);
    releaseQuota();
    return null;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    console.warn(`[openai-quota-guard][${params.label}] response not JSON`);
    releaseQuota();
    return null;
  }

  type ChatResp = { choices?: Array<{ message?: { content?: string } }> };
  const content = (data as ChatResp)?.choices?.[0]?.message?.content ?? null;
  if (!content) {
    console.warn(`[openai-quota-guard][${params.label}] empty content`);
    releaseQuota();
    return null;
  }
  return content;
}

/** Strip markdown code fences from AI JSON response. */
export function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}
