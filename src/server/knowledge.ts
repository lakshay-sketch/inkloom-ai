import { z } from "zod";
import { all, get, newId, now, run, tx } from "./db";
import { Actor, HttpError, audit, requireRole } from "./auth";
import type { EvidenceLite, FactLite, RuleKind, RuleLite, Severity } from "@/core/types";
import { proposeRulesDeterministic, type CandidateRule } from "@/core/rulegen";
import { proposeRulesLLM } from "./llm";

export interface Brand { id: string; name: string; is_demo: number; tone: string; created_at: string }

export async function listBrands(): Promise<Brand[]> {
  return await all<Brand>("SELECT * FROM brands ORDER BY created_at, seq");
}
export async function getBrand(brandId: string): Promise<Brand> {
  const b = await get<Brand>("SELECT * FROM brands WHERE id = ?", brandId);
  if (!b) throw new HttpError(404, "Brand not found");
  return b;
}
export async function createBrand(name: string, tone = "", isDemo = false): Promise<Brand> {
  const id = newId("BR");
  await run("INSERT INTO brands (id, name, is_demo, tone, created_at) VALUES (?,?,?,?,?)", id, name, isDemo ? 1 : 0, tone, now());
  return await getBrand(id);
}

/* ---------- evidence ---------- */
export const evidenceInput = z.object({
  title: z.string().trim().min(2).max(160),
  reference: z.string().trim().min(2).max(300),
  excerpt: z.string().trim().max(2000).default(""),
});
export async function addEvidence(brandId: string, actor: Actor, input: z.infer<typeof evidenceInput>): Promise<EvidenceLite> {
  requireRole(actor, ["manager", "reviewer"], "register evidence");
  const v = evidenceInput.parse(input);
  const id = newId("EV");
  await run("INSERT INTO evidence (id, brand_id, title, reference, excerpt, created_by, created_at) VALUES (?,?,?,?,?,?,?)", id, brandId, v.title, v.reference, v.excerpt, actor.name, now());
  await audit(brandId, actor, "evidence.registered", "evidence", id, `${v.title} (${v.reference})`);
  return { id, title: v.title, reference: v.reference };
}
export interface EvidenceRow extends EvidenceLite { excerpt: string; created_at: string }
export async function listEvidence(brandId: string): Promise<EvidenceRow[]> {
  return await all<EvidenceRow>("SELECT id, title, reference, excerpt, created_at FROM evidence WHERE brand_id = ? ORDER BY created_at, seq", brandId);
}

/* ---------- facts ---------- */
interface FactRow {
  id: string; brand_id: string; product: string; attribute: string; kind: "numeric" | "text"; value: string; unit: string;
  keywords: string; pattern: string; evidence_id: string | null; version: number; updated_by: string; updated_at: string; created_at: string;
}
export interface Fact extends FactLite { updatedBy: string; updatedAt: string; createdAt: string }
const toFact = (r: FactRow): Fact => ({
  id: r.id, product: r.product, attribute: r.attribute, kind: r.kind, value: r.value, unit: r.unit,
  keywords: JSON.parse(r.keywords) as string[], pattern: r.pattern, evidenceId: r.evidence_id, version: r.version,
  updatedBy: r.updated_by, updatedAt: r.updated_at, createdAt: r.created_at,
});
export async function listFacts(brandId: string): Promise<Fact[]> {
  return (await all<FactRow>("SELECT * FROM facts WHERE brand_id = ? ORDER BY created_at, seq", brandId)).map(toFact);
}
export async function getFact(brandId: string, id: string): Promise<Fact> {
  const r = await get<FactRow>("SELECT * FROM facts WHERE id = ? AND brand_id = ?", id, brandId);
  if (!r) throw new HttpError(404, "Fact not found for this brand");
  return toFact(r);
}

export const factInput = z.object({
  product: z.string().trim().min(1).max(80),
  attribute: z.string().trim().min(1).max(80),
  kind: z.enum(["numeric", "text"]),
  value: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(20).default(""),
  keywords: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  pattern: z.string().max(200).default(""),
  evidenceId: z.string().nullable().optional(),
  evidence: evidenceInput.optional(),
  reason: z.string().trim().max(300).default(""),
}).superRefine((v, ctx) => {
  if (v.kind === "numeric") {
    if (!/^\d+(\.\d+)?$/.test(v.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "Numeric facts need a plain number such as 32" });
    if (!v.unit) ctx.addIssue({ code: "custom", path: ["unit"], message: "Numeric facts need a unit such as hours" });
    if (!v.keywords.length) ctx.addIssue({ code: "custom", path: ["keywords"], message: "Add at least one keyword (e.g. battery) so claims can be attributed" });
  } else if (v.pattern) {
    try { new RegExp(v.pattern, "i"); } catch { ctx.addIssue({ code: "custom", path: ["pattern"], message: "Pattern is not a valid regular expression" }); }
  } else {
    ctx.addIssue({ code: "custom", path: ["pattern"], message: "Text facts need a detection pattern, e.g. \\bIP\\s?\\d{2}\\b" });
  }
});
export type FactInput = z.input<typeof factInput>;

async function resolveEvidence(brandId: string, actor: Actor, v: z.infer<typeof factInput>): Promise<string | null> {
  if (v.evidence) return (await addEvidence(brandId, actor, v.evidence)).id;
  if (v.evidenceId) {
    if (!await get("SELECT id FROM evidence WHERE id = ? AND brand_id = ?", v.evidenceId, brandId)) throw new HttpError(400, "Evidence does not belong to this brand");
    return v.evidenceId;
  }
  return null;
}

export async function createFact(brandId: string, actor: Actor, input: FactInput): Promise<Fact> {
  requireRole(actor, ["manager"], "register approved facts");
  const v = factInput.parse(input);
  await getBrand(brandId);
  return await tx(async () => {
    const evId = await resolveEvidence(brandId, actor, v);
    const id = newId("FA");
    const t = now();
    await run(
      "INSERT INTO facts (id, brand_id, product, attribute, kind, value, unit, keywords, pattern, evidence_id, version, updated_by, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, brandId, v.product, v.attribute, v.kind, v.value, v.unit, JSON.stringify(v.keywords), v.pattern, evId, 1, actor.name, t, t,
    );
    await run("INSERT INTO fact_versions (id, brand_id, fact_id, version, value, unit, evidence_id, reason, changed_by, changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      newId("FV"), brandId, id, 1, v.value, v.unit, evId, v.reason || "Initial registration", actor.name, t);
    await audit(brandId, actor, "fact.created", "fact", id, `${v.product} ${v.attribute} = ${v.value} ${v.unit}`.trim());
    return await getFact(brandId, id);
  });
}

export interface FactVersion { id: string; fact_id: string; version: number; value: string; unit: string; evidence_id: string | null; reason: string; changed_by: string; changed_at: string }
export async function factHistory(brandId: string, factId: string): Promise<FactVersion[]> {
  return await all<FactVersion>("SELECT id, fact_id, version, value, unit, evidence_id, reason, changed_by, changed_at FROM fact_versions WHERE brand_id = ? AND fact_id = ? ORDER BY version DESC", brandId, factId);
}

/* ---------- guidelines ---------- */
export interface Guideline { id: string; title: string; body: string; source_filename: string | null; created_by: string; created_at: string }
export async function listGuidelines(brandId: string): Promise<Guideline[]> {
  return await all<Guideline>("SELECT id, title, body, source_filename, created_by, created_at FROM guidelines WHERE brand_id = ? ORDER BY created_at, seq", brandId);
}
export const guidelineInput = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(10, "Guideline text is too short").max(50_000),
  sourceFilename: z.string().max(200).nullable().optional(),
});
export async function addGuideline(brandId: string, actor: Actor, input: z.input<typeof guidelineInput>): Promise<Guideline> {
  requireRole(actor, ["manager"], "import guidelines");
  const v = guidelineInput.parse(input);
  const id = newId("GL");
  await run("INSERT INTO guidelines (id, brand_id, title, body, source_filename, created_by, created_at) VALUES (?,?,?,?,?,?,?)", id, brandId, v.title, v.body, v.sourceFilename ?? null, actor.name, now());
  await audit(brandId, actor, "guideline.imported", "guideline", id, v.title);
  return (await get<Guideline>("SELECT id, title, body, source_filename, created_by, created_at FROM guidelines WHERE id = ?", id))!;
}

/* ---------- rules ---------- */
interface RuleRow {
  id: string; brand_id: string; guideline_id: string | null; statement: string; kind: RuleKind; terms: string; severity: Severity;
  origin: string; status: "draft" | "approved" | "rejected"; ambiguity_note: string; version: number; decided_by: string | null; decided_at: string | null; created_at: string;
}
export interface Rule extends RuleLite {
  guidelineId: string | null; origin: string; ambiguityNote: string; version: number; decidedBy: string | null; decidedAt: string | null;
}
const toRule = (r: RuleRow): Rule => ({
  id: r.id, statement: r.statement, kind: r.kind, terms: JSON.parse(r.terms) as string[], severity: r.severity, status: r.status,
  guidelineId: r.guideline_id, origin: r.origin, ambiguityNote: r.ambiguity_note, version: r.version, decidedBy: r.decided_by, decidedAt: r.decided_at,
});
export async function listRules(brandId: string): Promise<Rule[]> {
  return (await all<RuleRow>("SELECT * FROM rules WHERE brand_id = ? ORDER BY created_at, seq", brandId)).map(toRule);
}
async function getRule(brandId: string, id: string): Promise<Rule> {
  const r = await get<RuleRow>("SELECT * FROM rules WHERE id = ? AND brand_id = ?", id, brandId);
  if (!r) throw new HttpError(404, "Rule not found for this brand");
  return toRule(r);
}
async function snapshotRule(brandId: string, actor: Actor, r: Rule) {
  await run("INSERT INTO rule_versions (id, brand_id, rule_id, version, statement, terms, status, changed_by, changed_at) VALUES (?,?,?,?,?,?,?,?,?)",
    newId("RV"), brandId, r.id, r.version, r.statement, JSON.stringify(r.terms), r.status, actor.name, now());
}
export async function ruleHistory(brandId: string, ruleId: string) {
  return await all<{ version: number; statement: string; status: string; changed_by: string; changed_at: string }>(
    "SELECT version, statement, status, changed_by, changed_at FROM rule_versions WHERE brand_id = ? AND rule_id = ? ORDER BY version DESC", brandId, ruleId);
}

async function insertDraft(brandId: string, actor: Actor, guidelineId: string | null, c: CandidateRule): Promise<Rule> {
  const id = newId("RL");
  await run("INSERT INTO rules (id, brand_id, guideline_id, statement, kind, terms, severity, origin, status, ambiguity_note, version, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    id, brandId, guidelineId, c.statement, c.kind, JSON.stringify(c.terms), c.severity, c.origin, "draft", c.ambiguityNote, 1, now());
  const r = await getRule(brandId, id);
  await snapshotRule(brandId, actor, r);
  return r;
}

/** Proposes DRAFT rules from a guideline. Nothing is enforced until a manager approves it. */
export async function proposeRules(brandId: string, actor: Actor, guidelineId: string, opts: { llm?: boolean } = {}): Promise<{ rules: Rule[]; llmStatus: string; skipped: number }> {
  requireRole(actor, ["manager"], "generate rule proposals");
  const g = await get<Guideline>("SELECT id, title, body, source_filename, created_by, created_at FROM guidelines WHERE id = ? AND brand_id = ?", guidelineId, brandId);
  if (!g) throw new HttpError(404, "Guideline not found for this brand");
  const det = proposeRulesDeterministic(g.body);
  const llm = opts.llm === false ? { status: "not_configured" as const, rules: [] as CandidateRule[] } : await proposeRulesLLM(g.body);
  const existing = new Set((await listRules(brandId)).map((r) => `${r.kind}:${r.statement}`));
  let skipped = 0;
  const created = await tx(async () => {
    const out: Rule[] = [];
    for (const c of [...det, ...llm.rules]) {
      const key = `${c.kind}:${c.statement}`;
      if (existing.has(key)) { skipped++; continue; }
      existing.add(key);
      out.push(await insertDraft(brandId, actor, g.id, c));
    }
    await audit(brandId, actor, "rules.proposed", "guideline", g.id, `${out.length} draft rules (${llm.status}); ${skipped} duplicates skipped`);
    return out;
  });
  return { rules: created, llmStatus: llm.status, skipped };
}

export const ruleEdit = z.object({
  statement: z.string().trim().min(5).max(300).optional(),
  terms: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  severity: z.enum(["high", "medium", "low"]).optional(),
});
/** Editing an approved rule sends it back to draft: a changed rule needs a fresh approval. */
export async function editRule(brandId: string, actor: Actor, ruleId: string, input: z.input<typeof ruleEdit>): Promise<Rule> {
  requireRole(actor, ["manager"], "edit rules");
  const v = ruleEdit.parse(input);
  const cur = await getRule(brandId, ruleId);
  const next = { statement: v.statement ?? cur.statement, terms: v.terms ?? cur.terms, severity: v.severity ?? cur.severity };
  if (cur.kind !== "ambiguous" && cur.kind !== "style" && cur.kind !== "superlative" && next.terms.length === 0) throw new HttpError(400, "A term rule needs at least one term");
  return await tx(async () => {
    await run("UPDATE rules SET statement=?, terms=?, severity=?, status='draft', version=version+1, decided_by=NULL, decided_at=NULL WHERE id=? AND brand_id=?",
      next.statement, JSON.stringify(next.terms), next.severity, ruleId, brandId);
    const r = await getRule(brandId, ruleId);
    await snapshotRule(brandId, actor, r);
    await audit(brandId, actor, "rule.edited", "rule", ruleId, `v${r.version}${cur.status === "approved" ? " (was approved; back to draft)" : ""}: ${r.statement}`);
    return r;
  });
}
export async function decideRule(brandId: string, actor: Actor, ruleId: string, decision: "approved" | "rejected" | "draft"): Promise<Rule> {
  requireRole(actor, ["manager"], "approve or reject rules");
  const cur = await getRule(brandId, ruleId);
  if (cur.status === decision) return cur;
  return await tx(async () => {
    const t = now();
    await run("UPDATE rules SET status=?, version=version+1, decided_by=?, decided_at=? WHERE id=? AND brand_id=?", decision, decision === "draft" ? null : actor.name, decision === "draft" ? null : t, ruleId, brandId);
    const r = await getRule(brandId, ruleId);
    await snapshotRule(brandId, actor, r);
    await audit(brandId, actor, `rule.${decision}`, "rule", ruleId, `v${r.version}: ${r.statement}`);
    return r;
  });
}

export async function loadCheckContext(brandId: string) {
  const facts = await listFacts(brandId);
  const evidence = await listEvidence(brandId);
  const rules = await listRules(brandId);
  return { facts, evidence, rules };
}
