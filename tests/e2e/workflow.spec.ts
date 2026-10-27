import { expect, test, type Page } from "@playwright/test";

const setRole = async (page: Page, role: "creator" | "reviewer" | "manager") => {
  await page.getByTestId("role-select").selectOption(role);
  await expect(page.getByTestId("role-select")).toHaveValue(role);
  await page.waitForTimeout(300);
};

test("brand governance workflow end to end", async ({ page }) => {
  page.on("dialog", (d) => d.accept());

  // 1. Load the demo brand (reset gives a known state).
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByTestId("reset-demo").click();
  await expect(page.getByText("NovaTech (fictional demo brand)").first()).toBeVisible();
  await expect(page.getByText("Assets with a decision")).toBeVisible();

  // 2. Register an approved fact with evidence (Brand Manager).
  await page.goto("/knowledge");
  await page.getByLabel("Attribute").fill("Weight");
  await page.getByLabel("Approved value").fill("190");
  await page.getByLabel("Unit").fill("grams");
  await page.getByLabel(/Keywords/).fill("weight, weighs");
  await page.getByLabel("Evidence title (optional)").fill("Weight test report (fictional)");
  await page.getByLabel("Evidence reference").fill("DOC-NOVA-WT-001");
  await page.getByRole("button", { name: "Register fact" }).click();
  await expect(page.getByTestId("fact-value-Weight")).toContainText("190 grams");

  // 3. Submit content containing a wrong number and an old battery claim.
  await page.goto("/checker");
  await page.getByLabel("Title").fill("E2E ad");
  await page.getByLabel("Marketing copy").fill("NovaPhone X is thoughtfully designed, weighs 210 grams and offers up to 40 hours of battery life.");
  await page.getByTestId("check-content").click();
  await expect(page).toHaveURL(/\/content\/AS-/);

  // 4. Findings: conflict with evidence reference, supported claim.
  const conflict = page.locator('[data-testid="finding"][data-verdict="conflict"]');
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toContainText("210 grams");
  await expect(conflict).toContainText("DOC-NOVA-WT-001");
  await expect(conflict).toContainText("190 grams");
  await expect(page.locator('[data-testid="finding"][data-verdict="supported"]')).toHaveCount(1);

  // Creator cannot approve (role enforcement is server-side too).
  await setRole(page, "creator");
  await expect(page.getByTestId("approve")).toBeDisabled();

  // 5. Accept the suggestion, recheck.
  await conflict.getByTestId("accept").click();
  await expect(page.getByTestId("recheck")).toBeEnabled();
  await page.getByTestId("recheck").click();
  await expect(page.locator('[data-testid="finding"][data-verdict="conflict"]')).toHaveCount(0);
  await expect(page.getByTestId("asset-body")).toContainText("190 grams");
  await expect(page.getByText("Status:").locator("..")).toContainText("Draft");

  // 6. Reviewer approves (a real recorded decision).
  await setRole(page, "reviewer");
  await page.getByTestId("decision-comment").fill("Checked against spec sheet");
  await page.getByTestId("approve").click();
  await expect(page.getByText(/Approved by a human reviewer/)).toBeVisible();
  const url = page.url();

  // 7. Manager changes the battery fact 40 -> 32.
  await setRole(page, "manager");
  await page.goto("/knowledge");
  await page.getByTestId("change-Battery life").click();
  await page.getByTestId("new-value").fill("32");
  await page.getByTestId("change-reason").fill("Spec sheet rev B");
  await page.getByTestId("save-fact").click();
  await expect(page.getByTestId("fact-value-Battery life")).toContainText("32 hours");

  // 8. The previously approved asset is flagged for re-review.
  await page.goto("/queue");
  const row = page.getByTestId("queue-table").locator("tr", { hasText: "E2E ad" });
  await expect(row).toContainText("Outdated: re-review");
  await page.getByTestId("queue-search").fill("E2E");
  await expect(row).toBeVisible();
  await page.goto("/ledger");
  await expect(page.getByTestId("impact-table")).toContainText("40 hours");

  // 9. Open the asset, see old vs new, fix and recheck; impact resolves.
  await page.goto(url);
  await expect(page.getByTestId("impact")).toContainText("32");
  await page.getByTestId("recheck").click();
  await page.locator('[data-testid="finding"][data-verdict="conflict"]').getByTestId("accept").click();
  await page.getByTestId("recheck").click();
  await expect(page.getByTestId("impact")).toHaveCount(0);

  // Audit trail has the key events with actors.
  await page.goto("/audit");
  const audit = page.getByTestId("audit-table");
  for (const a of ["fact.updated", "review.approved", "asset.flagged_outdated", "finding.accepted", "impact.resolved"]) await expect(audit).toContainText(a);
  await expect(audit).toContainText("Meera (Brand Manager)");
  await expect(audit).toContainText("Ravi (Reviewer)");
});

test("guideline calibration: proposals stay draft until approved", async ({ page }) => {
  await page.goto("/calibration");
  await setRole(page, "manager");
  await page.getByLabel("Title", { exact: true }).fill("Social tone");
  await page.getByTestId("guideline-text").fill('Never use the word "revolutionary". Keep it friendly.');
  await page.getByTestId("add-guideline").click();
  await expect(page.getByText("Social tone")).toBeVisible();
  await page.getByTestId("propose-rules").last().click();
  const draft = page.locator('[data-testid="rule"][data-status="draft"]', { hasText: "revolutionary" });
  await expect(draft).toBeVisible({ timeout: 10_000 });
  // draft is not enforced
  await page.getByTestId("rule-test-text").fill("A revolutionary phone");
  await page.getByTestId("run-rule-test").click();
  await expect(page.getByTestId("rule-test-result")).toContainText("0 finding");
  await draft.getByTestId("approve-rule").click();
  await expect(page.locator('[data-testid="rule"][data-status="approved"]', { hasText: "revolutionary" })).toBeVisible();
  await page.getByTestId("run-rule-test").click();
  await expect(page.getByTestId("rule-test-result")).toContainText("revolutionary");
  // the ambiguous tone rule is flagged for human review, not enforced
  await expect(page.locator('[data-kind="ambiguous"]').first()).toContainText("Needs human review");
});

test("evaluation page runs the real checker", async ({ page }) => {
  await page.goto("/evaluation");
  await page.getByTestId("run-eval").click();
  await expect(page.getByTestId("eval-report")).toContainText("cases matched their labels exactly");
});
