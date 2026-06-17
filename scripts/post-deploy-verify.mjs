#!/usr/bin/env node
/**
 * Post-deploy core-surface verification (root-cause class 4, 2026-06-17).
 *
 * The 6/17 F-AUTO "0 positions" regression (#1089 filtered SIM holdings to
 * filled-only; KGI SIM never fills) was NOT caught by CI — it only showed on
 * the live API after deploy. Every recurring "open the site and it's broken"
 * has been like this: the failure is environment/data specific and only a real
 * request against PROD reveals it. This script automates the manual post-deploy
 * checks Elva has been running by hand (f-auto / quote / overview / brief), so
 * a core-surface regression fails the deploy + pages instead of waiting for the
 * owner to find it.
 *
 * Designed to be tolerant of legitimately-empty off-hours / non-trading-day
 * states — it fails ONLY on structural breakage (a known-good surface returning
 * a shape that means "regressed", e.g. holdings collapsing to zero with the
 * orders-unconfirmed note, or an index value that isn't a number).
 *
 * Env: SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD. API base via API_BASE (default prod).
 */

const API = process.env.API_BASE ?? "https://api.eycvector.com";
const EMAIL = process.env.SEED_OWNER_EMAIL;
const PWD = process.env.SEED_OWNER_PASSWORD;

const failures = [];
const notes = [];

function fail(surface, msg) { failures.push(`${surface}: ${msg}`); }
function ok(surface, msg) { notes.push(`✓ ${surface}: ${msg}`); }

async function main() {
  if (!EMAIL || !PWD) {
    console.error("::error::SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD not set — cannot run post-deploy verify");
    process.exit(1);
  }

  // 1. Owner login (cookie jar via Set-Cookie)
  const loginRes = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PWD }),
  });
  if (!loginRes.ok) {
    console.error(`::error::owner login failed HTTP ${loginRes.status}`);
    process.exit(1);
  }
  const cookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0];
  const h = { cookie, "x-workspace-slug": "primary-desk" };
  const getJson = async (path) => {
    const r = await fetch(`${API}${path}`, { headers: h });
    return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
  };

  // 2. F-AUTO holdings — the #1089 regression surface. If there is a basket this
  //    week, holdings must not collapse to zero with the "orders unconfirmed"
  //    note (that exact note IS the regression signature).
  const fa = await getJson("/api/v1/portfolio/f-auto");
  if (fa.status !== 200 || !fa.body) {
    fail("f-auto", `HTTP ${fa.status}`);
  } else {
    const positions = fa.body.positions ?? [];
    const noteStr = (fa.body.notes ?? []).join(" ");
    if (positions.length === 0 && /orders_unconfirmed_not_positions/.test(noteStr)) {
      fail("f-auto", "0 positions with orders-unconfirmed note — SIM holdings rebuild regressed (see #1089/#1094)");
    } else {
      ok("f-auto", `${positions.length} positions (${fa.body.data_source})`);
    }
  }

  // 3. TAIEX overview — index must be a real number (not null/NaN).
  const ov = await getJson("/api/v1/market/overview/twse");
  if (ov.status !== 200 || !ov.body) {
    fail("overview/twse", `HTTP ${ov.status}`);
  } else if (typeof ov.body?.taiex?.value !== "number" || !Number.isFinite(ov.body.taiex.value)) {
    fail("overview/twse", `TAIEX value is not a number: ${JSON.stringify(ov.body?.taiex)}`);
  } else {
    ok("overview/twse", `TAIEX ${ov.body.taiex.value}`);
  }

  // 4. Quote 2330 — must carry a real last price (off-hours = today's close).
  const q = await getJson("/api/v1/companies/2330/quote/realtime");
  const qd = q.body?.data;
  if (q.status !== 200 || !qd) {
    fail("quote/2330", `HTTP ${q.status}`);
  } else if (typeof qd.lastPrice !== "number" || !Number.isFinite(qd.lastPrice)) {
    fail("quote/2330", `lastPrice not a number (state=${qd.state}, source=${qd.source})`);
  } else {
    ok("quote/2330", `${qd.lastPrice} (${qd.state})`);
  }

  // 5. Briefs — at least one published brief must exist (pipeline alive).
  const br = await getJson("/api/v1/briefs?limit=3");
  const briefs = br.body?.data ?? [];
  if (br.status !== 200) {
    fail("briefs", `HTTP ${br.status}`);
  } else if (!briefs.some((b) => b.status === "published")) {
    fail("briefs", "no published brief in the latest 3 — pipeline may be down");
  } else {
    ok("briefs", `latest ${briefs[0]?.date}`);
  }

  for (const n of notes) console.log(n);
  if (failures.length > 0) {
    console.error("\n::error::Post-deploy core-surface verification FAILED:");
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log("\n✅ Post-deploy core surfaces verified (f-auto / overview / quote / briefs)");
}

main().catch((e) => {
  console.error(`::error::post-deploy verify crashed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
