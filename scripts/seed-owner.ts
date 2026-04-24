/**
 * seed-invites.ts — Seed initial invite codes
 *
 * Owner user seeding is handled by apps/api/src/auth-store.ts `seedOwnerIfEmpty()`
 * at API startup (reads SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD env).
 * This script only seeds the first batch of invite codes, which require an
 * existing owner user as `issued_by`.
 *
 * Prerequisites:
 *   - API has started at least once with SEED_OWNER_EMAIL + SEED_OWNER_PASSWORD
 *     so the owner row exists.
 *   - DATABASE_URL env var set.
 *   - PERSISTENCE_MODE=database.
 *
 * Usage:
 *   DATABASE_URL=postgres://... PERSISTENCE_MODE=database \
 *   OWNER_EMAIL=qazabc159@gmail.com \
 *   node --import tsx ./scripts/seed-owner.ts
 *
 * Idempotent: skips any invite code that already exists.
 */

import process from "node:process";

import postgres from "postgres";

const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "qazabc159@gmail.com";

// Invite codes — expires 2026-05-01
// Full list also in: _EVIDENCE/invite_codes.md (NOT committed to git)
const INVITE_CODES = [
  "YBKW6U",
  "37JBL2",
  "YOFUKP",
  "UK5EE3",
  "22RFPW",
];

const INVITE_EXPIRES_AT = new Date("2026-05-01T23:59:59Z");

async function main() {
  const persistenceMode = process.env.PERSISTENCE_MODE ?? "memory";
  if (persistenceMode !== "database") {
    console.log("[seed-invites] Skipping: PERSISTENCE_MODE is not 'database'.");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("[seed-invites] DATABASE_URL is required.");
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const owners = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${OWNER_EMAIL} LIMIT 1
    `;

    if (owners.length === 0) {
      throw new Error(
        `[seed-invites] Owner user ${OWNER_EMAIL} not found. ` +
        `Start the API once with SEED_OWNER_EMAIL + SEED_OWNER_PASSWORD first.`
      );
    }

    const ownerId = owners[0].id;
    console.log(`[seed-invites] Owner user found: ${ownerId}`);

    let created = 0;
    let skipped = 0;

    for (const code of INVITE_CODES) {
      const existing = await sql`
        SELECT code FROM invite_codes WHERE code = ${code}
      `;
      if (existing.length > 0) {
        console.log(`[seed-invites] Invite code ${code} already exists — skipping.`);
        skipped++;
        continue;
      }

      await sql`
        INSERT INTO invite_codes (code, issued_by, expires_at)
        VALUES (${code}, ${ownerId}, ${INVITE_EXPIRES_AT})
      `;
      console.log(`[seed-invites] Invite code ${code} inserted (expires ${INVITE_EXPIRES_AT.toISOString().split("T")[0]}).`);
      created++;
    }

    console.log(`[seed-invites] Done. Invite codes: ${created} created, ${skipped} skipped.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[seed-invites] FAILED:", error);
  process.exitCode = 1;
});
