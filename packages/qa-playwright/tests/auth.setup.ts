import { test as setup, expect, request } from "@playwright/test";
import fs from "node:fs/promises";
import { API_BASE_URL, STORAGE_STATE, WEB_BASE_URL } from "./helpers";

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

  const storageState = JSON.parse(await fs.readFile(STORAGE_STATE, "utf8")) as {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: "Strict" | "Lax" | "None";
    }>;
    origins: unknown[];
  };
  const sessionCookie = storageState.cookies.find((cookie) => cookie.name === "iuf_session");
  const webHost = new URL(WEB_BASE_URL).hostname;

  if (sessionCookie && webHost !== new URL(API_BASE_URL).hostname) {
    storageState.cookies = storageState.cookies.filter(
      (cookie) => !(cookie.name === "iuf_session" && cookie.domain === webHost),
    );
    storageState.cookies.push({
      ...sessionCookie,
      domain: webHost,
      secure: WEB_BASE_URL.startsWith("https://"),
    });
    await fs.writeFile(STORAGE_STATE, JSON.stringify(storageState, null, 2));
  }
});
