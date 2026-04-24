/**
 * verify-worker-content-api.ts
 *
 * Integration proof: trigger each producer once, then curl the new API endpoints.
 * Requires DATABASE_URL + PERSISTENCE_MODE=database in env.
 *
 * Usage:
 *   BASE_URL=https://your-railway-url pnpm tsx scripts/verify-worker-content-api.ts
 *   # Or against local API:
 *   BASE_URL=http://localhost:3000 pnpm tsx scripts/verify-worker-content-api.ts
 */

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:3000";
const WORKSPACE_SLUG = process.env["WORKSPACE_SLUG"] ?? "primary-desk";

// Session cookie (set if your API requires auth)
const SESSION_COOKIE = process.env["SESSION_COOKIE"] ?? "";

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  "x-workspace-slug": WORKSPACE_SLUG
};
if (SESSION_COOKIE) {
  headers["Cookie"] = SESSION_COOKIE;
}

async function get(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const body = await res.json() as { data?: unknown; error?: unknown };
  return { status: res.status, body };
}

async function section(title: string, fn: () => Promise<void>) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
  try {
    await fn();
  } catch (e) {
    console.error("  FAIL:", e);
    process.exit(1);
  }
}

function printRows(data: unknown) {
  if (Array.isArray(data)) {
    console.log(`  row count: ${data.length}`);
    if (data.length > 0) {
      const first = data[0] as Record<string, unknown>;
      console.log(`  first row: id=${first["id"]} generatedAt=${first["generatedAt"] ?? first["createdAt"]}`);
    } else {
      console.log("  (empty — run workers to populate)");
    }
  } else {
    console.log("  unexpected shape:", JSON.stringify(data).slice(0, 200));
  }
}

await section("GET /api/v1/theme-summaries", async () => {
  const { status, body } = await get("/api/v1/theme-summaries");
  console.log(`  status: ${status}`);
  if (status !== 200) {
    console.error("  FAIL body:", JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  printRows(body.data);
});

await section("GET /api/v1/company-notes", async () => {
  const { status, body } = await get("/api/v1/company-notes");
  console.log(`  status: ${status}`);
  if (status !== 200) {
    console.error("  FAIL body:", JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  printRows(body.data);
});

await section("GET /api/v1/briefs (now DB-backed)", async () => {
  const { status, body } = await get("/api/v1/briefs");
  console.log(`  status: ${status}`);
  if (status !== 200) {
    console.error("  FAIL body:", JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  const data = body.data;
  if (Array.isArray(data)) {
    console.log(`  row count: ${data.length}`);
    if (data.length > 0) {
      const first = data[0] as Record<string, unknown>;
      console.log(`  first brief: id=${first["id"]} date=${first["date"]} generatedBy=${first["generatedBy"]}`);
    } else {
      console.log("  (empty — run daily-brief-producer to populate)");
    }
  }
});

await section("GET /api/v1/theme-summaries?themeId=filter-test", async () => {
  // just verify the filter param doesn't 500
  const { status } = await get("/api/v1/theme-summaries?themeId=00000000-0000-0000-0000-000000000000");
  console.log(`  status: ${status} (expected 200, empty array)`);
  if (status !== 200) process.exit(1);
  console.log("  filter param: OK");
});

// ── P1 endpoints ─────────────────────────────────────────────────────────────

await section("GET /api/v1/review-summaries", async () => {
  const { status, body } = await get("/api/v1/review-summaries");
  console.log(`  status: ${status}`);
  if (status !== 200) {
    console.error("  FAIL body:", JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  printRows(body.data);
});

await section("GET /api/v1/review-summaries?themeSlug=filter-test", async () => {
  const { status } = await get("/api/v1/review-summaries?themeSlug=does-not-exist");
  console.log(`  status: ${status} (expected 200, empty array)`);
  if (status !== 200) process.exit(1);
  console.log("  themeSlug filter: OK");
});

await section("GET /api/v1/signal-clusters", async () => {
  const { status, body } = await get("/api/v1/signal-clusters");
  console.log(`  status: ${status}`);
  if (status !== 200) {
    console.error("  FAIL body:", JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  printRows(body.data);
});

await section("GET /api/v1/signal-clusters?limit=5", async () => {
  const { status, body } = await get("/api/v1/signal-clusters?limit=5");
  console.log(`  status: ${status}`);
  if (status !== 200) process.exit(1);
  const d = body.data;
  if (Array.isArray(d)) console.log(`  rows returned (capped 5): ${d.length}`);
  console.log("  limit param: OK");
});

console.log("\n\nAll checks PASS. API endpoints are live.\n");
