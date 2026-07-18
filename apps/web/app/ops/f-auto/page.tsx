/**
 * /ops/f-auto — F-AUTO SIM 觀察面板
 *
 * Server Component wrapper. Owner-gate + live data consumption all live in
 * the client boundary (FAutoOwnerGate → FAutoSimPanel); this file's only job
 * is to own the `dynamic` route segment config.
 *
 * P1 fix (2026-07-19, Bruce 3x repro of a frozen header-clock date):
 * Next.js only reads `dynamic`/`revalidate` route segment config from a
 * Server Component page file — when this file was itself a client component,
 * the export was silently ignored (verified via `next build`: the route stayed
 * "○ Static" and `.next/server/app/ops/f-auto.html` kept being emitted even
 * with the export present). Because this page previously had zero
 * server-side dynamic API usage (the owner-gate ran entirely client-side via
 * apiGetMe() in a useEffect), Next.js's automatic Static Rendering fully
 * prerendered it ONCE at `next build` time into the Full Route Cache. That
 * build-time snapshot baked the header's <TaipeiClock /> initial date/time
 * string into the cached HTML, and Railway/CDN then served that exact
 * byte-for-byte response (s-maxage=31536000) until the next deploy — so the
 * header date only ever advanced when a fresh deploy happened to land after
 * local midnight, which is why it could sit frozen on a stale day while the
 * ticking seconds inside the same cached string still looked plausible on a
 * quick glance. Every other PageFrame-consuming route in this app is either
 * a Server Component reading `searchParams`/dynamic route params (opting out
 * of static rendering automatically) or already carries this same
 * `dynamic = "force-dynamic"` export on a Server Component file (e.g. the
 * sibling /ops/page.tsx one directory up) — this route was the sole
 * exception. Splitting the client logic into FAutoOwnerGate.tsx and moving
 * this export onto a genuine Server Component fixes the class of bug (now
 * verified via `next build`: "ƒ /ops/f-auto" — Dynamic).
 */
export const dynamic = "force-dynamic";

import { FAutoOwnerGate } from "./FAutoOwnerGate";

export default function FAutoPage() {
  return <FAutoOwnerGate />;
}
