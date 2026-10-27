import { all, get } from "./db";
import { listAudit } from "./auth";
import { listAssets } from "./content";
import { listImpacts } from "./ledger";

/** Every number is a COUNT over persisted rows for this brand. */
export async function dashboardData(brandId: string) {
  const assets = await listAssets(brandId);
  const by = (s: string) => assets.filter((a) => a.status === s).length;
  const latestRunFindings = await all<{ severity: string; n: number }>(
    `SELECT f.severity, COUNT(*) AS n FROM findings f
      WHERE f.brand_id = ? AND f.review_status = 'open' AND f.verdict != 'supported'
        AND f.run_id = (SELECT r.id FROM analysis_runs r WHERE r.asset_id = f.asset_id ORDER BY r.created_at DESC, r.seq DESC LIMIT 1)
      GROUP BY f.severity`, brandId);
  const sev = Object.fromEntries(latestRunFindings.map((r) => [r.severity, r.n])) as Record<string, number>;
  const decided = (await get<{ n: number }>("SELECT COUNT(DISTINCT asset_id) AS n FROM review_decisions WHERE brand_id = ?", brandId))?.n ?? 0;
  const awaiting = assets.filter((a) => ["flagged", "under_review", "needs_rereview", "changes_requested"].includes(a.status)).length;
  const openImpacts = await listImpacts(brandId, { status: "open" });
  const recentFacts = await all<{ id: string; product: string; attribute: string; value: string; unit: string; version: number; updated_at: string; updated_by: string }>(
    "SELECT id, product, attribute, value, unit, version, updated_at, updated_by FROM facts WHERE brand_id = ? ORDER BY updated_at DESC LIMIT 4", brandId);
  const recentReviews = await all<{ asset_id: string; title: string; decision: string; reviewer: string; role: string; decided_at: string; asset_version: number }>(
    `SELECT d.asset_id, a.title, d.decision, d.reviewer, d.role, d.decided_at, d.asset_version FROM review_decisions d JOIN assets a ON a.id = d.asset_id
      WHERE d.brand_id = ? ORDER BY d.decided_at DESC, d.seq DESC LIMIT 5`, brandId);
  return {
    totalAssets: assets.length,
    reviewedAssets: decided,
    approved: by("approved"),
    awaiting,
    needsRereview: by("needs_rereview"),
    openBySeverity: { high: sev.high ?? 0, medium: sev.medium ?? 0, low: sev.low ?? 0 },
    openImpacts,
    recentFacts,
    recentReviews,
    recentActivity: await listAudit(brandId, 6),
  };
}
