import { defineConfig, devices } from "@playwright/test";

const WEB_BASE_URL = process.env.IUF_QA_WEB_BASE_URL ?? "https://app.eycvector.com";
const STORAGE_STATE = process.env.IUF_QA_STORAGE_STATE ?? "storageState.json";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "playwright-report/results.json" }]
  ],
  use: {
    baseURL: WEB_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    storageState: STORAGE_STATE
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { storageState: undefined }
    },
    {
      name: "desktop-chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      name: "mobile-iphone-13",
      dependencies: ["setup"],
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium"
      }
    }
  ],
  outputDir: "test-results"
});
