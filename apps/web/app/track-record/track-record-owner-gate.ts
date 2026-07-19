import type { getCurrentUserSession } from "@/lib/api";

export type TrackRecordSessionResult = Awaited<ReturnType<typeof getCurrentUserSession>>;

/**
 * Pure gate predicate for /track-record's owner-only lock (2026-07-20
 * governance fix — Athena §2: F-AUTO run performance must not reach
 * non-owner users, and this page's B section renders exactly that).
 *
 * Extracted so the gate's decision logic is directly unit-testable.
 * `getCurrentUserSession()` (apps/web/lib/api.ts) is an SSR-only fetch that
 * forwards the incoming request's Cookie header via `next/headers` — unlike
 * `/ops/f-auto`'s `apiGetMe()` (a client-side `fetch`), Playwright's
 * `context.route()` browser-network mocking cannot intercept it (it only
 * sees requests the browser issues, not ones the Next.js server process
 * makes while rendering the page). This unit test is the equivalent
 * coverage for the gate's actual boolean decision.
 */
export function isTrackRecordOwnerSession(session: TrackRecordSessionResult): boolean {
  return session.ok && session.role === "Owner";
}
