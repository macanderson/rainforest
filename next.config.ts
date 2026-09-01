import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16: Turbopack is the default bundler for dev and build.
  // Standalone output for the production Docker image (issue #15,
  // architecture.md §7.2 — one Lightsail box running the traced server.js).
  output: "standalone",
};

export default nextConfig;
