import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config redirects", () => {
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
