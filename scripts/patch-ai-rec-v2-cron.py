#!/usr/bin/env python3
"""
Inserts AI-REC-V2-CRON block into startSchedulers() in server.ts,
right before the final console.log.
Also updates the console.log to include AI-REC-V2-CRON.
"""

import sys

path = "C:/Users/User/Desktop/小楊機密/交易/IUF_TRADING_ROOM_APP/apps/api/src/server.ts"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

if "AI-REC-V2-CRON" in content:
    print("AI-REC-V2-CRON already present — skipping.")
    sys.exit(0)

# Marker: the final console.log in startSchedulers
OLD_LOG = '    "MARKET-OVERVIEW-CRON (5min cache pre-warm, fires 09:00-13:35 TST weekdays) started"\n  );'

if OLD_LOG not in content:
    print("ERROR: log marker not found", file=sys.stderr)
    sys.exit(1)

AI_REC_CRON_BLOCK = """
  // AI-REC-V2-CRON: Fire Brain ReAct AI recommendation at 09:30 and 13:00 TST weekdays.
  // Pattern: 5min poll, window-guarded. State stored in module-level _aiRecV2Cron* vars.
  // Boot fire at 60s (allows server to fully warm before first LLM call).
  {
    const AI_REC_V2_CRON_INTERVAL_MS = 5 * 60 * 1000;
    let _aiRecV2LastCronFireHhmm: number | null = null;

    ui(async () => {
      if (!isAiRecV2CronWindow()) return;
      if (_aiRecV2CronRunning) return; // already running from manual trigger or prev tick

      const hhmm = getTaipeiHHMM();
      // Fire at 09:30 (930) and 13:00 (1300) — only once per window (guard by fired hhmm bucket)
      const firedWindow = hhmm < 1000 ? 930 : 1300;
      if (_aiRecV2LastCronFireHhmm === firedWindow) return;

      // Check if we're in a fire window: 930-935 or 1300-1305
      const inFireWindow = (hhmm >= 930 && hhmm <= 935) || (hhmm >= 1300 && hhmm <= 1305);
      if (!inFireWindow) return;

      _aiRecV2LastCronFireHhmm = firedWindow;
      _aiRecV2CronRunning = true;
      const trigger = hhmm < 1000 ? "cron_0930" : "cron_1300";
      try {
        const { runAiRecommendationV2 } = await import("./ai-recommendation-v2/orchestrator.js");
        await runAiRecommendationV2({ trigger: trigger as import("./ai-recommendation-v2/orchestrator.js").AiRecTrigger, maxRounds: 8, costCapUsd: 1.5 });
        _aiRecV2CronLastFiredAt = new Date().toISOString();
        _aiRecV2CronLastError = null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        _aiRecV2CronLastError = msg;
        console.warn("[ai-rec-v2-cron] tick failed:", msg);
      } finally {
        _aiRecV2CronRunning = false;
      }
    }, AI_REC_V2_CRON_INTERVAL_MS);
  }

"""

NEW_LOG = '    "MARKET-OVERVIEW-CRON (5min cache pre-warm, fires 09:00-13:35 TST weekdays) + " +\n    "AI-REC-V2-CRON (5min poll, fires 09:30+13:00 TST weekdays) started"\n  );'

content = content.replace(OLD_LOG, AI_REC_CRON_BLOCK + "  " + NEW_LOG)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

# Verify
with open(path, "r", encoding="utf-8") as f:
    updated = f.read()

print("AI-REC-V2-CRON in startSchedulers:", "AI-REC-V2-CRON" in updated)
print("cron_0930 trigger:", "cron_0930" in updated)
