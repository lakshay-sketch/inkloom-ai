import { beforeAll, describe, expect, it } from "vitest";
import { all, get } from "@/server/db";
import { DEMO_USERS, HttpError } from "@/server/auth";
import { applyFinding, createAsset, decide, editAsset, getAssetDetail, runCheck, submitForReview } from "@/server/content";
import { resetDemo } from "@/server/seed";

// These races only exist with several simultaneous connections, i.e. a real PostgreSQL (set DATABASE_URL to a throwaway
// database). On embedded PGlite (one connection) the calls are serialised, so the tests still pass but prove nothing.
const { creator: cre, reviewer: rev } = DEMO_USERS;
let brandId = "";
beforeAll(async () => { brandId = (await resetDemo()).id; });

const auditCount = async (action: string, entityId: string) =>
  (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM audit_events WHERE action = ? AND entity_id = ?", action, entityId))!.n;
const versions = async (assetId: string) => (await all<{ version: number }>("SELECT version FROM asset_versions WHERE asset_id = ? ORDER BY version", assetId)).map((r) => r.version);
const rejectedStatus = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" && r.reason instanceof HttpError ? r.reason.status : r.status === "rejected" ? 500 : 0);

describe("concurrent version creation", () => {
  it("two simultaneous edits both succeed with unique, sequential versions and correct audit events", async () => {
    for (let round = 0; round < 4; round++) {
      const a = await createAsset(brandId, cre, { title: `Race edit ${round}`, body: "Original text for the edit race test." });
      const results = await Promise.allSettled([
        editAsset(brandId, cre, a.id, { body: `Edit from writer A in round ${round}.`, note: "A" }),
        editAsset(brandId, cre, a.id, { body: `Edit from writer B in round ${round}.`, note: "B" }),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await versions(a.id)).toEqual([1, 2, 3]);
      const detail = await getAssetDetail(brandId, a.id);
      expect(detail.asset.current_version).toBe(3);
      const audits = await all<{ detail: string }>("SELECT detail FROM audit_events WHERE action = 'asset.version_created' AND entity_id = ? ORDER BY seq", a.id);
      expect(audits.map((x) => x.detail.split(":")[0]).sort()).toEqual(["v2", "v3"]);
    }
  });
  it("two simultaneous accepts of the same suggestion apply it exactly once", async () => {
    const a = await createAsset(brandId, cre, { title: "Race accept", body: "Rugged phone with 48 hours of battery." });
    const { findings } = await runCheck(brandId, cre, a.id, { llm: false });
    const f = findings.find((x) => x.verdict === "conflict" && x.suggestion !== null)!;
    const results = await Promise.allSettled([applyFinding(brandId, cre, f.id, { action: "accept" }), applyFinding(brandId, cre, f.id, { action: "accept" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.map(rejectedStatus).filter(Boolean)).toEqual([409]);
    expect(await versions(a.id)).toEqual([1, 2]);
    expect(await auditCount("finding.accepted", f.id)).toBe(1);
  });
});

describe("concurrent review workflow", () => {
  const CLEAN = "NovaPhone X has up to 40 hours of battery life.";
  const checked = async (title: string) => { const a = await createAsset(brandId, cre, { title, body: CLEAN }); await runCheck(brandId, cre, a.id, { llm: false }); return a; };

  it("a double submit for review is accepted once and refused once, with a single audit event", async () => {
    const a = await checked("Race submit");
    const results = await Promise.allSettled([submitForReview(brandId, cre, a.id), submitForReview(brandId, cre, a.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.map(rejectedStatus).filter(Boolean)).toEqual([409]);
    expect(await auditCount("asset.submitted", a.id)).toBe(1);
  });
  it("an approval never lands on a version that changed while the decision was being made", async () => {
    for (let round = 0; round < 4; round++) {
      const a = await checked(`Race decide ${round}`);
      await submitForReview(brandId, cre, a.id);
      await Promise.allSettled([
        decide(brandId, rev, a.id, { decision: "approved", comment: "ok" }),
        editAsset(brandId, cre, a.id, { body: `${CLEAN} Edited during review ${round}.` }),
      ]);
      const d = await getAssetDetail(brandId, a.id);
      const approvedAt = d.decisions.filter((x) => x.decision === "approved").map((x) => x.asset_version);
      if (d.asset.status === "approved") expect(approvedAt.at(-1)).toBe(d.asset.current_version);
      expect(await versions(a.id)).toEqual(Array.from({ length: d.asset.current_version }, (_, i) => i + 1));
    }
  });
});
