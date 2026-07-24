#!/usr/bin/env node
/**
 * Guard against the postgres-js ".rows silent-zero" bug class.
 *
 * This repo's driver is drizzle-orm/postgres-js, whose db.execute() returns a
 * BARE ARRAY — there is no `.rows` wrapper. Reading `result.rows` on it yields
 * `undefined`, which silently degrades to an empty result. This caused a whole
 * class of "0 rows forever" production bugs (ai-rec perf store, alerts engine,
 * heatmap, etc) that no test caught because the code "worked", just on empty.
 *
 * Known NOT detected (documented gaps, Pete-14 review 2026-07-24 — reviewers
 * must still eyeball these shapes in db-touching PRs):
 *   1. destructuring:      const { rows } = await db.execute(...)
 *   2. pass-as-param:      fn(await db.execute(...)) then param.rows inside fn
 *   3. rename-then-read:   const r = result; r.rows  (alias breaks the window)
 * Also: Pattern B's 2000-char window has no function-scope awareness — an
 * unrelated same-named variable with a genuine .rows nearby can false-positive.
 *
 * Rule: never read `.rows` off a db.execute() result, in ANY form — not even
 * with a `?? []` / `?.` fallback attached. `.rows` is undefined on this
 * driver's bare-array shape unconditionally, so `.rows ?? []` doesn't make
 * the read "safe" — it just makes the resulting silent-empty look
 * intentional/defensive, which is exactly what let this bug class survive in
 * production for weeks (PR #1352, 2026-07-23 — see
 * evidence/sprint_2026_07_23/pr1352_review.md §6 for the incident writeup).
 * Use `execRows()` from @iuf-trading-room/db instead, which normalizes both
 * shapes.
 *
 * Detects two shapes of violation:
 *
 *   A) Same-expression chain — `db.execute(...).rows`, optionally through an
 *      `as unknown as {...}` cast, read directly off the call:
 *        (await db.execute(sql`...`)).rows
 *        (await db.execute(sql`...`) as unknown as { rows: T[] }).rows ?? []
 *
 *   B) Assign-then-read — the .execute() result is bound to a variable
 *      (optionally through the same cast), then `.rows` is read off that
 *      variable in a separate statement shortly after. This is the pattern
 *      that shipped in PR #1352 (and the original R1 bug) and is NOT a
 *      same-expression chain, so pattern A's regex never sees it:
 *        const rows = (await db.execute(sql`...`)) as unknown as { rows: T[] };
 *        const closes = (rows.rows ?? []).map(...);
 *
 * 2026-07-24 (Jason-2, evidence/sprint_2026_07_23/pr1352_review.md 🟡 #2):
 * this guard previously only detected pattern A, AND excluded any match
 * immediately followed by `??` (a `(?!\s*\?\?)` negative lookahead intended
 * to treat "has a fallback" as "safe" — backwards, since the fallback is
 * what made the bug silent instead of throwing). Neither the negative
 * lookahead removal nor pattern B existed before this change; empirically,
 * ALL 9 real sites fixed in #1352 used pattern B (assign-then-read), which
 * the pre-2026-07-24 guard could not have caught even without the `??`
 * blind spot — see PR body for the regex-only unit trace proving this.
 *
 * This check fails CI on any detected violation. Exit 0 = clean.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/api/src", "apps/worker/src"];
const violations = [];

// Blank out `//...` and `/* ... */` comment content (preserving newlines and
// character offsets, so line numbers stay accurate) before scanning. Without
// this, a comment that merely *mentions* `.execute()` in prose (e.g. this
// script's own doc comments, or ai-rec-perf-store.ts:58's "Normalize
// db.execute() results.") can bridge pattern A's non-greedy `[^;]*?` across
// unrelated code into a real, already-safely-guarded `.rows` access further
// down the same statement — a false positive found empirically against this
// repo (server.ts:3705's `Array.isArray(result) ? ... : (...).rows ?? []`
// ternary) while building this guard. String/template literal contents are
// left untouched (tracked via a simple quote-state machine) so a URL like
// `"https://..."` inside a string isn't mistaken for a `//` comment.
function stripComments(src) {
  let out = "";
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null; // one of ' " ` when inside a string/template literal
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      out += c === "\n" ? "\n" : " ";
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        out += "  ";
        i++;
        inBlockComment = false;
      } else {
        out += c === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inString = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLineComment = true;
      out += "  ";
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      out += "  ";
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

// Pattern A: `.execute(...).rows`, optionally through one `as ... as {...}`
// cast layer (hence the optional extra `)`), read directly off the call — in
// the SAME statement, no `;` in between. No `??`/`?.` exclusion: `.rows` is
// unconditionally wrong here regardless of what follows it.
const NAKED_CHAIN = /\.execute\([^;]*?\)\s*\)?\s*\.rows\b/gs;

// Pattern B, phase 1: `const/let NAME = ...execute(` — captures the variable
// name bound to a (possibly cast) db.execute() result.
const EXECUTE_ASSIGNMENT = /\b(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*[^;]*?\.execute\(/gs;

// Pattern B, phase 2 window: how far past the `.execute(` token to look for
// `NAME.rows`. This has to span the *rest of the current SQL template*
// (multi-line, sometimes 500-900+ chars for a multi-join query) plus the
// `as unknown as {...}` cast and its terminating `;`, plus the following
// statement where `.rows` is actually read — measured empirically against
// all 9 real #1352 sites (the longest, get_supply_chain's relation query, is
// ~950 chars from `.execute(` to `.rows`). 2000 gives comfortable margin
// while still being narrow enough that an unrelated variable reusing the
// same name far later in a long file (e.g. `rows` in server.ts) is very
// unlikely to fall inside the window.
const READ_WINDOW_CHARS = 2000;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith(".ts") && !p.includes(".test.")) scan(p);
  }
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

function scan(file) {
  const rawSrc = readFileSync(file, "utf8");
  const rel = file.replace(/\\/g, "/");
  // Scan the comment-stripped source (same length/line structure as rawSrc,
  // so indices from either can be fed straight into lineOf(rawSrc, ...)).
  const src = stripComments(rawSrc);

  let m;

  NAKED_CHAIN.lastIndex = 0;
  while ((m = NAKED_CHAIN.exec(src)) !== null) {
    violations.push(`${rel}:${lineOf(rawSrc, m.index)} (naked chain: .execute(...).rows)`);
  }

  EXECUTE_ASSIGNMENT.lastIndex = 0;
  while ((m = EXECUTE_ASSIGNMENT.exec(src)) !== null) {
    const varName = m[1];
    const windowStart = EXECUTE_ASSIGNMENT.lastIndex;
    const window = src.slice(windowStart, windowStart + READ_WINDOW_CHARS);
    const readRe = new RegExp(`\\b${varName}\\.rows\\b`);
    const readMatch = readRe.exec(window);
    if (readMatch) {
      const absoluteIndex = windowStart + readMatch.index;
      violations.push(`${rel}:${lineOf(rawSrc, absoluteIndex)} (assign-then-read: ${varName}.rows)`);
    }
  }
}

for (const root of ROOTS) walk(root);

if (violations.length > 0) {
  console.error(
    "❌ db.execute(...).rows detected — postgres-js returns a bare array,\n" +
    "   so `.rows` is undefined (silent zero), even with a `?? []`/`?.` fallback.\n" +
    "   Use execRows() from @iuf-trading-room/db:\n"
  );
  for (const v of violations) console.error("   " + v);
  process.exit(1);
}

console.log("✅ db-execrows guard passed — no naked or assign-then-read db.execute(...).rows");
