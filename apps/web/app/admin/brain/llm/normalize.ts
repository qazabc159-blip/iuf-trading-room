import type { LlmCallEntry, LlmModelEntry, LlmUsageSummary } from "@/lib/api";

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function arrayFromEnvelope<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (isRecord(value) && Array.isArray(value[key])) return value[key] as T[];
  return [];
}

export function normalizeLlmUsage(value: unknown): LlmUsageSummary | null {
  if (!isRecord(value)) return null;

  return {
    from: stringValue(value.from),
    to: stringValue(value.to),
    totalCalls: numberValue(value.totalCalls),
    totalTokens: numberValue(value.totalTokens),
    totalCostUsd: numberValue(value.totalCostUsd),
    byModel: arrayFromEnvelope(value.byModel, "byModel"),
    byModule: arrayFromEnvelope(value.byModule, "byModule"),
    daily: arrayFromEnvelope(value.daily, "daily"),
    disclaimer: stringValue(value.disclaimer, "費用為估計值，實際帳單以供應商後台為準。"),
  };
}

export function normalizeLlmCalls(value: unknown): LlmCallEntry[] {
  return arrayFromEnvelope<LlmCallEntry>(value, "calls");
}

export function normalizeLlmModels(value: unknown): LlmModelEntry[] {
  return arrayFromEnvelope<LlmModelEntry>(value, "models");
}
