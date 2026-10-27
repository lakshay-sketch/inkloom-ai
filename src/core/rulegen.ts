import type { RuleKind, Severity } from "./types";

export interface CandidateRule {
  statement: string;
  kind: RuleKind;
  terms: string[];
  severity: Severity;
  origin: "deterministic" | "llm";
  ambiguityNote: string;
  sourceSentence: string;
}

export const DEFAULT_SUPERLATIVES = ["best", "#1", "number one", "world's", "fastest", "unbeatable", "guaranteed", "100%", "perfect", "flawless", "never fails"];

const MAP_TO_SUPERLATIVE = ["premium", "professional", "confident", "trustworthy", "credible", "reliable", "luxury"];
const SUBJECTIVE = ["approachable", "friendly", "warm", "conversational", "modern", "bold", "inspiring", "authentic", "human", "fresh", "premium", "professional", "confident", "playful", "sophisticated", "premium"];

function quoted(s: string): string[] {
  const out: string[] = [];
  const rx = /["“‘']([^"”’']{2,60})["”’']/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s))) out.push(m[1].trim());
  return out;
}

/**
 * Deterministic guideline -> candidate rules. Every result is a DRAFT proposal; nothing
 * becomes policy until a brand manager approves it. Subjective language with no objective
 * test is emitted as an `ambiguous` rule, which is never enforced automatically.
 */
export function proposeRulesDeterministic(guideline: string): CandidateRule[] {
  const sentences = guideline
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((s) => s.length > 3);
  const out: CandidateRule[] = [];
  const seen = new Set<string>();
  const push = (r: CandidateRule) => {
    const k = `${r.kind}:${r.statement}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
      return;
    }
    // An explicit, unambiguous sentence beats an interpreted one with the same statement.
    const i = out.findIndex((x) => `${x.kind}:${x.statement}` === k);
    if (out[i].ambiguityNote && !r.ambiguityNote) out[i] = r;
  };
  for (const s of sentences) {
    const lower = s.toLowerCase();
    const q = quoted(s);
    const prohibits = /\b(never|do not|don't|avoid|must not|prohibit|banned|disallow)/.test(lower);
    const prefers = /\b(always|prefer|use the (word|term|phrase))/.test(lower);
    if (q.length && prohibits) {
      push({ statement: `Do not use: ${q.map((t) => `"${t}"`).join(", ")}.`, kind: "forbidden_term", terms: q, severity: "high", origin: "deterministic", ambiguityNote: "", sourceSentence: s });
      continue;
    }
    if (q.length && prefers) {
      push({ statement: `Prefer the terms: ${q.map((t) => `"${t}"`).join(", ")}.`, kind: "preferred_term", terms: q, severity: "low", origin: "deterministic", ambiguityNote: "", sourceSentence: s });
      continue;
    }
    if (/\b(superlative|guarantee|exaggerat|unsupported claim|absolute)/.test(lower)) {
      push({ statement: "Avoid exaggerated superlatives and unsupported guarantees.", kind: "superlative", terms: DEFAULT_SUPERLATIVES, severity: "medium", origin: "deterministic", ambiguityNote: "", sourceSentence: s });
      continue;
    }
    if (/\b(all[- ]caps|exclamation|shout)/.test(lower)) {
      push({ statement: "No ALL-CAPS words or repeated exclamation marks.", kind: "style", terms: [], severity: "low", origin: "deterministic", ambiguityNote: "", sourceSentence: s });
      continue;
    }
    const subj = SUBJECTIVE.filter((w) => lower.includes(w));
    if (!subj.length) continue;
    if (MAP_TO_SUPERLATIVE.some((w) => lower.includes(w))) {
      push({
        statement: "Avoid exaggerated superlatives and unsupported guarantees.",
        kind: "superlative",
        terms: DEFAULT_SUPERLATIVES,
        severity: "medium",
        origin: "deterministic",
        ambiguityNote: "This is one possible testable reading of the guideline, proposed by the system. A manager must confirm it captures the intent.",
        sourceSentence: s,
      });
    }
    const residual = subj.filter((w) => !MAP_TO_SUPERLATIVE.includes(w));
    if (residual.length) {
      push({
        statement: `Tone should be ${residual.join(", ")}.`,
        kind: "ambiguous",
        terms: [],
        severity: "low",
        origin: "deterministic",
        ambiguityNote: `"${residual.join('", "')}" has no objective test. Reviewers may read it differently; needs clarification or human review. Not enforced automatically.`,
        sourceSentence: s,
      });
    }
  }
  return out;
}
