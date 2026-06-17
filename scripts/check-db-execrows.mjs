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
 * Rule: never read `.rows` directly off a db.execute() result. Use
 * `execRows()` from @iuf-trading-room/db, which normalizes both shapes.
 *
 * This check fails CI on a naked `execute(...).rows` that has no `??` fallback
 * on the same expression. Exit 0 = clean.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/api/src", "apps/worker/src"];
const violations = [];

// naked `.execute( ... ).rows` not immediately followed by `??` (a fallback)
const NAKED = /\.execute\([^;]*?\)\s*\)?\s*\.rows\b(?!\s*\?\?)/gs;

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

function scan(file) {
  const src = readFileSync(file, "utf8");
  let m;
  while ((m = NAKED.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    violations.push(`${file.replace(/\\/g, "/")}:${line}`);
  }
}

for (const root of ROOTS) walk(root);

if (violations.length > 0) {
  console.error(
    "❌ Naked db.execute(...).rows detected — postgres-js returns a bare array,\n" +
    "   so `.rows` is undefined (silent zero). Use execRows() from @iuf-trading-room/db:\n"
  );
  for (const v of violations) console.error("   " + v);
  process.exit(1);
}

console.log("✅ db-execrows guard passed — no naked db.execute(...).rows");
