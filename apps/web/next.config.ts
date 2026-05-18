import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@iuf-trading-room/contracts",
    "@iuf-trading-room/ui"
  ],
  async redirects() {
    return [
      {
        source: "/ideas",
        destination: "/ai-recommendations",
        statusCode: 301,
      },
      {
        source: "/lab",
        destination: "/quant-strategies",
        statusCode: 301,
      },
      {
        source: "/event-log",
        destination: "/admin/events",
        statusCode: 301,
      },
      {
        source: "/portfolio-snapshot",
        destination: "/admin/portfolio/snapshots",
        statusCode: 301,
      },
      {
        source: "/tool-center",
        destination: "/admin/tools",
        statusCode: 301,
      },
      {
        source: "/uta",
        destination: "/admin/uta/accounts",
        statusCode: 301,
      },
      // F2: /heatmap → /market-intel (楊董直接打 URL 找不到頁面 BUG #4 fix)
      {
        source: "/mobile/themes",
        destination: "/themes",
        statusCode: 301,
      },
      {
        source: "/mobile/themes/:path*",
        destination: "/themes/:path*",
        statusCode: 301,
      },
      {
        source: "/m/themes",
        destination: "/themes",
        statusCode: 301,
      },
      {
        source: "/m/themes/:path*",
        destination: "/themes/:path*",
        statusCode: 301,
      },
      {
        source: "/companies/themes",
        destination: "/themes",
        statusCode: 301,
      },
      {
        source: "/companies/themes/:path*",
        destination: "/themes/:path*",
        statusCode: 301,
      },
      {
        source: "/company-themes",
        destination: "/themes",
        statusCode: 301,
      },
      {
        source: "/company-themes/:path*",
        destination: "/themes/:path*",
        statusCode: 301,
      },
      {
        source: "/heatmap",
        destination: "/market-intel",
        statusCode: 301,
      },
      // F3: /news → /market-intel (同上)
      {
        source: "/news",
        destination: "/market-intel",
        statusCode: 301,
      },
    ];
  },
};

export default nextConfig;
