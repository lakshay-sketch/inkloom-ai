import { describe, expect, it } from "vitest";
import { checkText } from "@/core/checker";
import { extractClaims } from "@/core/claims";
import { findOutdatedClaims } from "@/core/impact";
import { proposeRulesDeterministic } from "@/core/rulegen";
import { EVAL_CONTEXT, runEvaluation } from "@/core/evaluation";

const ctx = EVAL_CONTEXT;
const verdicts = (t: string) => checkText(t, ctx).findings.map((f) => `${f.category}:${f.verdict}:${f.text}`);

describe("claim checker", () => {
  it("supports a matching numeric claim and cites its evidence", () => {
    const [f] = checkText("32 hours of battery life", ctx).findings;
    expect(f.verdict).toBe("supported");
    expect(f.evidenceId).toBe("EE-1");
    expect(f.factVersion).toBe(2);
  });
  it("normalises 32-hour / 32hrs / 32 hrs", () => {
    for (const t of ["a 32-hour battery", "battery 32hrs", "battery lasts 32 hrs"]) expect(checkText(t, ctx).findings[0].verdict).toBe("supported");
  });
  it("flags a conflicting number with a corrected suggestion", () => {
    const [f] = checkText("Up to 40 hours of battery life", ctx).findings;
    expect(f.verdict).toBe("conflict");
    expect(f.severity).toBe("high");
    expect(f.suggestion).toBe("32 hours");
  });
  it("does not cross-attribute units: warranty years vs battery hours in one sentence", () => {
    const v = verdicts("32 hours of battery and a 2-year warranty");
    expect(v.every((x) => x.includes("supported"))).toBe(true);
    expect(v).toHaveLength(2);
  });
  it("says evidence required (not false) when a matching fact has no evidence", () => {
    const [f] = checkText("IP68 water resistance", ctx).findings;
    expect(f.verdict).toBe("needs_review");
    expect(f.evidenceRequired).toBe(true);
  });
  it("marks superlatives unsupported, not conflict", () => {
    const [f] = checkText("The best phone ever", ctx).findings;
    expect(f.verdict).toBe("unsupported");
    expect(f.explanation).toMatch(/not the same as false/);
  });
  it("prohibited phrase wins over its inner superlative", () => {
    const f = checkText("A guaranteed best choice", ctx).findings;
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("terminology");
  });
  it("routes vague claims to human review", () => {
    expect(checkText("Rugged design", ctx).findings[0].verdict).toBe("needs_review");
  });
  it("ignores draft and rejected rules", () => {
    const drafts = { ...ctx, rules: ctx.rules.map((r) => ({ ...r, status: "draft" as const })) };
    expect(checkText("guaranteed best phone!!!", drafts).findings).toHaveLength(0);
  });
  it("does not enforce approved ambiguous rules but reports them", () => {
    const withAmb = { ...ctx, rules: [...ctx.rules, { id: "A", statement: "Be approachable", kind: "ambiguous" as const, terms: [], severity: "low" as const, status: "approved" as const }] };
    const r = checkText("hello there", withAmb);
    expect(r.findings).toHaveLength(0);
    expect(r.notAutomated).toHaveLength(1);
  });
  it("offsets point at the exact text", () => {
    const t = "Great phone. Up to 48 hours of battery.";
    const f = checkText(t, ctx).findings.find((x) => x.verdict === "conflict")!;
    expect(t.slice(f.start, f.end)).toBe(f.text);
  });
});

describe("claim-change impact", () => {
  const bat = ctx.facts[0];
  const old = { ...bat, value: "40", version: 1 };
  it("finds the old value in several spellings", () => {
    for (const t of ["Up to 40 hours of battery life", "40-hour battery", "battery: 40hrs"]) expect(findOutdatedClaims(t, old, bat)).toHaveLength(1);
  });
  it("ignores current values, other attributes and unchanged facts", () => {
    expect(findOutdatedClaims("32 hours of battery", old, bat)).toHaveLength(0);
    expect(findOutdatedClaims("40 years of warranty", old, bat)).toHaveLength(0);
    expect(findOutdatedClaims("40 hours of battery", bat, bat)).toHaveLength(0);
  });
  it("documented limitation: words-as-numbers are not matched", () => {
    expect(findOutdatedClaims("forty hours of battery", old, bat)).toHaveLength(0);
  });
});

describe("guideline rule proposal", () => {
  const rules = proposeRulesDeterministic('Sound premium but approachable. Never use the phrases "foo" or "bar".');
  it("extracts quoted prohibitions as testable forbidden terms", () => {
    expect(rules.find((r) => r.kind === "forbidden_term")?.terms).toEqual(["foo", "bar"]);
  });
  it("maps premium to a testable proxy and flags 'approachable' as ambiguous", () => {
    expect(rules.some((r) => r.kind === "superlative" && r.ambiguityNote)).toBe(true);
    expect(rules.find((r) => r.kind === "ambiguous")?.ambiguityNote).toMatch(/no objective test/);
  });
});

describe("evaluation harness", () => {
  const r = runEvaluation();
  it("runs the real checker over every labelled case", () => {
    expect(r.cases).toBeGreaterThanOrEqual(30);
    expect(r.results.every((x) => Array.isArray(x.predicted))).toBe(true);
  });
  it("precision/recall are consistent with confusion counts", () => {
    for (const m of r.perLabel) {
      if (m.precision !== null) expect(m.precision).toBeCloseTo(m.tp / (m.tp + m.fp));
      if (m.recall !== null) expect(m.recall).toBeCloseTo(m.tp / (m.tp + m.fn));
    }
    expect(r.perLabel.every((m) => m.tp + m.fp + m.fn + m.tn === r.cases)).toBe(true);
  });
  it("reports known misses honestly (not a perfect score)", () => {
    expect(r.exactCaseMatches).toBeLessThan(r.cases);
  });
  it("extractClaims tolerates a regex-hostile pattern", () => {
    const bad = { ...ctx.facts[2], pattern: "(" };
    expect(extractClaims("IP68", [bad])).toEqual([]);
  });
});
