import { z } from "zod";
import { all, get, newId, now, run, tx } from "./db";
import { Actor, HttpError, audit, requireRole } from "./auth";
import { addEvidence, evidenceInput, getFact, type Fact } from "./knowledge";
import { findOutdatedClaims } from "@/core/impact";

export interface ImpactRow {
  id: string; fact_id: string; old_version: number; new_version: number; asset_id: string; asset_version: number;
  claim_text: string; old_value: string; new_value: string; prior_status: string; status: "open" | "resolved"; created_at: string; resolved_at: string | null;
  asset_title?: string; asset_status?: string; attribute?: string; product?: string; unit?: string;
}

export const factUpdateInput = z.object({
  value: z.string().trim().min(1).max(80),
  evidenceId: z.string().nullable().optional(),
  evidence: evidenceInput.optional(),
  reason: z.string().trim().min(3, "Say why the fact changed").max(300),
});

/**
 * Changes an approved fact (new version; old one is preserved) and, in the SAME transaction,
 * scans every non-rejected asset's latest saved text for claims still carrying the old value.
 * Matches are persisted as impacts and the asset is moved to needs_rereview; nothing is
 * auto-approved. Matching is exact/normalised only (see core/impact.ts).
 */
export async function updateFact(brandId: string, actor: Actor, factId: string, input: z.input<typeof factUpdateInput>): Promise<{ fact: Fact; impacts: ImpactRow[] }> {
  requireRole(actor, ["manager"], "change approved facts");
  const v = factUpdateInput.parse(input);
  const old = await getFact(brandId, factId);
  if (old.kind === "numeric" && !/^\d+(\.\d+)?$/.test(v.value)) throw new HttpError(400, "Numeric facts need a plain number such as 32");
  if (old.kind === "text" && !v.value) throw new HttpError(400, "Value required");

  return await tx(async () => {
    let evId = old.evidenceId;
    if (v.evidence) evId = (await addEvidence(brandId, actor, v.evidence)).id;
    else if (v.evidenceId !== undefined) {
      if (v.evidenceId && !await get("SELECT id FROM evidence WHERE id = ? AND brand_id = ?", v.evidenceId, brandId)) throw new HttpError(400, "Evidence does not belong to this brand");
      evId = v.evidenceId;
    }
    const t = now();
    const version = old.version + 1;
    await run("UPDATE facts SET value=?, evidence_id=?, version=?, updated_by=?, updated_at=? WHERE id=? AND brand_id=?", v.value, evId, version, actor.name, t, factId, brandId);
    await run("INSERT INTO fact_versions (id, brand_id, fact_id, version, value, unit, evidence_id, reason, changed_by, changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      newId("FV"), brandId, factId, version, v.value, old.unit, evId, v.reason, actor.name, t);
    const next = await getFact(brandId, factId);
    await audit(brandId, actor, "fact.updated", "fact", factId, `${old.product} ${old.attribute}: ${old.value} -> ${next.value} ${old.unit} (v${old.version} -> v${version}). Reason: ${v.reason}`);

    const impacts: ImpactRow[] = [];
    const assets = await all<{ id: string; title: string; status: string; current_version: number }>(
      "SELECT id, title, status, current_version FROM assets WHERE brand_id = ? AND status != 'rejected'", brandId);
    for (const a of assets) {
      const ver = await get<{ body: string }>("SELECT body FROM asset_versions WHERE asset_id = ? AND version = ? AND brand_id = ?", a.id, a.current_version, brandId);
      if (!ver) continue;
      const hits = findOutdatedClaims(ver.body, old, next);
      if (!hits.length) continue;
      for (const h of hits) {
        const id = newId("IM");
        await run("INSERT INTO impacts (id, brand_id, fact_id, old_version, new_version, asset_id, asset_version, claim_text, old_value, new_value, prior_status, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
          id, brandId, factId, old.version, version, a.id, a.current_version, h.claimText, old.value, next.value, a.status, "open", t);
      }
      await run("UPDATE assets SET status='needs_rereview', updated_at=? WHERE id=? AND brand_id=?", t, a.id, brandId);
      await audit(brandId, actor, "asset.flagged_outdated", "asset", a.id, `"${a.title}" contains outdated claim(s) after ${old.attribute} changed ${old.value} -> ${next.value}; previous status ${a.status}`);
    }
    impacts.push(...await listImpacts(brandId, { factId, newVersion: version }));
    return { fact: next, impacts };
  });
}

export async function listImpacts(brandId: string, opts: { status?: "open" | "resolved"; factId?: string; assetId?: string; newVersion?: number } = {}): Promise<ImpactRow[]> {
  const where = ["i.brand_id = ?"];
  const params: (string | number)[] = [brandId];
  if (opts.status) { where.push("i.status = ?"); params.push(opts.status); }
  if (opts.factId) { where.push("i.fact_id = ?"); params.push(opts.factId); }
  if (opts.assetId) { where.push("i.asset_id = ?"); params.push(opts.assetId); }
  if (opts.newVersion) { where.push("i.new_version = ?"); params.push(opts.newVersion); }
  return await all<ImpactRow>(
    `SELECT i.*, a.title AS asset_title, a.status AS asset_status, f.attribute, f.product, f.unit
       FROM impacts i JOIN assets a ON a.id = i.asset_id JOIN facts f ON f.id = i.fact_id
      WHERE ${where.join(" AND ")} ORDER BY i.created_at DESC, i.seq DESC`, ...params);
}
