#!/usr/bin/env python3
"""
Inserts AI Recommendation v2 routes block into server.ts,
right after the v1 recommendations block ends (after POST /recommendations/:id/feedback).
"""

import sys

path = "C:/Users/User/Desktop/小楊機密/交易/IUF_TRADING_ROOM_APP/apps/api/src/server.ts"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Insertion marker: the blank line + TW-COVERAGE comment
MARKER = """// =============================================================================
// TW-COVERAGE ENDPOINTS (PR #478 follow-up — 2026-05-15)"""

if "AI-RECOMMENDATIONS-V2" in content:
    print("AI-RECOMMENDATIONS-V2 block already present — skipping.")
    sys.exit(0)

if MARKER not in content:
    print(f"ERROR: Marker not found in server.ts", file=sys.stderr)
    sys.exit(1)

AI_REC_BLOCK = """// =============================================================================
// AI-RECOMMENDATIONS-V2 — Pure-AI independent market judgment (2026-05-18)
// No Athena fixture dependency. Brain ReAct loop sees full market data.
// GET  /api/v1/ai-recommendations        → latest AiRecommendationV2Run
// POST /api/v1/admin/ai-recommendations/refresh → manual trigger
// Cron: 09:30 + 13:00 TST weekdays (startSchedulers integration)
// Auth: Owner-only Phase A.
// Lane: strategy backend (Jason). Files: ai-recommendation-v2/orchestrator.ts
// =============================================================================

// Module-level cron state — identical pattern to MARKET-OVERVIEW-CRON
let _aiRecV2CronLastFiredAt: string | null = null;
let _aiRecV2CronLastError: string | null = null;
let _aiRecV2CronRunning = false;

function isAiRecV2CronWindow(): boolean {
  // 09:20-13:40 TST weekdays (give 10min buffer before/after 09:30 and 13:00)
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = now.getUTCDay(); // 0=Sun 6=Sat
  if (day === 0 || day === 6) return false;
  const hhmm = now.getUTCHours() * 100 + now.getUTCMinutes();
  return hhmm >= 920 && hhmm <= 1340;
}

// GET /api/v1/ai-recommendations
app.get("/api/v1/ai-recommendations", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const { getLatestAiRecommendationRun } = await import("./ai-recommendation-v2/orchestrator.js");
  const latest = getLatestAiRecommendationRun();

  if (!latest) {
    return c.json({
      status: "no_data",
      message: "AI 推薦尚未生成，請在盤中觸發 refresh 或等待 09:30 cron",
      generatedAt: null,
      items: [],
      reactTrace: [],
      finalReportMarkdown: null,
      totalCostUsd: 0,
    });
  }

  return c.json({
    runId: latest.runId,
    status: latest.status,
    generatedAt: latest.generatedAt,
    items: latest.items,
    reactTrace: latest.reactTrace,
    finalReportMarkdown: latest.finalReportMarkdown,
    totalCostUsd: latest.totalCostUsd,
    totalTokens: latest.totalTokens,
  });
});

// POST /api/v1/admin/ai-recommendations/refresh  — manual trigger
app.post("/api/v1/admin/ai-recommendations/refresh", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  if (_aiRecV2CronRunning) {
    return c.json({ ok: false, message: "run_in_progress" }, 409);
  }

  const runId = crypto.randomUUID();
  const workspaceId = session.workspace?.id ?? null;

  // Fire-and-forget in background
  void (async () => {
    _aiRecV2CronRunning = true;
    try {
      const { runAiRecommendationV2 } = await import("./ai-recommendation-v2/orchestrator.js");
      await runAiRecommendationV2({
        workspaceId,
        trigger: "manual_refresh",
        runId,
        maxRounds: 8,
        costCapUsd: 1.5,
      });
      _aiRecV2CronLastFiredAt = new Date().toISOString();
      _aiRecV2CronLastError = null;
    } catch (err) {
      _aiRecV2CronLastError = err instanceof Error ? err.message : String(err);
      console.error("[ai-rec-v2/refresh] error:", _aiRecV2CronLastError);
    } finally {
      _aiRecV2CronRunning = false;
    }
  })();

  return c.json({ ok: true, runId, trigger: "manual_refresh", queuedAt: new Date().toISOString() });
});

// GET /api/v1/admin/ai-recommendations/status  — cron status for Bruce
app.get("/api/v1/admin/ai-recommendations/status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const { getLatestAiRecommendationRun } = await import("./ai-recommendation-v2/orchestrator.js");
  const latest = getLatestAiRecommendationRun();

  return c.json({
    cron_last_fired_at: _aiRecV2CronLastFiredAt,
    cron_last_error: _aiRecV2CronLastError,
    cron_running: _aiRecV2CronRunning,
    cron_window_open: isAiRecV2CronWindow(),
    latest_run_id: latest?.runId ?? null,
    latest_status: latest?.status ?? null,
    latest_item_count: latest?.items.length ?? 0,
    latest_cost_usd: latest?.totalCostUsd ?? 0,
  });
});

"""

content = content.replace(MARKER, AI_REC_BLOCK + MARKER)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

# Verify
with open(path, "r", encoding="utf-8") as f:
    updated = f.read()

print("AI-RECOMMENDATIONS-V2 inserted:", "AI-RECOMMENDATIONS-V2" in updated)
print("GET /api/v1/ai-recommendations route:", '"/api/v1/ai-recommendations"' in updated)
print("POST /api/v1/admin/ai-recommendations/refresh:", '"/api/v1/admin/ai-recommendations/refresh"' in updated)
