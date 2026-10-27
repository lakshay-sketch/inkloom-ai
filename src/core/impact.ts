import { extractClaims, factValueNormalized, normalizeNumber, normalizeText } from "./claims";
import type { FactLite } from "./types";

export interface ImpactHit {
  claimText: string;
  start: number;
  end: number;
}

/**
 * Claims in `text` that still carry the OLD value of a fact after it changed to `next`.
 * Exact/normalised match only ("40 hours", "40-hour", "40hrs" all match 40 hours).
 * It will NOT find paraphrases ("two days of battery") or words-as-numbers.
 */
export function findOutdatedClaims(text: string, old: FactLite, next: FactLite): ImpactHit[] {
  const norm = (f: FactLite) => (f.kind === "numeric" ? normalizeNumber(f.value) : normalizeText(f.value));
  if (norm(old) === norm(next)) return [];
  return extractClaims(text, [old])
    .filter((c) => c.value === factValueNormalized(old))
    .map((c) => ({ claimText: c.text, start: c.start, end: c.end }));
}
