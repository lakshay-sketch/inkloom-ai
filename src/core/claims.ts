import type { FactLite } from "./types";

export interface Claim {
  fact: FactLite;
  text: string; // exact span in the source text, e.g. "40-hour"
  start: number;
  end: number;
  value: string; // normalised claimed value
}

const UNIT_ALIASES: Record<string, string[]> = {
  hours: ["hours", "hour", "hrs", "hr", "h"],
  years: ["years", "year", "yrs", "yr"],
  months: ["months", "month", "mos", "mo"],
  days: ["days", "day"],
  grams: ["grams", "gram", "g"],
  mah: ["mah"],
  gb: ["gb"],
  mp: ["mp"],
  w: ["w", "watt", "watts"],
};

export function canonicalUnit(raw: string): string {
  const u = raw.toLowerCase();
  for (const [canon, aliases] of Object.entries(UNIT_ALIASES)) if (aliases.includes(u)) return canon;
  return u;
}

export function normalizeNumber(raw: string): string {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : raw;
}

export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

function sentenceBounds(text: string, idx: number): [number, number] {
  let s = idx;
  while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--;
  let e = idx;
  while (e < text.length && !/[.!?\n]/.test(text[e])) e++;
  return [s, e];
}

function nearestKeywordDistance(text: string, s: number, e: number, mStart: number, mEnd: number, keywords: string[]): number {
  const hay = text.slice(s, e).toLowerCase();
  let best = Infinity;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (!k) continue;
    let from = 0;
    for (;;) {
      const i = hay.indexOf(k, from);
      if (i < 0) break;
      const a = s + i;
      const b = a + k.length;
      const d = b <= mStart ? mStart - b : a >= mEnd ? a - mEnd : 0;
      if (d < best) best = d;
      from = i + 1;
    }
  }
  return best;
}

/**
 * Finds claims in `text` that refer to one of `facts`.
 * Numeric: "<number><optional - or space><unit>" whose unit matches a fact's unit and whose
 * sentence mentions one of the fact's keywords (nearest keyword wins; ties are skipped).
 * Text facts: any match of the fact's regex pattern.
 * Limitations: digits only (no "forty"), English only, no unit conversion.
 */
export function extractClaims(text: string, facts: FactLite[]): Claim[] {
  const claims: Claim[] = [];
  const numeric = facts.filter((f) => f.kind === "numeric");
  const re = /(\d+(?:[.,]\d+)*)\s*[-–]?\s*([A-Za-z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const unit = canonicalUnit(m[2]);
    const candidates = numeric.filter((f) => canonicalUnit(f.unit) === unit);
    if (!candidates.length) continue;
    const start = m.index;
    const end = start + m[0].length;
    const [s, e] = sentenceBounds(text, start);
    const scored = candidates
      .map((f) => ({ f, d: nearestKeywordDistance(text, s, e, start, end, f.keywords) }))
      .filter((x) => Number.isFinite(x.d) && x.d <= 80)
      .sort((a, b) => a.d - b.d);
    if (!scored.length) continue;
    if (scored.length > 1 && scored[0].d === scored[1].d) continue; // ambiguous attribution
    claims.push({ fact: scored[0].f, text: m[0], start, end, value: normalizeNumber(m[1]) });
  }
  for (const f of facts.filter((x) => x.kind === "text" && x.pattern)) {
    let rx: RegExp;
    try {
      rx = new RegExp(f.pattern, "gi");
    } catch {
      continue;
    }
    let t: RegExpExecArray | null;
    while ((t = rx.exec(text))) {
      if (!t[0]) {
        rx.lastIndex++;
        continue;
      }
      claims.push({ fact: f, text: t[0], start: t.index, end: t.index + t[0].length, value: normalizeText(t[0]) });
    }
  }
  return claims.sort((a, b) => a.start - b.start);
}

export function factValueNormalized(f: Pick<FactLite, "kind" | "value">): string {
  return f.kind === "numeric" ? normalizeNumber(f.value) : normalizeText(f.value);
}

/** Replace the claimed value inside the claim span with the approved value. */
export function correctedClaimText(claim: Claim): string {
  const f = claim.fact;
  if (f.kind === "numeric") return claim.text.replace(/\d+(?:[.,]\d+)*/, f.value);
  return f.value;
}
