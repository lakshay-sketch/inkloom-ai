import { beforeAll, describe, expect, it } from "vitest";
import { all, get } from "@/server/db";
import { DEMO_USERS, HttpError } from "@/server/auth";
import { createBrand, createFact, decideRule, editRule, factHistory, listFacts, listRules, listEvidence } from "@/server/knowledge";
import { applyFinding, createAsset, decide, editAsset, getAssetDetail, listAssets, runCheck, submitForReview } from "@/server/content";
import { listImpacts, updateFact } from "@/server/ledger";
import { dashboardData } from "@/server/dashboard";
import { listAudit } from "@/server/auth";
import { resetDemo, SAMPLE_BAD_AD } from "@/server/seed";

const { manager: mgr, reviewer: rev, creator: cre } = DEMO_USERS;
let brandId = "";
const battery = async () => (await listFacts(brandId)).find((f) => f.attribute === "Battery life")!;

beforeAll(async () => {
  brandId = (await resetDemo()).id;
});

const expectHttp = async (fn: () => unknown, status: number) => {
  try { await fn(); } catch (e) { expect(e).toBeInstanceOf(HttpError); expect((e as HttpError).status).toBe(status); return; }
  throw new Error("expected HttpError " + status);
};

describe("seeded demo", () => {
  it("is built from real persisted records", async () => {
    expect(await listFacts(brandId)).toHaveLength(3);
    expect((await listRules(brandId)).filter((r) => r.status === "approved").length).toBeGreaterThanOrEqual(3);
    expect((await listRules(brandId)).some((r) => r.status === "draft" && r.kind === "ambiguous")).toBe(true);
    expect(await listAssets(brandId)).toHaveLength(3);
  });
});

describe("check -> correct -> approve", () => {
  let id = "";
  it("persists content, findings with ids, evidence refs and statuses", async () => {
    const a = await createAsset(brandId, cre, { title: "Bad ad", body: SAMPLE_BAD_AD });
    id = a.id;
    const { run, findings } = await runCheck(brandId, cre, id);
    expect(run.llm_status).toBe("not_configured");
    expect(findings.length).toBeGreaterThanOrEqual(7);
    const conflict = findings.find((f) => f.text === "48 hours")!;
    expect(conflict.verdict).toBe("conflict");
    expect(conflict.fact_id).toBe((await battery()).id);
    expect(conflict.evidence_reference).toBe("DOC-NOVA-SPEC-001");
    expect(conflict.id).toMatch(/^F-/);
    const ip = findings.find((f) => f.text === "IP68")!;
    expect(ip.verdict).toBe("needs_review");
    expect(ip.evidence_required).toBe(1);
    expect((await getAssetDetail(brandId, id)).asset.status).toBe("flagged");
  });
  it("blocks approval while conflicts are open, and blocks creators", async () => {
    await expectHttp(async () => await decide(brandId, cre, id, { decision: "approved", comment: "x" }), 403);
    await expectHttp(async () => await decide(brandId, rev, id, { decision: "approved", comment: "ok" }), 409);
  });
  it("accepting suggestions creates new versions and preserves the original", async () => {
    let d = await getAssetDetail(brandId, id);
    for (const f of d.findings.filter((x) => x.verdict === "conflict" && x.suggestion !== null)) await applyFinding(brandId, cre, f.id, { action: "accept" });
    d = await getAssetDetail(brandId, id);
    expect(d.asset.current_version).toBeGreaterThan(1);
    expect(d.versions.at(-1)!.body).toBe(SAMPLE_BAD_AD);
    expect(d.versions[0].body).not.toMatch(/guaranteed best|48 hours/);
    expect(d.versions[0].body).toMatch(/40 hours/);
  });
  it("cannot decide before rechecking the new version", async () => {
    await expectHttp(async () => await decide(brandId, rev, id, { decision: "approved", comment: "ok" }), 409);
  });
  it("edit + recheck, then approval needs a comment for unresolved review items", async () => {
    const d = await getAssetDetail(brandId, id);
    await editAsset(brandId, cre, id, { body: "Meet NovaPhone X. Up to 40 hours of battery life and a 2-year warranty. Thoughtfully designed." });
    const r = await runCheck(brandId, cre, id);
    expect(r.findings.every((f) => f.verdict === "supported")).toBe(true);
    expect(d.asset.status).not.toBe("approved");
    await submitForReview(brandId, cre, id);
    expect((await getAssetDetail(brandId, id)).asset.status).toBe("under_review");
    await expectHttp(async () => await decide(brandId, rev, id, { decision: "rejected", comment: "" }), 400);
    const a = await decide(brandId, rev, id, { decision: "approved", comment: "Verified" });
    expect(a.status).toBe("approved");
    const dec = (await getAssetDetail(brandId, id)).decisions[0];
    expect(dec).toMatchObject({ reviewer: rev.name, role: "reviewer", decision: "approved" });
    expect(dec.asset_version).toBe((await getAssetDetail(brandId, id)).asset.current_version);
  });
  it("is idempotent for double-clicked submissions", async () => {
    const a = await createAsset(brandId, cre, { title: "Dup", body: "Same body text here" });
    const b = await createAsset(brandId, cre, { title: "Dup", body: "Same body text here" });
    expect(b.id).toBe(a.id);
  });
});

describe("Claim Ledger change impact (mandatory showcase)", () => {
  let before = 0;
  it("battery=40 content is supported with evidence", async () => {
    const a = await createAsset(brandId, cre, { title: "Showcase", body: "Up to 40 hours of battery life." });
    const r = await runCheck(brandId, cre, a.id);
    expect(r.findings[0]).toMatchObject({ verdict: "supported", fact_version: 1 });
    await submitForReview(brandId, cre, a.id);
    await decide(brandId, rev, a.id, { decision: "approved", comment: "ok" });
    before = (await listImpacts(brandId)).length;
  });
  it("only a manager can change a fact", async () => {
    await expectHttp(async () => await updateFact(brandId, rev, (await battery()).id, { value: "32", reason: "spec update" }), 403);
  });
  it("changing to 32 preserves history and flags previously APPROVED content", async () => {
    const f = await battery();
    const { fact, impacts } = await updateFact(brandId, mgr, f.id, { value: "32", reason: "Spec sheet rev B" });
    expect(fact.version).toBe(2);
    expect((await factHistory(brandId, f.id)).map((v) => v.value)).toEqual(["32", "40"]);
    const titles = impacts.map((i) => i.asset_title);
    expect(titles).toContain("Showcase");
    expect(titles).toContain("NovaPhone X launch ad");
    expect(titles).toContain("Landing page hero");
    expect(titles).not.toContain("Social post draft");
    const i = impacts.find((x) => x.asset_title === "Showcase")!;
    expect(i).toMatchObject({ old_value: "40", new_value: "32", claim_text: "40 hours", prior_status: "approved", status: "open" });
    expect((await listImpacts(brandId)).length).toBeGreaterThan(before);
    const st = ((await get<{ status: string }>("SELECT status FROM assets WHERE id = ?", i.asset_id))!).status;
    expect(st).toBe("needs_rereview");
  });
  it("approval stays blocked until the old claim is removed; recheck resolves the impact", async () => {
    const a = (await listAssets(brandId)).find((x) => x.title === "Showcase")!;
    const r1 = await runCheck(brandId, rev, a.id);
    expect(r1.findings[0].verdict).toBe("conflict"); // 40 vs new 32
    expect(await listImpacts(brandId, { assetId: a.id, status: "open" })).toHaveLength(1);
    await expectHttp(async () => await decide(brandId, rev, a.id, { decision: "approved", comment: "force" }), 409);
    await applyFinding(brandId, cre, r1.findings[0].id, { action: "accept" });
    await runCheck(brandId, cre, a.id);
    expect(await listImpacts(brandId, { assetId: a.id, status: "open" })).toHaveLength(0);
    expect(await listImpacts(brandId, { assetId: a.id, status: "resolved" })).toHaveLength(1);
  });
  it("changing a fact to the same value creates no impact", async () => {
    const { impacts } = await updateFact(brandId, mgr, (await battery()).id, { value: "32", reason: "no-op re-confirmation" });
    expect(impacts.filter((i) => i.new_version === 3)).toHaveLength(0);
  });
  it("evidence can be attached when changing a fact", async () => {
    const f = (await listFacts(brandId)).find((x) => x.attribute === "Water resistance")!;
    const { fact } = await updateFact(brandId, mgr, f.id, { value: "IP68", reason: "Certificate received", evidence: { title: "IP certificate (fictional)", reference: "CERT-1", excerpt: "" } });
    expect(fact.evidenceId).toBeTruthy();
    expect((await listEvidence(brandId)).some((e) => e.reference === "CERT-1")).toBe(true);
  });
});

describe("guideline calibration lifecycle", () => {
  it("draft rules are not enforced until approved; edits send an approved rule back to draft", async () => {
    const r = await createBrand("Other Brand");
    const x = (await listRules(brandId)).find((q) => q.kind === "forbidden_term")!;
    expect(x.status).toBe("approved");
    const e = await editRule(brandId, mgr, x.id, { terms: ["guaranteed best", "100% risk-free", "no-risk"] });
    expect(e.status).toBe("draft");
    expect(e.version).toBeGreaterThan(x.version);
    const a = await createAsset(brandId, cre, { title: "Rule test", body: "A no-risk purchase." });
    expect((await runCheck(brandId, cre, a.id)).findings).toHaveLength(0);
    await decideRule(brandId, mgr, x.id, "approved");
    const a2 = await createAsset(brandId, cre, { title: "Rule test 2", body: "A no-risk purchase!" });
    expect((await runCheck(brandId, cre, a2.id)).findings.some((f) => f.text === "no-risk")).toBe(true);
    expect(r.id).not.toBe(brandId);
  });
  it("only managers approve rules; every decision is versioned", async () => {
    const d = (await listRules(brandId)).find((q) => q.status === "draft")!;
    await expectHttp(async () => await decideRule(brandId, rev, d.id, "approved"), 403);
    expect((await all("SELECT * FROM rule_versions WHERE rule_id = ?", d.id)).length).toBeGreaterThanOrEqual(1);
  });
});

describe("brand isolation", () => {
  it("another brand sees none of this brand's data", async () => {
    const other = await createBrand("Isolated Co");
    expect(await listFacts(other.id)).toHaveLength(0);
    expect(await listAssets(other.id)).toHaveLength(0);
    expect(await listRules(other.id)).toHaveLength(0);
    expect(await listAudit(other.id)).toHaveLength(0);
    await expectHttp(async () => await getAssetDetail(other.id, (await listAssets(brandId))[0].id), 404);
    await expectHttp(async () => await updateFact(other.id, mgr, (await battery()).id, { value: "1", reason: "attack" }), 404);
  });
  it("cannot attach another brand's evidence", async () => {
    const other = await createBrand("Isolated 2");
    const ev = (await listEvidence(brandId))[0];
    await expectHttp(async () => await createFact(other.id, mgr, { product: "P", attribute: "A", kind: "numeric", value: "1", unit: "hours", keywords: ["a"], evidenceId: ev.id }), 400);
  });
});

describe("validation, audit and dashboard", () => {
  it("rejects invalid fact input", async () => {
    await expect(createFact(brandId, mgr, { product: "P", attribute: "A", kind: "numeric", value: "abc", unit: "", keywords: [] })).rejects.toThrow();
    await expect(createFact(brandId, mgr, { product: "P", attribute: "A", kind: "text", value: "x", pattern: "(" })).rejects.toThrow();
  });
  it("rejects tiny / oversized content", async () => {
    await expect(createAsset(brandId, cre, { title: "t", body: "hi" })).rejects.toThrow();
    await expect(createAsset(brandId, cre, { title: "Big", body: "x".repeat(20_001) })).rejects.toThrow();
  });
  it("audit log records who/what/when for the important actions", async () => {
    const actions = new Set((await listAudit(brandId, 500)).map((a) => a.action));
    for (const a of ["fact.created", "fact.updated", "asset.flagged_outdated", "rule.approved", "rule.edited", "review.approved", "finding.accepted", "check.run", "impact.resolved"]) expect(actions.has(a)).toBe(true);
    const e = (await listAudit(brandId, 500)).find((x) => x.action === "fact.updated")!;
    expect(e).toMatchObject({ actor: mgr.name, role: "manager" });
    expect(Date.parse(e.created_at)).not.toBeNaN();
  });
  it("dashboard numbers equal the stored rows", async () => {
    const d = await dashboardData(brandId);
    expect(d.totalAssets).toBe((await listAssets(brandId)).length);
    expect(d.approved).toBe((await all("SELECT id FROM assets WHERE status='approved' AND brand_id=?", brandId)).length);
    expect(d.openImpacts.length).toBe((await listImpacts(brandId, { status: "open" })).length);
  });
});

describe("seeding race", () => {
  it("every concurrent caller sees the fully seeded brand at the moment it resumes", async () => {
    const { wipeAll, currentBrand } = await import("@/server/seed");
    await wipeAll();
    const seen = () => currentBrand().then(async (b) => ({ id: b.id, assets: (await listAssets(b.id)).length, facts: (await listFacts(b.id)).length }));
    const r = await Promise.all([seen(), seen(), seen()]);
    expect(new Set(r.map((x) => x.id)).size).toBe(1);
    for (const x of r) expect(x).toMatchObject({ assets: 3, facts: 3 });
  });
});
