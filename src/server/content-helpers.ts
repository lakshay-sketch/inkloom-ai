import { get } from "./db";
import type { FactLite } from "@/core/types";

/** Rebuilds the (old, new) fact states for a recorded change from fact_versions + the current fact row. */
export async function factHistoryValueAt(brandId: string, factId: string, oldVersion: number, newVersion: number): Promise<{ old: FactLite; next: FactLite } | null> {
  const f = await get<{ id: string; product: string; attribute: string; kind: "numeric" | "text"; unit: string; keywords: string; pattern: string }>(
    "SELECT id, product, attribute, kind, unit, keywords, pattern FROM facts WHERE id = ? AND brand_id = ?", factId, brandId);
  if (!f) return null;
  const ver = async (n: number) => await get<{ value: string; evidence_id: string | null }>("SELECT value, evidence_id FROM fact_versions WHERE fact_id = ? AND version = ? AND brand_id = ?", factId, n, brandId);
  const o = await ver(oldVersion);
  const n = await ver(newVersion);
  if (!o || !n) return null;
  const mk = (v: { value: string; evidence_id: string | null }, version: number): FactLite => ({
    id: f.id, product: f.product, attribute: f.attribute, kind: f.kind, value: v.value, unit: f.unit,
    keywords: JSON.parse(f.keywords) as string[], pattern: f.pattern, evidenceId: v.evidence_id, version,
  });
  return { old: mk(o, oldVersion), next: mk(n, newVersion) };
}
