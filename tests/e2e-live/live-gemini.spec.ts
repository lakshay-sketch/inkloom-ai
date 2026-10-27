import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Makes at most TWO Gemini requests (one rewrite, one rule proposal), enforced by fetch-guard.mjs in the server.
// Synthetic content only. Run via playwright.live.config.ts; see docs/TESTING.md.
const GUARD_DIR = path.join(process.cwd(), ".data", "live-guard");
const slots = () => fs.readdirSync(GUARD_DIR).filter((f) => f.startsWith("slot-")).sort();
const guardLog = () => (fs.existsSync(path.join(GUARD_DIR, "guard.log")) ? fs.readFileSync(path.join(GUARD_DIR, "guard.log"), "utf8") : "");

test.skip(process.env.LIVE_GEMINI !== "1", "live Gemini test is opt-in (LIVE_GEMINI=1)");

test("live Gemini UI: AI rewrite draft, then AI rule proposal (max 2 requests)", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const setManager = async () => {
    await page.getByTestId("role-select").selectOption("manager");
    await expect(page.getByTestId("role-select")).toHaveValue("manager");
    await page.waitForTimeout(300);
  };

  // The throwaway DB was pre-seeded with the LLM off. Do NOT click "Reset demo": reseeding calls the LLM.
  await page.goto("/");
  await expect(page.getByText("NovaTech (fictional demo brand)").first()).toBeVisible();
  expect(slots()).toEqual([]);

  // Request 1: AI rewrite draft for a vague claim with no deterministic suggestion.
  await page.goto("/checker");
  await setManager();
  await page.getByLabel("Title").fill("Live UI test (synthetic)");
  await page.getByLabel("Marketing copy").fill("The NovaPhone X is rugged and long-lasting.");
  await page.getByTestId("check-content").click();
  await expect(page).toHaveURL(/\/content\/AS-/);
  await expect(page.getByText(/AI rewrites: on/)).toBeVisible();
  expect(slots()).toEqual(["slot-rewrites"]);
  await expect(page.getByText(/AI-drafted/).first()).toBeVisible();

  // Request 2: AI rule proposal from a synthetic guideline.
  await page.goto("/calibration");
  await setManager();
  await page.getByLabel("Title", { exact: true }).fill("Synthetic live guideline");
  await page.getByTestId("guideline-text").fill('Acme Demo style guide (synthetic). Never use the word "cheap". Keep the tone friendly. Avoid superlatives like "best".');
  await page.getByTestId("add-guideline").click();
  await expect(page.getByText("Synthetic live guideline")).toBeVisible();
  await page.getByTestId("propose-rules").last().click();
  await expect(page.getByRole("status")).toContainText("AI proposals: ok");
  expect(slots()).toEqual(["slot-rewrites", "slot-rules"]);

  // No blocked attempts: no retries or stray requests happened.
  expect(guardLog()).not.toContain("BLOCKED");
});
