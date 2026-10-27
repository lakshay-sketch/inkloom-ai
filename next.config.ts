import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // Embedded PGlite (local dev/tests) is loaded lazily; keep it out of the server bundle. Migration SQL is read at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: { "/**": ["./db/migrations/*.sql"] },
};

export default nextConfig;
