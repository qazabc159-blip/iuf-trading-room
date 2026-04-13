import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@iuf-trading-room/contracts",
    "@iuf-trading-room/ui"
  ]
};

export default nextConfig;
