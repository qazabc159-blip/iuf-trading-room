import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getMigrationFiles } from "../scripts/migrate.ts";

test("migration file discovery skips rollback down migrations", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iuf-migrations-"));
  try {
    await writeFile(path.join(dir, "0001_init.sql"), "SELECT 1;", "utf8");
    await writeFile(path.join(dir, "0001.down.sql"), "SELECT 'rollback';", "utf8");
    await writeFile(path.join(dir, "0002_add_column.sql"), "SELECT 2;", "utf8");
    await writeFile(path.join(dir, "0002_add_column.down.sql"), "SELECT 'rollback';", "utf8");
    await writeFile(path.join(dir, "README.md"), "not sql", "utf8");

    assert.deepEqual(getMigrationFiles(dir), [
      "0001_init.sql",
      "0002_add_column.sql"
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
