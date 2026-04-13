import { serve } from "@hono/node-server";
import type { Context } from "hono";
import {
  type AppSession,
  companyCreateInputSchema,
  companyUpdateInputSchema,
  dailyBriefCreateInputSchema,
  reviewEntryCreateInputSchema,
  signalCreateInputSchema,
  signalUpdateInputSchema,
  themeCreateInputSchema,
  themeUpdateInputSchema,
  tradePlanCreateInputSchema,
  tradePlanUpdateInputSchema
} from "@iuf-trading-room/contracts";
import {
  getTradingRoomRepository,
  type TradingRoomRepository
} from "@iuf-trading-room/domain";
import { runImport } from "@iuf-trading-room/integrations";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";

import {
  authenticateOpenAliceDevice,
  claimOpenAliceJob,
  enqueueOpenAliceJob,
  heartbeatOpenAliceDevice,
  listOpenAliceJobs,
  openAliceClaimJobSchema,
  openAliceEnqueueJobSchema,
  openAliceJobResultSchema,
  openAliceRegisterSchema,
  registerOpenAliceDevice,
  submitOpenAliceResult
} from "./openalice-bridge.js";

type Variables = {
  repo: TradingRoomRepository;
  session: AppSession;
};

const app = new Hono<{ Variables: Variables }>();
const repository = getTradingRoomRepository();

app.use("*", cors({ origin: "*" }));

app.use("/api/v1/*", async (c, next) => {
  const workspaceSlug = c.req.header("x-workspace-slug") ?? process.env.DEFAULT_WORKSPACE_SLUG;
  const roleHeader = c.req.header("x-user-role");
  const allowedRoles = ["Owner", "Admin", "Analyst", "Trader", "Viewer"] as const;
  const roleOverride = allowedRoles.find((role) => role === roleHeader);

  const session = await repository.getSession({
    workspaceSlug,
    roleOverride
  });

  c.set("repo", repository);
  c.set("session", session);
  await next();
});

app.use("/api/*", async (c, next) => {
  await next();

  if (!["POST", "PATCH", "DELETE"].includes(c.req.method)) {
    return;
  }

  const session = c.var.session;
  console.log(
    JSON.stringify({
      audit: true,
      ts: new Date().toISOString(),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      workspace: session?.workspace.slug ?? null,
      role: session?.user.role ?? null
    })
  );
});

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json(
      {
        error: "validation_error",
        details: error.flatten()
      },
      400
    );
  }

  console.error(error);
  return c.json({ error: "internal_server_error" }, 500);
});

function getBearerToken(c: Context) {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function requireOpenAliceDevice(c: Context, deviceId: string) {
  const token = getBearerToken(c);
  if (!token) {
    return c.json({ error: "openalice_token_required" }, 401);
  }

  const device = await authenticateOpenAliceDevice({
    deviceId,
    token
  });

  if (!device) {
    return c.json({ error: "openalice_device_auth_failed" }, 401);
  }

  return device;
}

async function handleOpenAliceJobClaim(c: Context) {
  const payload = openAliceClaimJobSchema.parse(await c.req.json().catch(() => ({})));
  const deviceOrResponse = await requireOpenAliceDevice(c, payload.deviceId);
  if (deviceOrResponse instanceof Response) {
    return deviceOrResponse;
  }

  const job = await claimOpenAliceJob(deviceOrResponse);
  if (!job) {
    return c.body(null, 204);
  }

  return c.json({ data: job });
}

async function handleOpenAliceJobHeartbeat(c: Context) {
  const deviceId = c.req.header("x-device-id");
  if (!deviceId) {
    return c.json({ error: "x-device-id_required" }, 400);
  }

  const deviceOrResponse = await requireOpenAliceDevice(c, deviceId);
  if (deviceOrResponse instanceof Response) {
    return deviceOrResponse;
  }

  const heartbeat = await heartbeatOpenAliceDevice(deviceOrResponse, c.req.param("jobId"));
  return c.json({ data: heartbeat });
}

async function handleOpenAliceJobResult(c: Context) {
  const deviceId = c.req.header("x-device-id");
  if (!deviceId) {
    return c.json({ error: "x-device-id_required" }, 400);
  }

  const payload = openAliceJobResultSchema.parse(await c.req.json());
  const jobId = c.req.param("jobId");
  if (payload.jobId !== jobId) {
    return c.json({ error: "job_id_mismatch" }, 400);
  }

  const deviceOrResponse = await requireOpenAliceDevice(c, deviceId);
  if (deviceOrResponse instanceof Response) {
    return deviceOrResponse;
  }

  const result = await submitOpenAliceResult({
    device: deviceOrResponse,
    result: payload
  });

  if (!result) {
    return c.json({ error: "openalice_job_not_found" }, 404);
  }

  return c.json({ data: result });
}

app.get("/", (c) =>
  c.json({
    name: "IUF Trading Room API",
    status: "ok"
  })
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    uptime: process.uptime()
  })
);

app.get("/api/v1/session", (c) =>
  c.json({
    data: c.get("session")
  })
);

app.get("/api/v1/themes", async (c) =>
  c.json({
    data: await c.get("repo").listThemes({
      workspaceSlug: c.get("session").workspace.slug
    })
  })
);

app.post("/api/v1/themes", async (c) => {
  const payload = themeCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createTheme(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/themes/:id", async (c) => {
  const theme = await c.get("repo").getTheme(c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!theme) {
    return c.json({ error: "theme_not_found" }, 404);
  }

  return c.json({ data: theme });
});

app.patch("/api/v1/themes/:id", async (c) => {
  const payload = themeUpdateInputSchema.parse(await c.req.json());
  const theme = await c.get("repo").updateTheme(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!theme) {
    return c.json({ error: "theme_not_found" }, 404);
  }

  return c.json({ data: theme });
});

app.get("/api/v1/companies", async (c) => {
  const themeId = c.req.query("themeId");
  return c.json({
    data: await c.get("repo").listCompanies(themeId, {
      workspaceSlug: c.get("session").workspace.slug
    })
  });
});

app.post("/api/v1/companies", async (c) => {
  const payload = companyCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createCompany(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/companies/:id", async (c) => {
  const company = await c.get("repo").getCompany(c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: company });
});

app.patch("/api/v1/companies/:id", async (c) => {
  const payload = companyUpdateInputSchema.parse(await c.req.json());
  const company = await c.get("repo").updateCompany(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: company });
});

app.get("/api/v1/signals", async (c) => {
  const themeId = c.req.query("themeId");
  const companyId = c.req.query("companyId");
  const category = c.req.query("category");
  return c.json({
    data: await c.get("repo").listSignals(
      { themeId, companyId, category },
      { workspaceSlug: c.get("session").workspace.slug }
    )
  });
});

app.post("/api/v1/signals", async (c) => {
  const payload = signalCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createSignal(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/signals/:id", async (c) => {
  const signal = await c.get("repo").getSignal(c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!signal) {
    return c.json({ error: "signal_not_found" }, 404);
  }
  return c.json({ data: signal });
});

app.patch("/api/v1/signals/:id", async (c) => {
  const payload = signalUpdateInputSchema.parse(await c.req.json());
  const signal = await c.get("repo").updateSignal(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!signal) {
    return c.json({ error: "signal_not_found" }, 404);
  }
  return c.json({ data: signal });
});

app.get("/api/v1/plans", async (c) => {
  const companyId = c.req.query("companyId");
  const status = c.req.query("status");
  return c.json({
    data: await c.get("repo").listTradePlans(
      { companyId, status },
      { workspaceSlug: c.get("session").workspace.slug }
    )
  });
});

app.post("/api/v1/plans", async (c) => {
  const payload = tradePlanCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createTradePlan(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/plans/:id", async (c) => {
  const plan = await c.get("repo").getTradePlan(c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!plan) {
    return c.json({ error: "plan_not_found" }, 404);
  }
  return c.json({ data: plan });
});

app.patch("/api/v1/plans/:id", async (c) => {
  const payload = tradePlanUpdateInputSchema.parse(await c.req.json());
  const plan = await c.get("repo").updateTradePlan(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!plan) {
    return c.json({ error: "plan_not_found" }, 404);
  }
  return c.json({ data: plan });
});

app.get("/api/v1/reviews", async (c) => {
  const tradePlanId = c.req.query("tradePlanId");
  return c.json({
    data: await c.get("repo").listReviews(
      { tradePlanId },
      { workspaceSlug: c.get("session").workspace.slug }
    )
  });
});

app.post("/api/v1/reviews", async (c) => {
  const payload = reviewEntryCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createReview(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/briefs", async (c) =>
  c.json({
    data: await c.get("repo").listBriefs({
      workspaceSlug: c.get("session").workspace.slug
    })
  })
);

app.post("/api/v1/briefs", async (c) => {
  const payload = dailyBriefCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createBrief(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.post("/api/v1/openalice/register", async (c) => {
  const payload = openAliceRegisterSchema.parse(await c.req.json());
  const registration = await registerOpenAliceDevice({
    workspaceSlug: c.get("session").workspace.slug,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    capabilities: payload.capabilities
  });

  return c.json({ data: registration }, 201);
});

app.get("/api/v1/openalice/jobs", async (c) =>
  c.json({
    data: await listOpenAliceJobs(c.get("session").workspace.slug)
  })
);

app.post("/api/v1/openalice/jobs", async (c) => {
  const payload = openAliceEnqueueJobSchema.parse(await c.req.json());
  const job = await enqueueOpenAliceJob({
    workspaceSlug: c.get("session").workspace.slug,
    taskType: payload.taskType,
    schemaName: payload.schemaName,
    instructions: payload.instructions,
    contextRefs: payload.contextRefs,
    parameters: payload.parameters,
    timeoutSeconds: payload.timeoutSeconds
  });

  return c.json({ data: job }, 201);
});

app.post("/api/internal/openalice/jobs/claim", handleOpenAliceJobClaim);
app.post("/api/internal/openalice/jobs/:jobId/heartbeat", handleOpenAliceJobHeartbeat);
app.post("/api/internal/openalice/jobs/:jobId/result", handleOpenAliceJobResult);

// Compatibility aliases for earlier v1 bridge testing.
app.post("/api/v1/openalice/jobs/claim", handleOpenAliceJobClaim);
app.post("/api/v1/openalice/jobs/:jobId/heartbeat", handleOpenAliceJobHeartbeat);
app.post("/api/v1/openalice/jobs/:jobId/result", handleOpenAliceJobResult);

app.post("/api/v1/import/my-tw-coverage", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const typed = body as Record<string, unknown>;
  const coveragePath =
    (typed.coveragePath as string | undefined) ??
    process.env.MY_TW_COVERAGE_PATH;

  if (!coveragePath) {
    return c.json(
      { error: "coveragePath is required (body or MY_TW_COVERAGE_PATH env)" },
      400
    );
  }

  const result = runImport({ coveragePath });
  const persist = typed.persist === true;
  let persisted = 0;
  const persistErrors: string[] = [];

  if (persist) {
    const repo = c.get("repo");
    const options = { workspaceSlug: c.get("session").workspace.slug };

    for (const seed of result.companies) {
      try {
        await repo.createCompany(
          {
            name: seed.displayName,
            ticker: seed.ticker,
            market: "TWSE",
            country: "TW",
            themeIds: [],
            chainPosition: seed.industry ?? "Unknown",
            beneficiaryTier: "Observation",
            exposure: { volume: 1, asp: 1, margin: 1, capacity: 1, narrative: 1 },
            validation: { capitalFlow: "N/A", consensus: "N/A", relativeStrength: "N/A" },
            notes:
              [seed.summary, seed.sector ? `Sector: ${seed.sector}` : ""]
                .filter(Boolean)
                .join("\n")
                .slice(0, 1500) || "Imported from My-TW-Coverage"
          },
          options
        );
        persisted++;
      } catch (error) {
        persistErrors.push(
          `${seed.ticker}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return c.json({
    data: {
      companiesCount: result.companies.length,
      relationsCount: result.relations.length,
      themeKeywordsCount: result.themeKeywords.length,
      warningsCount: result.warnings.length,
      sourcesCount: result.sources.length,
      ...(persist ? { persisted, persistErrors: persistErrors.slice(0, 50) } : {}),
      companies: result.companies.slice(0, 50),
      warnings: result.warnings.slice(0, 50),
      themeKeywords: result.themeKeywords.slice(0, 50)
    }
  });
});

const port = Number(process.env.PORT ?? 3001);

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`IUF Trading Room API listening on http://localhost:${info.port}`);
  }
);
