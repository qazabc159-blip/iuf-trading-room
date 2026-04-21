# Autopilot Confirm Gate — Frontend Integration Spec
**Date**: 2026-04-21  
**Author**: Jason (backend-strategy)  
**Consumer**: Jim (Wave 3)  
**Status**: FINAL — Jim must not deviate from this spec

---

## 1. What changed (backend summary)

`POST /api/v1/strategy/runs/:id/execute` now enforces a confirm gate when `dryRun: false`:
- Token must be obtained first via `POST /api/v1/strategy/runs/:id/confirm-token`
- Token is single-use, bound to the runId, expires in 60 seconds
- `dryRun: true` is **completely unaffected** — no token required

---

## 2. Recommended 2-Step Flow

```
Step 1:  POST /api/v1/strategy/runs/:id/confirm-token
         → { data: { token: string, expiresAt: string (ISO) } }

Step 2:  POST /api/v1/strategy/runs/:id/execute
         body: { ...existingFields, dryRun: false, confirmToken: token }
```

**Why 2-step, not embed-in-body?**
- Token TTL (60s) gives user explicit "confirm window"
- Backend can verify time-of-issuance independent of client clock
- Prevents accidental replay (UI refresh, double-click)

---

## 3. Contract Reference

```typescript
// From packages/contracts/src/strategy.ts

// Step 1 response shape
autopilotConfirmTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string()  // ISO 8601
})

// Step 2 request body — confirmToken is optional, required for dryRun:false
autopilotExecuteInputSchema = z.object({
  accountId: z.string(),
  sidePolicy: "bullish_long" | "bearish_short" | "direction_match",
  sizeMode: "fixed_pct" | "equal_weight",
  sizePct: number,          // 0.1–10
  symbols?: string[],
  maxOrders: number,        // 1–10
  dryRun: boolean,
  confirmToken?: string     // Required when dryRun: false
})

// Error codes (dryRun:false gate failures → HTTP 400)
autopilotExecuteErrorCodeSchema = enum [
  "confirm_required",       // no token provided
  "confirm_invalid",        // token not found in store
  "confirm_expired",        // token TTL elapsed (60s)
  "confirm_used",           // token already consumed (replay)
  "confirm_run_mismatch"    // token bound to different runId
]
```

---

## 4. Error Code → UI Behavior

| Error Code | Suggested Copy | UI Action |
|---|---|---|
| `confirm_required` | "請先取得確認 Token" | Re-run Step 1 automatically |
| `confirm_invalid` | "Token 不符，請重新取得" | Re-run Step 1, clear stale token |
| `confirm_expired` | "Token 已過期（60s），請重新取得" | Re-run Step 1, clear countdown |
| `confirm_used` | "Token 已使用，請重新取得" | Re-run Step 1, this is a bug if user didn't double-click |
| `confirm_run_mismatch` | "Token 與此 Run 不符，請重新取得" | Re-run Step 1 for current runId |

All gate errors return HTTP 400 with body: `{ error: string, message: string }`.

---

## 5. TypeScript Pseudocode (2-Step Flow)

```typescript
// apps/web/lib/api.ts (Jim's helper — do not auto-generate, follow existing pattern)

async function executeStrategyRunReal(
  runId: string,
  params: Omit<AutopilotExecuteInput, "confirmToken" | "dryRun">
): Promise<AutopilotExecuteResult> {

  // Step 1: Request confirm token
  const tokenRes = await fetch(`/api/v1/strategy/runs/${runId}/confirm-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!tokenRes.ok) throw new Error("Failed to get confirm token");
  const { data: { token, expiresAt } } = await tokenRes.json();

  // Step 2: Execute with token (must complete within 60s of Step 1)
  const execRes = await fetch(`/api/v1/strategy/runs/${runId}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...params, dryRun: false, confirmToken: token })
  });

  if (!execRes.ok) {
    const { error, message } = await execRes.json();
    // Handle gate errors:
    if (["confirm_required","confirm_invalid","confirm_expired","confirm_used","confirm_run_mismatch"].includes(error)) {
      throw new ConfirmGateError(error, message);
    }
    throw new Error(message ?? error);
  }

  const { data } = await execRes.json();
  return data;
}
```

---

## 6. Countdown UX (optional, Jim's call)

The `expiresAt` ISO string from Step 1 allows Jim to show a countdown:

```typescript
const ttlMs = new Date(expiresAt).getTime() - Date.now(); // ~60000
// Show countdown timer in the confirm button
// If user takes > 60s before clicking "Confirm Send" → re-fetch token automatically
```

**Recommendation**: Show a 60s progress bar / countdown after token is fetched. If it hits 0, silently re-fetch a new token before submitting. This prevents `confirm_expired` from surfacing to the user.

---

## 7. State Machine (Jim must implement, not invent)

```
IDLE
  → [User clicks "Real Submit"] → FETCHING_TOKEN
FETCHING_TOKEN
  → [POST /confirm-token success] → TOKEN_READY (start 60s countdown)
  → [POST /confirm-token fails]   → ERROR (show "cannot reach server")
TOKEN_READY
  → [countdown expires] → FETCHING_TOKEN (re-fetch silently)
  → [User clicks "Confirm Send"] → EXECUTING
EXECUTING
  → [POST /execute success]       → SUCCESS (show result)
  → [POST /execute confirm_* err] → FETCHING_TOKEN (re-fetch + retry once)
  → [POST /execute other err]     → ERROR
SUCCESS / ERROR
  → [User dismisses] → IDLE
```

**Jim must NOT store confirmToken in Redux/Zustand global state** — keep it in component-local state (useRef or useState, cleared on unmount).

---

## 8. Hardcoded Gate Jim Must NOT Remove

The `disabled={true}` on the real-submit button from R10 stays as `disabled` until Wave 3 is explicitly enabled by Bruce's Wave 2 green verification. Jim wires the 2-step flow but the button enable condition is:

```typescript
const canRealSubmit = waveGreenFromBruce && !isKillSwitchHalted;
```

`waveGreenFromBruce` = boolean prop passed from parent, initially `false`, only set to `true` after Bruce verifies Wave 2.

---

## 9. Boundary Clarification

- Jim does not need to implement TTL eviction — backend handles it
- Jim does not need to call `/confirm-token` for `dryRun: true` — skip entirely
- Jim must not cache the token across page navigations
- Jim must not share a token between multiple runIds
