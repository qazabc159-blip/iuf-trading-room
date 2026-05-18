#!/usr/bin/env python3
"""
Patch server.ts to add v3 AI recommendation routes after the v2 status route.
Insert after line containing 'TW-COVERAGE ENDPOINTS' comment block start.
"""
import re

SERVER_PATH = "apps/api/src/server.ts"

with open(SERVER_PATH, "r", encoding="utf-8") as f:
    content = f.read()

# Check if v3 routes already patched
if "ai-recommendations/v3" in content:
    print("SKIP: v3 routes already present in server.ts")
    exit(0)

# Find insertion point: right before the TW-COVERAGE ENDPOINTS section
ANCHOR = "// =============================================================================\n// TW-COVERAGE ENDPOINTS"

V3_ROUTES = r"""// =============================================================================
// AI RECOMMENDATION v3 ENDPOINTS — Yang SOP 5-module / 7 sub-score
// Lane: strategy backend (Jason). Files: ai-recommendation-v2/orchestrator-v3.ts
// Auth: public GET (same as v2); POST admin-only Owner
// Endpoint naming: /api/v1/ai-recommendations/v3  (parallel, v2 untouched)
// =============================================================================

let _aiRecV3CronRunning = false;
let _aiRecV3CronLastFiredAt: string | null = null;
let _aiRecV3CronLastError: string | null = null;

// GET /api/v1/ai-recommendations/v3
app.get("/api/v1/ai-recommendations/v3", async (c) => {
  const { getLatestAiRecommendationV3Run } = await import("./ai-recommendation-v2/orchestrator-v3.js");
  const latest = getLatestAiRecommendationV3Run();
  if (!latest) {
    return c.json({ ok: false, error: "no_v3_run_yet", hint: "POST /api/v1/admin/ai-recommendations/v3/refresh to trigger" }, 404);
  }
  return c.json({
    ok: true,
    runId: latest.runId,
    status: latest.status,
    generatedAt: latest.generatedAt,
    items: latest.items,
    marketState: latest.marketState,
    marketRiskOffScore: latest.marketRiskOffScore,
    totalCostUsd: latest.totalCostUsd,
    totalTokens: latest.totalTokens,
    itemCount: latest.items.length,
  });
});

// POST /api/v1/admin/ai-recommendations/v3/refresh  — manual trigger (Owner only)
app.post("/api/v1/admin/ai-recommendations/v3/refresh", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  if (_aiRecV3CronRunning) {
    return c.json({ ok: false, error: "already_running" }, 429);
  }

  const trigger = "manual_refresh" as const;
  const runId = crypto.randomUUID();
  _aiRecV3CronRunning = true;
  _aiRecV3CronLastFiredAt = new Date().toISOString();

  void (async () => {
    try {
      const { runAiRecommendationV3 } = await import("./ai-recommendation-v2/orchestrator-v3.js");
      await runAiRecommendationV3({ trigger, maxRounds: 10, costCapUsd: 2.0, runId, workspaceId: session.workspace?.id ?? null });
      _aiRecV3CronLastError = null;
    } catch (err) {
      _aiRecV3CronLastError = err instanceof Error ? err.message : String(err);
      console.error("[ai-rec-v3] refresh error:", _aiRecV3CronLastError);
    } finally {
      _aiRecV3CronRunning = false;
    }
  })();

  return c.json({ ok: true, runId, trigger, queuedAt: new Date().toISOString() });
});

// GET /api/v1/admin/ai-recommendations/v3/status
app.get("/api/v1/admin/ai-recommendations/v3/status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const { getLatestAiRecommendationV3Run } = await import("./ai-recommendation-v2/orchestrator-v3.js");
  const latest = getLatestAiRecommendationV3Run();
  return c.json({
    cron_running: _aiRecV3CronRunning,
    cron_last_fired_at: _aiRecV3CronLastFiredAt,
    cron_last_error: _aiRecV3CronLastError,
    latest_run_id: latest?.runId ?? null,
    latest_status: latest?.status ?? null,
    latest_item_count: latest?.items.length ?? 0,
    latest_cost_usd: latest?.totalCostUsd ?? 0,
    latest_market_state: latest?.marketState ?? null,
    latest_risk_off_score: latest?.marketRiskOffScore ?? null,
  });
});

"""

if ANCHOR not in content:
    print(f"ERROR: anchor not found in server.ts")
    exit(1)

patched = content.replace(ANCHOR, V3_ROUTES + ANCHOR)

with open(SERVER_PATH, "w", encoding="utf-8") as f:
    f.write(patched)

print(f"PATCHED: inserted v3 routes ({len(V3_ROUTES)} chars) before TW-COVERAGE section")
