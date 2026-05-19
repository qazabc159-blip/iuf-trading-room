import { test as setup, expect, request } from "@playwright/test";
import { API_BASE_URL, STORAGE_STATE } from "./helpers";

setup("owner session storageState", async () => {
  const email = process.env.IUF_QA_OWNER_EMAIL ?? process.env.SEED_OWNER_EMAIL;
  const password = process.env.IUF_QA_OWNER_PASSWORD ?? process.env.SEED_OWNER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Missing owner credentials. Set IUF_QA_OWNER_EMAIL/IUF_QA_OWNER_PASSWORD or SEED_OWNER_EMAIL/SEED_OWNER_PASSWORD."
    );
  }

  const context = await request.newContext({
    baseURL: API_BASE_URL,
    storageState: { cookies: [], origins: [] }
  });
  const response = await context.post("/auth/login", {
    data: { email, password },
    headers: { "Content-Type": "application/json" }
  });

  expect(response.ok(), `owner login failed with HTTP ${response.status()}`).toBeTruthy();
  await context.storageState({ path: STORAGE_STATE });
  await context.dispose();
});
