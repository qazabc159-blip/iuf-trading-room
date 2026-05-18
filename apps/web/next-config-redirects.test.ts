import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config redirects", () => {
  it("keeps product aliases on the canonical admin surfaces", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toBeDefined();

    const bySource = new Map((redirects ?? []).map((redirect) => [redirect.source, redirect]));

    expect(bySource.get("/event-log")).toMatchObject({
      destination: "/admin/events",
      statusCode: 301,
    });
    expect(bySource.get("/portfolio-snapshot")).toMatchObject({
      destination: "/admin/portfolio/snapshots",
      statusCode: 301,
    });
    expect(bySource.get("/portfolio-snapshots")).toMatchObject({
      destination: "/admin/portfolio/snapshots",
      statusCode: 301,
    });
    expect(bySource.get("/tool-center")).toMatchObject({
      destination: "/admin/tools",
      statusCode: 301,
    });
    expect(bySource.get("/uta")).toMatchObject({
      destination: "/admin/uta/accounts",
      statusCode: 301,
    });
  });

  it("keeps old theme entry points on the canonical desktop theme routes", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toBeDefined();

    const bySource = new Map((redirects ?? []).map((redirect) => [redirect.source, redirect]));

    expect(bySource.get("/mobile/themes")).toMatchObject({
      destination: "/themes",
      statusCode: 301,
    });
    expect(bySource.get("/mobile/themes/:path*")).toMatchObject({
      destination: "/themes/:path*",
      statusCode: 301,
    });
    expect(bySource.get("/m/themes/:path*")).toMatchObject({
      destination: "/themes/:path*",
      statusCode: 301,
    });
    expect(bySource.get("/companies/themes/:path*")).toMatchObject({
      destination: "/themes/:path*",
      statusCode: 301,
    });
    expect(bySource.get("/company-themes/:path*")).toMatchObject({
      destination: "/themes/:path*",
      statusCode: 301,
    });
  });
});
