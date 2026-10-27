import { z } from "zod";
import { route, json } from "@/server/http";
import { listRules } from "@/server/knowledge";
import { checkText } from "@/core/checker";

/** Runs APPROVED rules only (no facts) against sample text. Nothing is saved. */
export const POST = route(async ({ req, brandId }) => {
  const { text } = z.object({ text: z.string().trim().min(3).max(5000) }).parse(await json(req));
  const rules = await listRules(brandId);
  const r = checkText(text, { facts: [], evidence: [], rules });
  return { findings: r.findings, notAutomated: r.notAutomated, approvedRules: rules.filter((x) => x.status === "approved").length };
});
