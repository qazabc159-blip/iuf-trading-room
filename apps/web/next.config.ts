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
    ];
  },
};

export default nextConfig;
