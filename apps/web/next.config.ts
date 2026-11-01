import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (D20).
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@orgmarket/engine"],
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
