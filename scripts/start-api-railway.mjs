import { spawn } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const migrationTimeoutMs = Number(process.env.RAILWAY_MIGRATION_TIMEOUT_MS ?? 25_000);
const migrationRequired = process.env.RAILWAY_MIGRATION_REQUIRED === "1";

function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 0;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    let settled = false;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGTERM");
          resolve({ ok: false, code: null, timedOut: true });
        }, timeoutMs)
      : null;

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ ok: code === 0, code, timedOut: false });
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      console.error(`[start-api-railway] Failed to spawn ${command}:`, error);
      resolve({ ok: false, code: null, timedOut: false });
    });
  });
}

console.log("[start-api-railway] Booting api service");
console.log(
  `[start-api-railway] migrationTimeoutMs=${migrationTimeoutMs} migrationRequired=${migrationRequired}`
);

const migration = await run(pnpm, ["migrate"], { timeoutMs: migrationTimeoutMs });
if (!migration.ok) {
  const reason = migration.timedOut
    ? `timed out after ${migrationTimeoutMs}ms`
    : `exited with code ${migration.code ?? "unknown"}`;
  const message = `[start-api-railway] Migration ${reason}`;
  if (migrationRequired) {
    console.error(`${message}; refusing to start because RAILWAY_MIGRATION_REQUIRED=1`);
    process.exit(1);
  }
  console.warn(`${message}; starting API in degraded mode so /health remains available`);
}

const api = spawn(pnpm, ["start:api"], {
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32"
});

api.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[start-api-railway] API exited via signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

api.on("error", (error) => {
  console.error("[start-api-railway] Failed to start API:", error);
  process.exit(1);
});
