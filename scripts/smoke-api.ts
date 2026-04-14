import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const apiDir = path.join(repoRoot, "apps", "api");
const workspaceSlug = "primary-desk";

type JsonEnvelope<T> = { data: T };

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve a free port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealth(baseUrl: string, attempts = 30) {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health endpoint returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  throw lastError instanceof Error ? lastError : new Error("API did not become healthy in time.");
}

async function request<T>(
  baseUrl: string,
  route: string,
  init?: RequestInit & { raw?: boolean }
): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${route} failed with ${response.status}: ${body}`);
  }

  if (init?.raw) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const webhookToken = "smoke-webhook-token";
  const server = spawn(process.execPath, ["dist/server.js"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(port),
      DEFAULT_WORKSPACE_SLUG: workspaceSlug,
      TV_WEBHOOK_TOKEN: webhookToken
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  server.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth(baseUrl);

    const session = await request<JsonEnvelope<{ workspace: { slug: string } }>>(
      baseUrl,
      "/api/v1/session",
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.equal(session.data.workspace.slug, workspaceSlug);

    const theme = await request<JsonEnvelope<{ id: string; name: string }>>(baseUrl, "/api/v1/themes", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        name: "CI Smoke Theme",
        marketState: "Balanced",
        lifecycle: "Discovery",
        priority: 3,
        thesis: "Smoke-test thesis",
        whyNow: "CI should verify end-to-end CRUD.",
        bottleneck: "Execution"
      })
    });
    assert.equal(theme.data.name, "CI Smoke Theme");

    const company = await request<JsonEnvelope<{ id: string; name: string }>>(
      baseUrl,
      "/api/v1/companies",
      {
        method: "POST",
        headers: { "x-workspace-slug": workspaceSlug },
        body: JSON.stringify({
          name: "Smoke Optics",
          ticker: "SMK1",
          market: "NASDAQ",
          country: "United States",
          themeIds: [theme.data.id],
          chainPosition: "Optical systems",
          beneficiaryTier: "Direct",
          exposure: {
            volume: 4,
            asp: 3,
            margin: 3,
            capacity: 4,
            narrative: 4
          },
          validation: {
            capitalFlow: "Improving",
            consensus: "Rising",
            relativeStrength: "Positive"
          },
          notes: "Smoke test company"
        })
      }
    );
    assert.equal(company.data.name, "Smoke Optics");

    const signal = await request<JsonEnvelope<{ id: string; title: string }>>(baseUrl, "/api/v1/signals", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        category: "industry",
        direction: "bullish",
        title: "CI smoke signal",
        summary: "Validates signal creation.",
        confidence: 4,
        themeIds: [theme.data.id],
        companyIds: [company.data.id]
      })
    });
    assert.equal(signal.data.title, "CI smoke signal");

    const eventTimestamp = new Date().toISOString();
    const webhookSignal = await request<
      JsonEnvelope<{ id: string; title: string; direction: string }> & {
        meta?: { duplicate: boolean; eventKey: string };
      }
    >(
      baseUrl,
      "/api/v1/webhooks/tradingview",
      {
        method: "POST",
        headers: { "x-workspace-slug": workspaceSlug },
        body: JSON.stringify({
          token: webhookToken,
          ticker: "SMK1",
          exchange: "NASDAQ",
          price: "123.45",
          interval: "1D",
          timestamp: eventTimestamp,
          eventKey: "smoke-tv-event",
          direction: "bullish",
          category: "price",
          confidence: 5,
          summary: "Webhook smoke signal",
          themeIds: [theme.data.id],
          companyIds: [company.data.id]
        })
      }
    );
    assert.match(webhookSignal.data.title, /TV Alert/);
    assert.equal(webhookSignal.data.direction, "bullish");
    assert.equal(webhookSignal.meta?.duplicate, false);

    const duplicateWebhookSignal = await request<
      JsonEnvelope<{ id: string; title: string; direction: string }> & {
        meta?: { duplicate: boolean; eventKey: string };
      }
    >(baseUrl, "/api/v1/webhooks/tradingview", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        token: webhookToken,
        ticker: "SMK1",
        exchange: "NASDAQ",
        price: "123.45",
        interval: "1D",
        timestamp: eventTimestamp,
        eventKey: "smoke-tv-event",
        direction: "bullish",
        category: "price",
        confidence: 5,
        summary: "Webhook smoke signal",
        themeIds: [theme.data.id],
        companyIds: [company.data.id]
      })
    });
    assert.equal(duplicateWebhookSignal.data.id, webhookSignal.data.id);
    assert.equal(duplicateWebhookSignal.meta?.duplicate, true);

    const staleWebhookResponse = await fetch(`${baseUrl}/api/v1/webhooks/tradingview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": workspaceSlug
      },
      body: JSON.stringify({
        token: webhookToken,
        ticker: "SMK1",
        timestamp: "2020-01-01T00:00:00.000Z"
      })
    });
    assert.equal(staleWebhookResponse.status, 400);
    const staleWebhookBody = (await staleWebhookResponse.json()) as { error: string };
    assert.equal(staleWebhookBody.error, "timestamp_out_of_range");

    const plan = await request<JsonEnvelope<{ id: string; companyId: string }>>(baseUrl, "/api/v1/plans", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        companyId: company.data.id,
        status: "ready",
        entryPlan: "Enter on constructive pullback.",
        invalidationPlan: "Exit on failed reclaim.",
        targetPlan: "Scale into momentum.",
        riskReward: "1:2.8",
        notes: "Smoke-test plan"
      })
    });
    assert.equal(plan.data.companyId, company.data.id);

    const review = await request<JsonEnvelope<{ id: string; tradePlanId: string }>>(
      baseUrl,
      "/api/v1/reviews",
      {
        method: "POST",
        headers: { "x-workspace-slug": workspaceSlug },
        body: JSON.stringify({
          tradePlanId: plan.data.id,
          outcome: "Captured part of the move.",
          attribution: "Signal and setup aligned.",
          lesson: "Keep position sizing disciplined.",
          setupTags: ["smoke", "ci"],
          executionQuality: 4
        })
      }
    );
    assert.equal(review.data.tradePlanId, plan.data.id);

    const brief = await request<JsonEnvelope<{ id: string; status: string }>>(baseUrl, "/api/v1/briefs", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        date: "2026-04-13",
        marketState: "Balanced",
        sections: [
          {
            heading: "Smoke",
            body: "Brief creation works."
          }
        ],
        generatedBy: "manual",
        status: "draft"
      })
    });
    assert.equal(brief.data.status, "draft");

    const registration = await request<
      JsonEnvelope<{ deviceId: string; deviceToken: string }>
    >(baseUrl, "/api/v1/openalice/register", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        deviceId: "ci-device",
        deviceName: "CI OpenAlice",
        capabilities: ["drafts", "summaries"]
      })
    });
    assert.equal(registration.data.deviceId, "ci-device");

    const devicesBefore = await request<
      JsonEnvelope<Array<{ deviceId: string; status: string }>>
    >(baseUrl, "/api/v1/openalice/devices", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    const activeDevice = devicesBefore.data.find((item) => item.deviceId === registration.data.deviceId);
    assert.ok(activeDevice, "Expected registered OpenAlice device to be listed.");
    assert.equal(activeDevice?.status, "active");

    const job = await request<JsonEnvelope<{ jobId: string }>>(baseUrl, "/api/v1/openalice/jobs", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        taskType: "daily_brief",
        schemaName: "BriefDraft",
        instructions: "Draft a concise CI brief.",
        contextRefs: [{ type: "theme", id: theme.data.id }],
        parameters: { source: "ci" }
      })
    });

    const deviceHeaders = {
      Authorization: `Bearer ${registration.data.deviceToken}`,
      "x-device-id": registration.data.deviceId
    };

    const claim = await request<JsonEnvelope<{ jobId: string }>>(baseUrl, "/api/internal/openalice/jobs/claim", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${registration.data.deviceToken}`
      },
      body: JSON.stringify({
        deviceId: registration.data.deviceId
      })
    });
    assert.equal(claim.data.jobId, job.data.jobId);

    await request<JsonEnvelope<{ ok: boolean }>>(
      baseUrl,
      `/api/internal/openalice/jobs/${job.data.jobId}/heartbeat`,
      {
        method: "POST",
        headers: deviceHeaders,
        body: JSON.stringify({
          deviceId: registration.data.deviceId
        })
      }
    );

    const result = await request<JsonEnvelope<{ status: string }>>(
      baseUrl,
      `/api/internal/openalice/jobs/${job.data.jobId}/result`,
      {
        method: "POST",
        headers: deviceHeaders,
        body: JSON.stringify({
          jobId: job.data.jobId,
          status: "draft_ready",
          schemaName: "BriefDraft",
          structured: {
            title: "CI Brief",
            bullets: ["Smoke passed"]
          },
          rawText: "Draft ready",
          warnings: [],
          artifacts: []
        })
      }
    );
    assert.equal(result.data.status, "draft_ready");

    const jobs = await request<JsonEnvelope<Array<{ id: string; status: string }>>>(
      baseUrl,
      "/api/v1/openalice/jobs",
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    const createdJob = jobs.data.find((item) => item.id === job.data.jobId);
    assert.ok(createdJob, "Expected smoke job to be listed.");
    assert.equal(createdJob?.status, "draft_ready");

    const reviewed = await request<
      JsonEnvelope<{ id: string; status: string; reviewedAt: string }>
    >(baseUrl, `/api/v1/openalice/jobs/${job.data.jobId}/review`, {
      method: "PATCH",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({
        status: "published",
        note: "smoke review publish"
      })
    });
    assert.equal(reviewed.data.id, job.data.jobId);
    assert.equal(reviewed.data.status, "published");

    const revokedDevice = await request<
      JsonEnvelope<{ deviceId: string; status: string }>
    >(baseUrl, `/api/v1/openalice/devices/${registration.data.deviceId}/revoke`, {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({})
    });
    assert.equal(revokedDevice.data.deviceId, registration.data.deviceId);
    assert.equal(revokedDevice.data.status, "revoked");

    const cleanup = await request<
      JsonEnvelope<{ revokedCount: number; staleBeforeCleanup: number }>
    >(baseUrl, "/api/v1/openalice/devices/cleanup", {
      method: "POST",
      headers: { "x-workspace-slug": workspaceSlug },
      body: JSON.stringify({ staleSeconds: 1 })
    });
    assert.equal(cleanup.data.revokedCount, 0);
    assert.equal(cleanup.data.staleBeforeCleanup, 0);

    const observability = await request<
      JsonEnvelope<{
        source: string;
        metrics: {
          queuedJobs: number;
          runningJobs: number;
          terminalJobs: number;
          activeDevices: number;
        };
      }>
    >(baseUrl, "/api/v1/openalice/observability", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(observability.data.source, "bridge_fallback");
    assert.equal(observability.data.metrics.queuedJobs, 0);
    assert.equal(observability.data.metrics.runningJobs, 0);
    assert.ok(observability.data.metrics.terminalJobs >= 1);
    assert.equal(observability.data.metrics.activeDevices, 0);

    const auditLogs = await request<
      JsonEnvelope<Array<{ id: string; action: string; entityType: string }>>
    >(baseUrl, "/api/v1/audit-logs", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(Array.isArray(auditLogs.data));

    const filteredAuditLogs = await request<
      JsonEnvelope<Array<{ action: string; entityType: string }>>
    >(baseUrl, "/api/v1/audit-logs?action=create&entityType=theme", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(Array.isArray(filteredAuditLogs.data));

    const auditSummary = await request<
      JsonEnvelope<{
        windowHours: number;
        total: number;
        actions: Array<{ action: string; count: number }>;
        entities: Array<{ entityType: string; count: number }>;
      }>
    >(baseUrl, "/api/v1/audit-logs/summary?hours=24", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.equal(auditSummary.data.windowHours, 24);
    assert.ok(auditSummary.data.total >= 0);
    assert.ok(Array.isArray(auditSummary.data.actions));
    assert.ok(Array.isArray(auditSummary.data.entities));

    const richerAuditLogs = await request<
      JsonEnvelope<
        Array<{
          action: string;
          entityType: string;
          method?: string;
          role?: string;
        }>
      >
    >(baseUrl, "/api/v1/audit-logs?method=POST&role=Owner&search=theme", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(
      richerAuditLogs.data.every(
        (entry) => entry.method === "POST" && entry.role === "Owner"
      )
    );

    const auditExport = await fetch(
      `${baseUrl}/api/v1/audit-logs/export?format=csv&method=POST&search=theme`,
      {
        headers: { "x-workspace-slug": workspaceSlug }
      }
    );
    assert.equal(auditExport.status, 200);
    assert.match(auditExport.headers.get("content-type") ?? "", /text\/csv/);
    const auditExportBody = await auditExport.text();
    assert.match(auditExportBody, /created_at/);
    assert.match(auditExportBody, /payload_json/);

    const eventHistory = await request<
      JsonEnvelope<
        Array<{
          source: string;
          entityType: string;
          title: string;
        }>
      >
    >(baseUrl, "/api/v1/event-history?hours=24&limit=10&sources=audit,signal,plan,review,brief,openalice&search=smoke", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.ok(Array.isArray(eventHistory.data));
    assert.ok(eventHistory.data.some((entry) => entry.source === "signal"));

    const opsSnapshot = await request<
      JsonEnvelope<{
        generatedAt: string;
        stats: { companies: number; themes: number };
        openAlice: { queue: { reviewable: number } };
        latest: { companies: Array<{ id: string }> };
      }>
    >(baseUrl, "/api/v1/ops/snapshot?auditHours=24&recentLimit=5", {
      headers: { "x-workspace-slug": workspaceSlug }
    });
    assert.match(opsSnapshot.data.generatedAt, /\d{4}-\d{2}-\d{2}T/);
    assert.ok(opsSnapshot.data.stats.companies >= 1);
    assert.ok(opsSnapshot.data.stats.themes >= 1);
    assert.ok(Array.isArray(opsSnapshot.data.latest.companies));
    assert.ok(opsSnapshot.data.openAlice.queue.reviewable >= 0);

    console.log("Smoke API checks passed.");
  } catch (error) {
    const details = [
      error instanceof Error ? error.stack ?? error.message : String(error),
      stdout ? `--- stdout ---\n${stdout}` : "",
      stderr ? `--- stderr ---\n${stderr}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    throw new Error(details);
  } finally {
    if (!server.killed) {
      server.kill("SIGTERM");
      await delay(250);
      if (server.exitCode === null) {
        server.kill("SIGKILL");
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
