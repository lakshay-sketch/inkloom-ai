import { checkText } from "./checker";
import { findOutdatedClaims } from "./impact";
import type { CheckContext, FactLite, FindingDraft } from "./types";

export const LABELS = ["supported_claim", "conflict_claim", "unsupported_promo", "prohibited_term", "guideline_violation", "evidence_missing", "needs_human_review", "outdated_after_change"] as const;
export type Label = (typeof LABELS)[number];

export const LABEL_TEXT: Record<Label, string> = {
  supported_claim: "Supported numerical claim",
  conflict_claim: "Incorrect claim (conflicts with fact)",
  unsupported_promo: "Unsupported promotional claim",
  prohibited_term: "Prohibited term",
  guideline_violation: "Guideline (style) violation",
  evidence_missing: "Matches fact but evidence missing",
  needs_human_review: "Ambiguous claim, human review",
  outdated_after_change: "Outdated after a fact change",
};

const fact = (o: Partial<FactLite> & Pick<FactLite, "id" | "attribute" | "value">): FactLite => ({
  product: "NovaPhone X", kind: "numeric", unit: "", keywords: [], pattern: "", evidenceId: null, version: 1, ...o,
});

/** Fixed fixture context (NOT the live database) so results are reproducible. */
export const EVAL_CONTEXT: CheckContext = {
  facts: [
    fact({ id: "EF-BAT", attribute: "Battery life", value: "32", unit: "hours", keywords: ["battery", "charge"], evidenceId: "EE-1", version: 2 }),
    fact({ id: "EF-WAR", attribute: "Warranty", value: "2", unit: "years", keywords: ["warranty"], evidenceId: "EE-2" }),
    fact({ id: "EF-IP", attribute: "Water resistance", kind: "text", value: "IP68", pattern: "\\bIP\\s?\\d{2}\\b", keywords: ["water", "resistan"] }),
  ],
  evidence: [
    { id: "EE-1", title: "Spec sheet rev B (fictional)", reference: "EVAL-SPEC-B" },
    { id: "EE-2", title: "Warranty policy (fictional)", reference: "EVAL-WARR" },
  ],
  rules: [
    { id: "ER-1", statement: 'Do not use "guaranteed best" or "100% risk-free".', kind: "forbidden_term", terms: ["guaranteed best", "100% risk-free"], severity: "high", status: "approved" },
    { id: "ER-2", statement: "Avoid exaggerated superlatives and unsupported guarantees.", kind: "superlative", terms: ["best", "#1", "number one", "world's", "fastest", "unbeatable", "guaranteed", "100%", "perfect", "flawless", "never fails"], severity: "medium", status: "approved" },
    { id: "ER-3", statement: "No ALL-CAPS words or repeated exclamation marks.", kind: "style", terms: [], severity: "low", status: "approved" },
    { id: "ER-4", statement: 'Prefer "reliable" and "thoughtfully designed".', kind: "preferred_term", terms: ["reliable", "thoughtfully designed"], severity: "low", status: "approved" },
  ],
};

export interface EvalCase {
  id: string;
  text: string;
  expected: Label[];
  /** For fact-change cases: the fact changed from `oldValue` to the context value. */
  changeFrom?: { value: string };
  note?: string;
}

const c = (id: string, text: string, expected: Label[], extra: Partial<EvalCase> = {}): EvalCase => ({ id, text, expected, ...extra });
const CHG = { value: "40" };

/** Synthetic, hand-written by the developers alongside the checker: optimistic by construction. */
export const EVAL_CASES: EvalCase[] = [
  c("C01", "NovaPhone X delivers 32 hours of battery life.", ["supported_claim"]),
  c("C02", "Enjoy a 32-hour battery on a single charge.", ["supported_claim"]),
  c("C03", "Backed by a 2-year warranty.", ["supported_claim"]),
  c("C04", "Warranty: 2 years. Battery: 32 hours.", ["supported_claim"]),
  c("C05", "Up to 40 hours of battery life.", ["conflict_claim"]),
  c("C06", "NovaPhone X comes with a 3 year warranty.", ["conflict_claim"]),
  c("C07", "Battery life of 48 hrs, every day.", ["conflict_claim"]),
  c("C08", "Water resistant to IP67.", ["conflict_claim"]),
  c("C09", "A 2-year warranty and up to 40 hours of battery life.", ["supported_claim", "conflict_claim"]),
  c("C10", "The best phone you will ever own.", ["unsupported_promo"]),
  c("C11", "Unbeatable performance at any price.", ["unsupported_promo"]),
  c("C12", "A flawless camera in every light.", ["unsupported_promo"]),
  c("C13", "A guaranteed best choice for families.", ["prohibited_term"]),
  c("C14", "Try it today with a 100% risk-free trial.", ["prohibited_term"]),
  c("C15", "BUY NOW and save big.", ["guideline_violation"], { note: "ALL-CAPS detector needs 4+ letters: expected miss" }),
  c("C16", "Meet NovaPhone X!!! A phone made for you.", ["guideline_violation"]),
  c("C17", "IP68 water resistance for everyday splashes.", ["evidence_missing"]),
  c("C18", "Rugged and long-lasting, built for adventure.", ["needs_human_review"]),
  c("C19", "An all-day battery you can trust.", ["needs_human_review"]),
  c("C20", "Waterproof design.", ["needs_human_review"]),
  c("C21", "Reliable and thoughtfully designed.", []),
  c("C22", "NovaPhone X, thoughtfully designed for everyday life.", []),
  c("C23", "Charges fully in 30 minutes.", [], { note: "unit not registered; a human would still want a source" }),
  c("C24", "Two days of battery life.", ["conflict_claim"], { note: "words-as-numbers: expected miss" }),
  c("C25", "Lasts forty hours on one charge.", ["conflict_claim"], { note: "words-as-numbers: expected miss" }),
  c("C26", "The best way to extend battery life is to dim the screen.", [], { note: "benign use of 'best': expected false positive" }),
  c("C27", "Packaging is made from 100% recycled paper.", [], { note: "benign use of '100%': expected false positive" }),
  c("C28", "The guaranteed best phone with a 3 year warranty, IP68 rated!!", ["prohibited_term", "conflict_claim", "evidence_missing", "guideline_violation"]),
  c("C29", "Up to 40 hours of battery life.", ["outdated_after_change"], { changeFrom: CHG }),
  c("C30", "Enjoy 40-hour battery on one charge. Reliable from day one.", ["outdated_after_change"], { changeFrom: CHG }),
  c("C31", "Enjoy 32 hours of battery life.", [], { changeFrom: CHG }),
  c("C32", "A 2 year warranty for peace of mind.", [], { changeFrom: CHG }),
  c("C33", "Two days of battery, 40 hrs of fun.", ["outdated_after_change"], { changeFrom: CHG, note: "old value inside a mixed sentence" }),
];

export function predictLabels(f: FindingDraft[]): Set<Label> {
  const out = new Set<Label>();
  for (const x of f) {
    if (x.category === "claim" && x.verdict === "supported") out.add("supported_claim");
    else if (x.category === "claim" && x.verdict === "conflict") out.add("conflict_claim");
    else if (x.verdict === "unsupported") out.add("unsupported_promo");
    else if (x.category === "terminology") out.add("prohibited_term");
    else if (x.category === "guideline") out.add("guideline_violation");
    else if (x.verdict === "needs_review" && x.factId) out.add("evidence_missing");
    else if (x.verdict === "needs_review") out.add("needs_human_review");
  }
  return out;
}

export interface LabelMetrics { label: Label; tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null }
export interface CaseResult { id: string; text: string; expected: Label[]; predicted: Label[]; correct: boolean; note?: string }
export interface EvalReport {
  cases: number; exactCaseMatches: number; perLabel: LabelMetrics[];
  micro: { tp: number; fp: number; fn: number; precision: number | null; recall: number | null };
  results: CaseResult[];
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function runEvaluation(cases: EvalCase[] = EVAL_CASES, ctx: CheckContext = EVAL_CONTEXT): EvalReport {
  const bat = ctx.facts.find((f) => f.id === "EF-BAT")!;
  const results: CaseResult[] = cases.map((k) => {
    let pred: Set<Label>;
    if (k.changeFrom) {
      const old: FactLite = { ...bat, value: k.changeFrom.value, version: bat.version - 1 };
      pred = new Set(findOutdatedClaims(k.text, old, bat).length ? (["outdated_after_change"] as Label[]) : []);
    } else {
      pred = predictLabels(checkText(k.text, ctx).findings);
    }
    const p = [...pred];
    const correct = p.length === k.expected.length && k.expected.every((l) => pred.has(l));
    return { id: k.id, text: k.text, expected: k.expected, predicted: p, correct, note: k.note };
  });
  const perLabel: LabelMetrics[] = LABELS.map((label) => {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const r of results) {
      const e = r.expected.includes(label), p = r.predicted.includes(label);
      if (e && p) tp++; else if (!e && p) fp++; else if (e && !p) fn++; else tn++;
    }
    return { label, tp, fp, fn, tn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
  });
  const tp = perLabel.reduce((s, m) => s + m.tp, 0), fp = perLabel.reduce((s, m) => s + m.fp, 0), fn = perLabel.reduce((s, m) => s + m.fn, 0);
  return { cases: results.length, exactCaseMatches: results.filter((r) => r.correct).length, perLabel, micro: { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) }, results };
}
