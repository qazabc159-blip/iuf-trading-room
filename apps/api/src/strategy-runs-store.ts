import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { strategyRunRecordSchema, type StrategyRunRecord } from "@iuf-trading-room/contracts";

function getStrategyRunsStoreDir() {
  return process.env.STRATEGY_RUNS_STORE_DIR
    ? path.resolve(process.env.STRATEGY_RUNS_STORE_DIR)
    : path.resolve(process.cwd(), "runtime-data", "strategy-runs");
}

function sanitizeWorkspaceSlug(workspaceSlug: string) {
  return workspaceSlug.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getWorkspaceRunsFile(workspaceSlug: string) {
  return path.join(getStrategyRunsStoreDir(), `${sanitizeWorkspaceSlug(workspaceSlug)}.runs.jsonl`);
}

export async function loadPersistedStrategyRuns(workspaceSlug: string) {
  try {
    const raw = await readFile(getWorkspaceRunsFile(workspaceSlug), "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [strategyRunRecordSchema.parse(JSON.parse(line))];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function appendPersistedStrategyRun(workspaceSlug: string, run: StrategyRunRecord) {
  const file = getWorkspaceRunsFile(workspaceSlug);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(run)}\n`, "utf8");
}

export async function resetPersistedStrategyRuns(workspaceSlug: string) {
  await rm(getWorkspaceRunsFile(workspaceSlug), { force: true });
}
