import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@orgmarket/engine"],
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
