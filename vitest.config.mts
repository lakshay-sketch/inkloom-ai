import { defineConfig } from "vitest/config";
import path from "node:path";

// testTimeout/hookTimeout are generous because embedded Postgres (PGlite) boots once per worker.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000, env: { DATABASE_PATH: ":memory:" }, pool: "forks" },
});
