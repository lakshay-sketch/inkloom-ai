import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    // Isolated throw-away database so e2e never touches .data/inkloom.db
    command: "npm run build && rm -rf .data/e2e.db && DATABASE_PATH=.data/e2e.db DEMO_ROLE_SWITCH=1 DEMO_RESET_ENABLED=1 ANTHROPIC_API_KEY= GEMINI_API_KEY= LLM_PROVIDER= npx next start -p 3100",
    url: "http://localhost:3100/evaluation",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
