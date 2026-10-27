export type Severity = "high" | "medium" | "low";
export type Verdict = "supported" | "conflict" | "unsupported" | "needs_review";
export type Category = "claim" | "terminology" | "guideline";
export type Confidence = "exact" | "pattern" | "low";

export interface FactLite {
  id: string;
  product: string;
  attribute: string;
  kind: "numeric" | "text";
  value: string;
  unit: string;
  keywords: string[];
  pattern: string;
  evidenceId: string | null;
  version: number;
}

export interface EvidenceLite {
  id: string;
  title: string;
  reference: string;
}

export type RuleKind = "forbidden_term" | "superlative" | "preferred_term" | "style" | "ambiguous";

export interface RuleLite {
  id: string;
  statement: string;
  kind: RuleKind;
  terms: string[];
  severity: Severity;
  status: "draft" | "approved" | "rejected";
}

export interface FindingDraft {
  category: Category;
  severity: Severity;
  verdict: Verdict;
  text: string;
  start: number;
  end: number;
  explanation: string;
  factId?: string;
  factVersion?: number;
  ruleId?: string;
  evidenceId?: string | null;
  evidenceRequired: boolean;
  suggestion: string | null;
  confidence: Confidence;
}

export interface CheckContext {
  facts: FactLite[];
  evidence: EvidenceLite[];
  rules: RuleLite[];
}

export interface CheckResult {
  findings: FindingDraft[];
  /** Approved rules that are ambiguous and therefore NOT enforced automatically. */
  notAutomated: RuleLite[];
}
