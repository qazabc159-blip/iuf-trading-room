import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  marketSchema,
  quoteSourceSchema
} from "@iuf-trading-room/contracts";
import { z } from "zod";

const persistedQuoteEntrySchema = z.object({
  symbol: z.string().min(1),
  market: marketSchema,
  source: quoteSourceSchema,
  last: z.number().nullable(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  prevClose: z.number().nullable(),
  volume: z.number().nonnegative().nullable(),
  changePct: z.number().nullable(),
  timestamp: z.string(),
  updatedAt: z.string().optional()
});

export type PersistedQuoteEntry = z.infer<typeof persistedQuoteEntrySchema>;

function getMarketDataStoreDir() {
  return process.env.MARKET_DATA_STORE_DIR
    ? path.resolve(process.env.MARKET_DATA_STORE_DIR)
    : path.resolve(process.cwd(), "runtime-data", "market-data");
}

function sanitizeWorkspaceSlug(workspaceSlug: string) {
  return workspaceSlug.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getWorkspaceHistoryFile(workspaceSlug: string) {
  return path.join(getMarketDataStoreDir(), `${sanitizeWorkspaceSlug(workspaceSlug)}.quotes.jsonl`);
}

export async function loadPersistedQuoteEntries(workspaceSlug: string) {
  try {
    const raw = await readFile(getWorkspaceHistoryFile(workspaceSlug), "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [persistedQuoteEntrySchema.parse(JSON.parse(line))];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function appendPersistedQuoteEntries(
  workspaceSlug: string,
  entries: PersistedQuoteEntry[]
) {
  if (entries.length === 0) {
    return;
  }

  const file = getWorkspaceHistoryFile(workspaceSlug);
  await mkdir(path.dirname(file), { recursive: true });
  const payload = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await appendFile(file, payload, "utf8");
}

export async function resetPersistedQuoteEntries(workspaceSlug: string) {
  await rm(getWorkspaceHistoryFile(workspaceSlug), { force: true });
}
