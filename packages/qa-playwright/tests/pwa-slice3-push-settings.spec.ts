import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const BASE_PORT = Number.parseInt(process.env.IUF_PWA_SLICE3_PORT ?? "3104", 10);
const repoRoot = path.resolve(process.cwd(), "..", "..");
const webDir = path.join(repoRoot, "apps", "web");
const outDir = path.join(repoRoot, "reports", "pwa_slices_20260711", "slice3");
const nextBin = createRequire(path.join(webDir, "package.json")).resolve("next/dist/bin/next");

test.use({ storageState: { cookies: [], origins: [] } });

async function startProductionServer(port: number, base: string) {
  const logs: string[] = [];
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: webDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next server exited early:\n${logs.join("")}`);
    try {
      const response = await fetch(`${base}/login`);
      if (response.ok) return child;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`Next server did not become ready:\n${logs.join("")}`);
}

async function stopProductionServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

test("PWA slice3: non-standalone settings gives install guidance instead of a broken action", async ({
  context,
  page,
}, testInfo) => {
  mkdirSync(outDir, { recursive: true });
  const port = BASE_PORT + testInfo.workerIndex;
  const base = `http://127.0.0.1:${port}`;
  const server = await startProductionServer(port, base);
  try {
    await context.addCookies([{ name: "iuf_session", value: "local-pwa-ui-check", url: base }]);
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "交易警示推播" })).toBeVisible();
    const button = page.getByRole("button", { name: "請先加入主畫面" });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    await expect(page.getByText("請先加入主畫面，再從主畫面開啟戰情室以啟用推播。")).toBeVisible();

    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(horizontalOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: path.join(outDir, `push-settings-${testInfo.project.name}.png`),
      fullPage: true,
    });
  } finally {
    await stopProductionServer(server);
  }
});
