import { correctedClaimText, extractClaims, factValueNormalized } from "./claims";
import type { CheckContext, CheckResult, FindingDraft, RuleLite } from "./types";

/** Phrases we cannot verify against any numeric/registered fact. Built-in heuristic, not a rule. */
const VAGUE_PHRASES = ["all-day battery", "long-lasting", "lasts all day", "military-grade", "unbreakable", "rugged", "waterproof", "indestructible"];

function escapeRx(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTerm(text: string, term: string): { start: number; end: number; text: string }[] {
  const t = term.trim();
  if (!t) return [];
  const edge = /^\w/.test(t) ? "\\b" : "";
  const edgeEnd = /\w$/.test(t) ? "\\b" : "";
  const rx = new RegExp(`${edge}${escapeRx(t)}${edgeEnd}`, "gi");
  const out: { start: number; end: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  return out;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/**
 * Deterministic check of `text` against approved facts and APPROVED rules only.
 * Draft/rejected rules are ignored. Nothing here calls an LLM.
 */
export function checkText(text: string, ctx: CheckContext): CheckResult {
  const findings: FindingDraft[] = [];
  const approved = ctx.rules.filter((r) => r.status === "approved");
  const preferred = approved.filter((r) => r.kind === "preferred_term").flatMap((r) => r.terms);
  const fallbackSuggestion = preferred[0] ?? null;
  const evById = new Map(ctx.evidence.map((e) => [e.id, e]));

  // 1. Claims vs approved facts.
  for (const claim of extractClaims(text, ctx.facts)) {
    const f = claim.fact;
    const ev = f.evidenceId ? evById.get(f.evidenceId) : undefined;
    const base = {
      category: "claim" as const,
      text: claim.text,
      start: claim.start,
      end: claim.end,
      factId: f.id,
      factVersion: f.version,
      evidenceId: ev?.id ?? null,
    };
    const approvedValue = `${f.value}${f.kind === "numeric" ? ` ${f.unit}` : ""}`.trim();
    if (claim.value !== factValueNormalized(f)) {
      findings.push({
        ...base,
        severity: "high",
        verdict: "conflict",
        explanation: `The approved ${f.product} ${f.attribute.toLowerCase()} is ${approvedValue} (fact v${f.version}), but this copy says "${claim.text}". This is a conflict with a registered fact, not just a missing source.`,
        evidenceRequired: !ev,
        suggestion: correctedClaimText(claim),
        confidence: "exact",
      });
    } else if (!ev) {
      findings.push({
        ...base,
        severity: "medium",
        verdict: "needs_review",
        explanation: `"${claim.text}" matches the approved value (${approvedValue}), but no evidence is registered for this fact. Evidence required: a human must verify before approval.`,
        evidenceRequired: true,
        suggestion: null,
        confidence: "exact",
      });
    } else {
      findings.push({
        ...base,
        severity: "low",
        verdict: "supported",
        explanation: `Matches approved ${f.product} ${f.attribute.toLowerCase()} = ${approvedValue} (fact v${f.version}), backed by evidence "${ev.title}".`,
        evidenceRequired: false,
        suggestion: null,
        confidence: "exact",
      });
    }
  }

  // 2. Rule-based checks (approved rules only).
  const ruleHits: FindingDraft[] = [];
  const addRuleHits = (rule: RuleLite, mk: (hit: { start: number; end: number; text: string }, term: string) => FindingDraft) => {
    for (const term of rule.terms) for (const hit of findTerm(text, term)) ruleHits.push(mk(hit, term));
  };
  for (const rule of approved.filter((r) => r.kind === "forbidden_term")) {
    addRuleHits(rule, (hit) => ({
      category: "terminology",
      severity: rule.severity,
      verdict: "conflict",
      text: hit.text,
      start: hit.start,
      end: hit.end,
      explanation: `"${hit.text}" is disallowed by approved rule: ${rule.statement}`,
      ruleId: rule.id,
      evidenceRequired: false,
      suggestion: fallbackSuggestion,
      confidence: "exact",
    }));
  }
  for (const rule of approved.filter((r) => r.kind === "superlative")) {
    addRuleHits(rule, (hit) => ({
      category: "claim",
      severity: rule.severity,
      verdict: "unsupported",
      text: hit.text,
      start: hit.start,
      end: hit.end,
      explanation: `"${hit.text}" is an absolute or superlative promotional claim and no registered fact or evidence supports it. Unsupported is not the same as false: it needs evidence or softer wording. Rule: ${rule.statement}`,
      ruleId: rule.id,
      evidenceRequired: true,
      suggestion: fallbackSuggestion,
      confidence: "pattern",
    }));
  }
  for (const rule of approved.filter((r) => r.kind === "style")) {
    const rxs: [RegExp, string][] = [
      [/!{2,}/g, "repeated exclamation marks"],
      [/\b[A-Z]{4,}\b/g, "ALL-CAPS word"],
    ];
    for (const [rx, label] of rxs) {
      let m: RegExpExecArray | null;
      while ((m = rx.exec(text))) {
        ruleHits.push({
          category: "guideline",
          severity: rule.severity,
          verdict: "conflict",
          text: m[0],
          start: m.index,
          end: m.index + m[0].length,
          explanation: `Style: ${label} ("${m[0]}") conflicts with approved rule: ${rule.statement}`,
          ruleId: rule.id,
          evidenceRequired: false,
          suggestion: label.startsWith("ALL") ? m[0][0] + m[0].slice(1).toLowerCase() : "!",
          confidence: "pattern",
        });
      }
    }
  }
  // Longest span wins when rule hits overlap each other or an already-reported claim.
  ruleHits.sort((a, b) => b.end - b.start - (a.end - a.start));
  for (const h of ruleHits) if (!findings.some((x) => overlaps(x, h))) findings.push(h);

  // 3. Vague claims we cannot verify -> human review (never "false").
  for (const phrase of VAGUE_PHRASES) {
    for (const hit of findTerm(text, phrase)) {
      const h: FindingDraft = {
        category: "claim",
        severity: "medium",
        verdict: "needs_review",
        text: hit.text,
        start: hit.start,
        end: hit.end,
        explanation: `"${hit.text}" is a vague performance claim that cannot be checked against a registered fact. Needs human review; add a measurable fact and evidence or reword it.`,
        evidenceRequired: true,
        suggestion: null,
        confidence: "low",
      };
      if (!findings.some((x) => overlaps(x, h))) findings.push(h);
    }
  }

  findings.sort((a, b) => a.start - b.start);
  return { findings, notAutomated: approved.filter((r) => r.kind === "ambiguous") };
}

export function isIssue(f: Pick<FindingDraft, "verdict">): boolean {
  return f.verdict !== "supported";
}
