import { defineConfig } from "@playwright/test";
import fs from "node:fs";

// OPT-IN live Gemini UI test. Never part of `npm run test:e2e` (that uses playwright.config.ts, testDir tests/e2e).
// Refuses to run unless LIVE_GEMINI=1, a GEMINI_API_KEY is in the environment, and the working directory has no
// .env.local (i.e. an isolated copy, so the build cannot overwrite the main project's .next or touch its data).
if (process.env.LIVE_GEMINI !== "1") throw new Error("Live Gemini UI test is opt-in: set LIVE_GEMINI=1");
if (!process.env.GEMINI_API_KEY && process.env.LIVE_GUARD_STUB !== "1") throw new Error("GEMINI_API_KEY must be provided in the environment");
if (fs.existsSync(".env.local")) throw new Error("Run from an isolated copy without .env.local (see docs/TESTING.md)");

const GUARD = `${process.cwd()}/tests/e2e-live/fetch-guard.mjs`;
const GUARD_DIR = `${process.cwd()}/.data/live-guard`;

export default defineConfig({
  testDir: "tests/e2e-live",
  timeout: 150_000,
  expect: { timeout: 45_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3200", trace: "retain-on-failure" },
  webServer: {
    // 1) build; 2) seed the throwaway DB on a temporary server with BOTH providers off (seeding itself calls the LLM
    // when one is configured); 3) start the live server on 3200 behind the fetch guard.
    command:
      `npm run build && rm -rf .data/e2e-live.db ${GUARD_DIR} && mkdir -p .data ${GUARD_DIR} && ` +
      `{ DATABASE_PATH=.data/e2e-live.db ANTHROPIC_API_KEY= GEMINI_API_KEY= LLM_PROVIDER= node node_modules/next/dist/bin/next start -p 3201 & SEED=$!; ` +
      `for i in $(seq 1 60); do curl -sf http://localhost:3201/evaluation >/dev/null && break; sleep 1; done; kill $SEED; wait $SEED 2>/dev/null; true; } && ` +
      `DATABASE_PATH=.data/e2e-live.db DEMO_ROLE_SWITCH=1 ANTHROPIC_API_KEY= LLM_PROVIDER=gemini GEMINI_MODEL=gemini-3.5-flash-lite ` +
      `LIVE_GUARD_DIR=${GUARD_DIR} NODE_OPTIONS="--import ${GUARD}" npx next start -p 3200`,
    url: "http://localhost:3200/evaluation",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
