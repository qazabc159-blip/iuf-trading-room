/**
 * sync-tw-coverage.ts
 *
 * Copies My-TW-Coverage/Pilot_Reports/ into apps/api/data/tw-coverage/
 * so the bundled files ship to Railway without requiring the sibling repo
 * to be present in the Docker build context.
 *
 * Usage (local / CI pre-build):
 *   pnpm tsx scripts/sync-tw-coverage.ts
 *   pnpm tsx scripts/sync-tw-coverage.ts --dry-run
 *   TW_COVERAGE_SRC=/custom/path pnpm tsx scripts/sync-tw-coverage.ts
 *
 * Hard lines:
 *   - Read-only from source (My-TW-Coverage). Never writes back.
 *   - Destination: apps/api/data/tw-coverage/ (relative to repo root)
 *   - If source does not exist → exit 0 with warning (Railway builds without sibling repo)
 *   - Dry-run prints file count without copying.
 */

import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SRC = path.resolve(REPO_ROOT, "../My-TW-Coverage/Pilot_Reports");
const DEST = path.resolve(REPO_ROOT, "apps/api/data/tw-coverage");

const isDryRun = process.argv.includes("--dry-run");
const srcRoot = process.env.TW_COVERAGE_SRC ?? DEFAULT_SRC;

async function dirExists(p: string): Promise<boolean> {
  try {
    await readdir(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log(`[sync-tw-coverage] src:  ${srcRoot}`);
  console.log(`[sync-tw-coverage] dest: ${DEST}`);
  console.log(`[sync-tw-coverage] dry-run: ${isDryRun}`);

  if (!(await dirExists(srcRoot))) {
    console.warn(
      `[sync-tw-coverage] WARNING: source path not found — ${srcRoot}. Skipping sync. ` +
        `This is expected in Railway build context (no sibling repo). ` +
        `If dest ${DEST} already has files from a previous sync, they will be used.`
    );
    process.exit(0);
  }

  const sectors = await readdir(srcRoot);
  let totalFiles = 0;

  if (!isDryRun) {
    // Clean destination to avoid stale files from removed sectors
    await rm(DEST, { recursive: true, force: true });
    await mkdir(DEST, { recursive: true });
  }

  for (const sector of sectors) {
    const srcSector = path.join(srcRoot, sector);
    const destSector = path.join(DEST, sector);

    let files: string[];
    try {
      files = await readdir(srcSector);
    } catch {
      continue;
    }

    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) continue;

    if (!isDryRun) {
      await mkdir(destSector, { recursive: true });
    }

    for (const file of mdFiles) {
      if (!isDryRun) {
        await copyFile(path.join(srcSector, file), path.join(destSector, file));
      }
      totalFiles++;
    }

    console.log(`[sync-tw-coverage] ${isDryRun ? "[dry]" : "copied"} ${sector}: ${mdFiles.length} files`);
  }

  console.log(
    `[sync-tw-coverage] done — ${totalFiles} files across ${sectors.length} sectors ` +
      `${isDryRun ? "(dry run, no files written)" : `→ ${DEST}`}`
  );
}

main().catch((err) => {
  console.error("[sync-tw-coverage] FATAL:", err);
  process.exit(1);
});
