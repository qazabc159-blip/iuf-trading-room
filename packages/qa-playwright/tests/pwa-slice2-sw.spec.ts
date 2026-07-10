import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const PORT = process.env.IUF_PWA_SLICE2_PORT ?? "3103";
const BASE = `http://127.0.0.1:${PORT}`;
const repoRoot = path.resolve(process.cwd(), "..", "..");
const webDir = path.join(repoRoot, "apps", "web");
const outDir = path.join(process.cwd(), "..", "..", "reports", "pwa_slices_20260711", "slice2");
const nextBin = createRequire(path.join(webDir, "package.json")).resolve("next/dist/bin/next");

test.use({ storageState: { cookies: [], origins: [] } });

async function startProductionServer() {
  const logs: string[] = [];
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", PORT], {
    cwd: webDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next server exited early:\n${logs.join("")}`);
    try {
      const response = await fetch(`${BASE}/sw.js`);
      if (response.ok) return { child, logs };
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

test("PWA slice2: SW registration, API fail-fast, and honest navigation fallback", async ({
  context,
  page,
}, testInfo) => {
  mkdirSync(outDir, { recursive: true });
  const server = await startProductionServer();

  try {
    const swResponse = await context.request.get(`${BASE}/sw.js`);
    expect(swResponse.status()).toBe(200);
    expect(swResponse.headers()["content-type"]).toContain("application/javascript");

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      for (let attempt = 0; attempt < 50 && !navigator.serviceWorker.controller; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return {
        activeState: ready.active?.state ?? null,
        controlled: navigator.serviceWorker.controller !== null,
        scope: ready.scope,
      };
    });

    expect(registration).toEqual({
      activeState: "activated",
      controlled: true,
      scope: `${BASE}/`,
    });

    // Stop the actual origin after activation so the SW sees real network
    // rejections instead of Playwright short-circuiting navigation events.
    await stopProductionServer(server.child);

    const apiResult = await page.evaluate(async () => {
      try {
        await fetch("/api/v1/pwa-offline-probe");
        return { failed: false, message: "" };
      } catch (error) {
        return { failed: true, message: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(apiResult.failed).toBe(true);
    expect(apiResult.message).toMatch(/fetch|network|offline/i);

    await page.goto(`${BASE}/m`, { waitUntil: "domcontentloaded" });
    const offlineCopy = await page.locator("main").innerText();
    expect(offlineCopy).toContain("目前離線，行情與帳務資料無法載入");
    expect(offlineCopy).toContain("不會顯示任何先前快取的數字");
    expect(offlineCopy).not.toMatch(/\d/);

    await page.screenshot({
      path: path.join(outDir, `offline-navigation-${testInfo.project.name}.png`),
      fullPage: true,
    });
    console.log("SLICE2_SW_REGISTRATION", JSON.stringify(registration));
    console.log("SLICE2_OFFLINE_API", JSON.stringify(apiResult));
    console.log("SLICE2_OFFLINE_COPY", JSON.stringify(offlineCopy));
  } finally {
    await stopProductionServer(server.child);
  }
});
