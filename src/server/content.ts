import { z } from "zod";
import { all, get, newId, now, run, tx } from "./db";
import { Actor, HttpError, audit, requireRole } from "./auth";
import { loadCheckContext } from "./knowledge";
import { checkText } from "@/core/checker";
import { findOutdatedClaims } from "@/core/impact";
import { suggestRewrites, type LlmStatus } from "./llm";
import { factHistoryValueAt } from "./content-helpers";
import type { Category, Confidence, Severity, Verdict } from "@/core/types";

export type AssetStatus = "draft" | "flagged" | "under_review" | "approved" | "changes_requested" | "rejected" | "needs_rereview";
export interface Asset { id: string; title: string; status: AssetStatus; current_version: number; created_by: string; created_at: string; updated_at: string }
export interface AssetVersion { version: number; body: string; change_note: string; created_by: string; created_at: string }
export interface Finding {
  id: string; run_id: string; asset_id: string; asset_version: number; category: Category; severity: Severity; verdict: Verdict;
  text: string; start_offset: number; end_offset: number; explanation: string; fact_id: string | null; fact_version: number | null;
  rule_id: string | null; evidence_id: string | null; evidence_required: number; suggestion: string | null; suggestion_source: string;
  confidence: Confidence; review_status: "open" | "accepted" | "edited" | "rejected"; resolved_text: string | null; created_at: string;
  evidence_title?: string | null; evidence_reference?: string | null; fact_label?: string | null; rule_statement?: string | null;
}
export interface Run { id: string; asset_id: string; asset_version: number; llm_status: LlmStatus; summary: string; created_by: string; created_at: string }
export interface Decision { id: string; asset_version: number; decision: string; comment: string; reviewer: string; role: string; decided_at: string }

const bodySchema = z.string().trim().min(5, "Content is too short to check").max(20_000, "Content is limited to 20,000 characters");
const titleSchema = z.string().trim().min(2).max(160);

async function getAssetRow(brandId: string, id: string): Promise<Asset> {
  const a = await get<Asset>("SELECT id, title, status, current_version, created_by, created_at, updated_at FROM assets WHERE id = ? AND brand_id = ?", id, brandId);
  if (!a) throw new HttpError(404, "Asset not found for this brand");
  return a;
}

/** Row-locks the asset (SELECT ... FOR UPDATE) so concurrent writers on the same asset run one after another. Use inside tx(). */
async function lockAsset(brandId: string, id: string): Promise<Asset> {
  const a = await get<Asset>("SELECT id, title, status, current_version, created_by, created_at, updated_at FROM assets WHERE id = ? AND brand_id = ? FOR UPDATE", id, brandId);
  if (!a) throw new HttpError(404, "Asset not found for this brand");
  return a;
}

export async function listAssets(brandId: string): Promise<(Asset & { open_findings: number; open_impacts: number })[]> {
  return await all<Asset & { open_findings: number; open_impacts: number }>(
    `SELECT a.id, a.title, a.status, a.current_version, a.created_by, a.created_at, a.updated_at,
       (SELECT COUNT(*) FROM findings f WHERE f.asset_id = a.id AND f.review_status = 'open' AND f.verdict != 'supported'
          AND f.run_id = (SELECT r.id FROM analysis_runs r WHERE r.asset_id = a.id ORDER BY r.created_at DESC, r.seq DESC LIMIT 1)) AS open_findings,
       (SELECT COUNT(*) FROM impacts i WHERE i.asset_id = a.id AND i.status = 'open') AS open_impacts
     FROM assets a WHERE a.brand_id = ? ORDER BY a.updated_at DESC, a.seq DESC`, brandId);
}

/** Creates an asset with version 1. A byte-identical submission within 15s returns the existing asset (double-click guard). */
export async function createAsset(brandId: string, actor: Actor, input: { title: string; body: string }): Promise<Asset> {
  const title = titleSchema.parse(input.title);
  const body = bodySchema.parse(input.body);
  const dup = await get<Asset>(
    `SELECT a.id, a.title, a.status, a.current_version, a.created_by, a.created_at, a.updated_at FROM assets a
       JOIN asset_versions v ON v.asset_id = a.id AND v.version = 1
      WHERE a.brand_id = ? AND a.title = ? AND v.body = ? AND a.created_by = ? AND a.created_at > ?`,
    brandId, title, body, actor.name, new Date(Date.now() - 15_000).toISOString());
  if (dup) return dup;
  return await tx(async () => {
    const id = newId("AS");
    const t = now();
    await run("INSERT INTO assets (id, brand_id, title, status, current_version, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", id, brandId, title, "draft", 1, actor.name, t, t);
    await run("INSERT INTO asset_versions (id, brand_id, asset_id, version, body, change_note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)", newId("AV"), brandId, id, 1, body, "Original submission", actor.name, t);
    await audit(brandId, actor, "asset.created", "asset", id, title);
    return await getAssetRow(brandId, id);
  });
}

async function addVersion(brandId: string, actor: Actor, assetId: string, body: string, note: string): Promise<number> {
  const a = await lockAsset(brandId, assetId); // serialises concurrent version creation; the next number is read under the lock
  const version = a.current_version + 1;
  const t = now();
  await run("INSERT INTO asset_versions (id, brand_id, asset_id, version, body, change_note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)", newId("AV"), brandId, assetId, version, body, note, actor.name, t);
  await run("UPDATE assets SET current_version=?, status='draft', updated_at=? WHERE id=? AND brand_id=?", version, t, assetId, brandId);
  return version;
}

export async function editAsset(brandId: string, actor: Actor, assetId: string, input: { body: string; note?: string }): Promise<Asset> {
  const body = bodySchema.parse(input.body);
  const a = await getAssetRow(brandId, assetId);
  const cur = (await get<{ body: string }>("SELECT body FROM asset_versions WHERE asset_id = ? AND version = ?", assetId, a.current_version))!;
  if (cur.body === body) throw new HttpError(400, "No change to save");
  return await tx(async () => {
    const v = await addVersion(brandId, actor, assetId, body, input.note?.slice(0, 200) || "Manual edit");
    await audit(brandId, actor, "asset.version_created", "asset", assetId, `v${v}: manual edit`);
    return await getAssetRow(brandId, assetId);
  });
}

function sentenceAround(body: string, s: number, e: number): string {
  let a = s; while (a > 0 && !/[.!?\n]/.test(body[a - 1])) a--;
  let b = e; while (b < body.length && !/[.!?\n]/.test(body[b])) b++;
  return body.slice(a, Math.min(b + 1, body.length)).trim().slice(0, 300);
}

/** Runs the deterministic checker (+ optional LLM rewrite drafts) against the latest saved version and persists everything. */
export async function runCheck(brandId: string, actor: Actor, assetId: string, opts: { llm?: boolean } = {}): Promise<{ run: Run; findings: Finding[] }> {
  const asset = await getAssetRow(brandId, assetId);
  const ver = (await get<{ body: string }>("SELECT body FROM asset_versions WHERE asset_id = ? AND version = ? AND brand_id = ?", assetId, asset.current_version, brandId))!;
  const ctx = await loadCheckContext(brandId);
  const result = checkText(ver.body, ctx);

  // Optional LLM pass: rewrite drafts only where no deterministic suggestion exists and the finding is not a numeric conflict.
  const wants = result.findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.verdict !== "supported" && f.suggestion === null);
  const llm = opts.llm === false ? { status: "not_configured" as LlmStatus, rewrites: new Map<number, string>() } : await suggestRewrites(wants.map(({ f, i }) => ({ id: i, text: f.text, sentence: sentenceAround(ver.body, f.start, f.end), reason: f.explanation })));
  const llmRewrites = llm.rewrites;

  return await tx(async () => {
    const runId = newId("RUN");
    const t = now();
    const issues = result.findings.filter((f) => f.verdict !== "supported").length;
    const summary = `${result.findings.length} finding(s), ${issues} need attention; ${result.notAutomated.length} ambiguous approved rule(s) not auto-enforced`;
    await run("INSERT INTO analysis_runs (id, brand_id, asset_id, asset_version, llm_status, summary, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)", runId, brandId, assetId, asset.current_version, llm.status, summary, actor.name, t);
    for (const [i, f] of result.findings.entries()) {
      const rewrite = llmRewrites.get(i);
      await run(
        `INSERT INTO findings (id, brand_id, run_id, asset_id, asset_version, category, severity, verdict, text, start_offset, end_offset, explanation, fact_id, fact_version, rule_id, evidence_id, evidence_required, suggestion, suggestion_source, confidence, review_status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId("F"), brandId, runId, assetId, asset.current_version, f.category, f.severity, f.verdict, f.text, f.start, f.end, f.explanation,
        f.factId ?? null, f.factVersion ?? null, f.ruleId ?? null, f.evidenceId ?? null, f.evidenceRequired ? 1 : 0,
        rewrite ?? f.suggestion, rewrite ? "llm" : "deterministic", f.confidence, "open", t);
    }
    // Status: only drafts/flagged/changes/rereview move automatically; under_review and approved are human states.
    if (["draft", "flagged", "changes_requested", "needs_rereview"].includes(asset.status)) {
      await run("UPDATE assets SET status=?, updated_at=? WHERE id=? AND brand_id=?", issues ? "flagged" : "draft", t, assetId, brandId);
    }
    // An outdated-claim impact resolves only if the latest text no longer contains the old value.
    for (const imp of await all<{ id: string; fact_id: string; old_version: number; new_version: number }>("SELECT id, fact_id, old_version, new_version FROM impacts WHERE asset_id = ? AND brand_id = ? AND status = 'open'", assetId, brandId)) {
      const hv = await factHistoryValueAt(brandId, imp.fact_id, imp.old_version, imp.new_version);
      if (hv && findOutdatedClaims(ver.body, hv.old, hv.next).length === 0) {
        await run("UPDATE impacts SET status='resolved', resolved_at=? WHERE id=?", t, imp.id);
        await audit(brandId, actor, "impact.resolved", "impact", imp.id, `Outdated claim no longer present in "${asset.title}" v${asset.current_version}`);
      }
    }
    await audit(brandId, actor, "check.run", "asset", assetId, `v${asset.current_version}: ${summary}; LLM: ${llm.status}`);
    return { run: await getRun(brandId, runId), findings: await listFindings(brandId, runId) };
  });
}

async function getRun(brandId: string, id: string): Promise<Run> {
  return (await get<Run>("SELECT id, asset_id, asset_version, llm_status, summary, created_by, created_at FROM analysis_runs WHERE id = ? AND brand_id = ?", id, brandId))!;
}

export async function listFindings(brandId: string, runId: string): Promise<Finding[]> {
  return await all<Finding>(
    `SELECT f.*, e.title AS evidence_title, e.reference AS evidence_reference,
            (fa.product || ' ' || fa.attribute) AS fact_label, r.statement AS rule_statement
       FROM findings f
       LEFT JOIN evidence e ON e.id = f.evidence_id
       LEFT JOIN facts fa ON fa.id = f.fact_id
       LEFT JOIN rules r ON r.id = f.rule_id
      WHERE f.brand_id = ? AND f.run_id = ? ORDER BY f.start_offset`, brandId, runId);
}

export async function getAssetDetail(brandId: string, assetId: string) {
  const asset = await getAssetRow(brandId, assetId);
  const versions = await all<AssetVersion>("SELECT version, body, change_note, created_by, created_at FROM asset_versions WHERE asset_id = ? AND brand_id = ? ORDER BY version DESC", assetId, brandId);
  const lastRun = await get<Run>("SELECT id, asset_id, asset_version, llm_status, summary, created_by, created_at FROM analysis_runs WHERE asset_id = ? AND brand_id = ? ORDER BY created_at DESC, seq DESC LIMIT 1", assetId, brandId) ?? null;
  const findings = lastRun ? await listFindings(brandId, lastRun.id) : [];
  const decisions = await all<Decision>("SELECT id, asset_version, decision, comment, reviewer, role, decided_at FROM review_decisions WHERE asset_id = ? AND brand_id = ? ORDER BY decided_at DESC, seq DESC", assetId, brandId);
  const impacts = await all<{ id: string }>("SELECT id FROM impacts WHERE asset_id = ? AND brand_id = ?", assetId, brandId);
  return { asset, versions, lastRun, findings, decisions, impactCount: impacts.length };
}

export const findingAction = z.object({
  action: z.enum(["accept", "edit", "reject"]),
  replacement: z.string().max(300).optional(),
});

/** Accept/edit applies a replacement to the latest text as a NEW version (original preserved). Reject only records the dismissal. */
export async function applyFinding(brandId: string, actor: Actor, findingId: string, input: z.input<typeof findingAction>): Promise<Asset> {
  const v = findingAction.parse(input);
  // Everything below runs in one transaction holding row locks on the finding and the asset, so a concurrent accept,
  // edit or dismissal of the same finding cannot also apply, and the replacement is applied to the text as it is NOW.
  return await tx(async () => {
    const f = await get<Finding>("SELECT * FROM findings WHERE id = ? AND brand_id = ? FOR UPDATE", findingId, brandId);
    if (!f) throw new HttpError(404, "Finding not found for this brand");
    if (f.review_status !== "open") throw new HttpError(409, `Finding already ${f.review_status}`);
    if (v.action === "reject") {
      await run("UPDATE findings SET review_status='rejected' WHERE id=?", findingId);
      await audit(brandId, actor, "finding.rejected", "finding", findingId, `Dismissed suggestion for "${f.text}"`);
      return await getAssetRow(brandId, f.asset_id);
    }
    const replacement = v.action === "accept" ? f.suggestion : v.replacement;
    if (replacement === null || replacement === undefined) throw new HttpError(400, "This finding has no suggestion; edit the text manually or supply a replacement");
    const asset = await lockAsset(brandId, f.asset_id);
    const cur = (await get<{ body: string }>("SELECT body FROM asset_versions WHERE asset_id = ? AND version = ?", f.asset_id, asset.current_version))!;
    const body = cur.body;
    const at = f.asset_version === asset.current_version && body.slice(f.start_offset, f.end_offset) === f.text ? f.start_offset : body.indexOf(f.text);
    if (at < 0) throw new HttpError(409, `"${f.text}" is no longer in the current text. Recheck the content.`);
    let next = body.slice(0, at) + replacement + body.slice(at + f.text.length);
    if (!replacement) next = next.replace(/ {2,}/g, " ").replace(/ +([.,!?])/g, "$1");
    if (next.trim().length < 5) throw new HttpError(400, "Result would be empty");
    const ver = await addVersion(brandId, actor, f.asset_id, next, `${v.action === "accept" ? "Accepted" : "Edited"} suggestion ${f.id}: "${f.text}" -> "${replacement}"`);
    await run("UPDATE findings SET review_status=?, resolved_text=? WHERE id=?", v.action === "accept" ? "accepted" : "edited", replacement, findingId);
    await audit(brandId, actor, v.action === "accept" ? "finding.accepted" : "finding.edited", "finding", findingId, `v${ver}: "${f.text}" -> "${replacement}"`);
    return await getAssetRow(brandId, f.asset_id);
  });
}

export async function submitForReview(brandId: string, actor: Actor, assetId: string): Promise<Asset> {
  return await tx(async () => {
    const a = await lockAsset(brandId, assetId); // a concurrent submit, edit or decision waits, then re-validates against fresh state
    if (!await latestRunForCurrentVersion(brandId, a)) throw new HttpError(409, "Run a check on the current version before submitting for review");
    if (!["draft", "flagged", "changes_requested", "needs_rereview"].includes(a.status)) throw new HttpError(409, `Cannot submit an asset that is ${a.status}`);
    await run("UPDATE assets SET status='under_review', updated_at=? WHERE id=?", now(), assetId);
    await audit(brandId, actor, "asset.submitted", "asset", assetId, `v${a.current_version} submitted for review`);
    return await getAssetRow(brandId, assetId);
  });
}

async function latestRunForCurrentVersion(brandId: string, a: Asset): Promise<Run | null> {
  return await get<Run>("SELECT id, asset_id, asset_version, llm_status, summary, created_by, created_at FROM analysis_runs WHERE asset_id = ? AND brand_id = ? AND asset_version = ? ORDER BY created_at DESC, seq DESC LIMIT 1", a.id, brandId, a.current_version) ?? null;
}

export const decisionInput = z.object({ decision: z.enum(["approved", "changes_requested", "rejected"]), comment: z.string().trim().max(1000).default("") });

/** Records a human decision against the exact version reviewed. Approval is blocked by unresolved conflicts. */
export async function decide(brandId: string, actor: Actor, assetId: string, input: z.input<typeof decisionInput>): Promise<Asset> {
  requireRole(actor, ["reviewer", "manager"], "approve, reject or request changes");
  const v = decisionInput.parse(input);
  // Validation and the write share one transaction under the asset's row lock: an edit that lands first changes the
  // current version, so the "has this version been checked" test below fails with 409 instead of approving stale text.
  return await tx(async () => {
    const a = await lockAsset(brandId, assetId);
    const r = await latestRunForCurrentVersion(brandId, a);
    if (!r) throw new HttpError(409, "The current version has not been checked yet. Run a check before deciding.");
    if (v.decision === "approved") {
      const open = (await listFindings(brandId, r.id)).filter((f) => f.review_status === "open" && f.verdict !== "supported");
      if (open.some((f) => f.verdict === "conflict")) throw new HttpError(409, "Cannot approve: unresolved conflicts remain. Fix them, dismiss the finding (a human override recorded in the audit log), or request changes.");
      if (open.length && !v.comment) throw new HttpError(409, `Cannot approve ${open.length} unresolved item(s) without a comment explaining the human verification.`);
      const imp = await all("SELECT id FROM impacts WHERE asset_id = ? AND status = 'open'", assetId);
      if (imp.length) throw new HttpError(409, "Cannot approve: an outdated claim from a changed fact is still open. Fix the text and recheck.");
    }
    if (v.decision !== "approved" && !v.comment) throw new HttpError(400, "A comment is required when requesting changes or rejecting");
    const t = now();
    await run("INSERT INTO review_decisions (id, brand_id, asset_id, asset_version, decision, comment, reviewer, role, decided_at) VALUES (?,?,?,?,?,?,?,?,?)", newId("RD"), brandId, assetId, a.current_version, v.decision, v.comment, actor.name, actor.role, t);
    await run("UPDATE assets SET status=?, updated_at=? WHERE id=?", v.decision, t, assetId);
    await audit(brandId, actor, `review.${v.decision}`, "asset", assetId, `v${a.current_version}${v.comment ? `: ${v.comment}` : ""}`);
    return await getAssetRow(brandId, assetId);
  });
}
