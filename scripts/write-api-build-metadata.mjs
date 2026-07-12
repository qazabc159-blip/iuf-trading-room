import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(repoRoot, "apps/api/dist/build-metadata.json");

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveCommit() {
  const providerCommit =
    nonEmpty(process.env.RAILWAY_GIT_COMMIT_SHA) ?? nonEmpty(process.env.VERCEL_GIT_COMMIT_SHA);
  if (providerCommit) return providerCommit;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unknown";
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify({ commit: resolveCommit(), builtAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8"
);
console.log("[build-metadata] wrote apps/api/dist/build-metadata.json");
