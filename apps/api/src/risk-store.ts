import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { KillSwitchState, RiskLimit, StrategyRiskLimit, SymbolRiskLimit } from "@iuf-trading-room/contracts";

export type RiskStoreState = {
  limits: Record<string, RiskLimit>;
  killSwitch: Record<string, KillSwitchState>;
  strategyLimits: Record<string, StrategyRiskLimit>;
  symbolLimits: Record<string, SymbolRiskLimit>;
};

function getRiskStoreDir(): string {
  const base =
    process.env.RAILWAY_VOLUME_MOUNT_PATH ??
    process.env.IUF_RISK_STORE_BASE_PATH ??
    (process.env.CI === "true" || process.env.NODE_ENV === "test"
      ? path.join(process.cwd(), ".tmp", "risk-store")
      : "/data");
  return path.join(base, "risk");
}

function getRiskStoreFile(workspace: string): string {
  const safe = workspace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getRiskStoreDir(), `${safe}.risk.json`);
}

export function emptyRiskStoreState(): RiskStoreState {
  return { limits: {}, killSwitch: {}, strategyLimits: {}, symbolLimits: {} };
}

export async function loadRiskStore(workspace: string): Promise<RiskStoreState> {
  const file = getRiskStoreFile(workspace);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as RiskStoreState;
    return {
      limits: parsed.limits ?? {},
      killSwitch: parsed.killSwitch ?? {},
      strategyLimits: parsed.strategyLimits ?? {},
      symbolLimits: parsed.symbolLimits ?? {}
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyRiskStoreState();
    }
    // JSON parse failure or unexpected IO error — rename corrupted file and fail-open
    console.error("[risk-store] Failed to load risk store, starting empty:", error);
    try {
      await rename(file, `${file}.bak`);
    } catch {
      // best-effort backup rename; ignore failure
    }
    return emptyRiskStoreState();
  }
}

export async function saveRiskStore(workspace: string, state: RiskStoreState): Promise<void> {
  const file = getRiskStoreFile(workspace);
  const tmp = `${file}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, file);
  } catch (error) {
    console.error("[risk-store] Failed to save risk store (in-memory state still valid):", error);
    // fail-open: do not rethrow — HTTP response must not be blocked by IO failure
  }
}
