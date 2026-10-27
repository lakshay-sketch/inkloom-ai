"use client";
import { useState } from "react";
import { api, fmt } from "./api";
import { Badge, Card, SeverityBadge, btn, btnDanger, btnPrimary } from "./ui";
import { FileToText } from "./FileToText";
import { useAction } from "./useAction";
import type { Rule } from "@/server/knowledge";
import type { FindingDraft } from "@/core/types";

export function GuidelineForm({ role }: { role: string }) {
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run("gl", () => api("/api/guidelines", "POST", { title, body }), () => location.reload()); }}>
      <div><label htmlFor="gt">Title</label><input id="gt" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
      <div><label htmlFor="gb">Guideline text</label><textarea id="gb" value={body} onChange={(e) => setBody(e.target.value)} required minLength={10} data-testid="guideline-text" /></div>
      <FileToText onText={(t, n) => { setBody(t); if (!title) setTitle(n.replace(/\.[^.]+$/, "")); }} />
      {role !== "manager" && <p className="text-xs text-warn">Switch to the Brand Manager role to import guidelines.</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <button className={btnPrimary} disabled={role !== "manager" || !!busy} data-testid="add-guideline">{busy ? "Saving…" : "Add guideline"}</button>
    </form>
  );
}

export function ProposeButton({ guidelineId, role }: { guidelineId: string; role: string }) {
  const { busy, error, run } = useAction();
  const [msg, setMsg] = useState("");
  return (
    <div>
      <button className={btnPrimary} disabled={role !== "manager" || !!busy} data-testid="propose-rules"
        onClick={() => run("p", () => api<{ rules: unknown[]; llmStatus: string; skipped: number }>(`/api/guidelines/${guidelineId}/propose`, "POST"), (r) => {
          setMsg(`${r.rules.length} draft rule(s) proposed (${r.skipped} duplicates skipped). AI proposals: ${r.llmStatus === "not_configured" ? "off, no API key" : r.llmStatus}.`);
          setTimeout(() => location.reload(), 900);
        })}>{busy ? "Analysing…" : "Generate proposed rules"}</button>
      {msg && <p role="status" className="mt-1 text-xs text-muted">{msg}</p>}
      {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
    </div>
  );
}

const KIND: Record<string, string> = { forbidden_term: "Forbidden terms", superlative: "Superlatives", preferred_term: "Preferred terms", style: "Style", ambiguous: "Ambiguous" };

export function RuleCard({ r, role, history }: { r: Rule; role: string; history: { version: number; status: string; changed_by: string; changed_at: string }[] }) {
  const { busy, error, run } = useAction();
  const [edit, setEdit] = useState(false);
  const [statement, setStatement] = useState(r.statement);
  const [terms, setTerms] = useState(r.terms.join(", "));
  const mgr = role === "manager";
  const decide = (d: string) => run(d, () => api(`/api/rules/${r.id}/decision`, "POST", { decision: d }));
  return (
    <article className="rounded-md border border-line p-3" data-testid="rule" data-status={r.status} data-kind={r.kind}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge color={r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status === "draft" ? "Draft: not enforced" : r.status === "approved" ? (r.kind === "ambiguous" ? "Approved, not auto-enforced" : "Approved: enforced") : "Rejected"}</Badge>
        <Badge color="teal">{KIND[r.kind]}</Badge>
        <SeverityBadge severity={r.severity} />
        <Badge>{r.origin === "llm" ? "AI interpretation" : r.origin === "seed" ? "seed" : "rule-based proposal"}</Badge>
        <span className="text-xs text-muted">v{r.version}</span>
      </div>
      {edit ? (
        <div className="mt-2 space-y-2">
          <div><label htmlFor={`s${r.id}`}>Rule statement</label><input id={`s${r.id}`} value={statement} onChange={(e) => setStatement(e.target.value)} /></div>
          {r.kind !== "ambiguous" && r.kind !== "style" && <div><label htmlFor={`t${r.id}`}>Terms (comma separated)</label><input id={`t${r.id}`} value={terms} onChange={(e) => setTerms(e.target.value)} /></div>}
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={!!busy} onClick={() => run("edit", () => api(`/api/rules/${r.id}`, "PATCH", { statement, terms: r.kind === "ambiguous" || r.kind === "style" ? undefined : terms.split(",").map((s) => s.trim()).filter(Boolean) }), () => location.reload())}>Save as draft</button>
            <button className={btn} onClick={() => setEdit(false)}>Cancel</button>
          </div>
          {r.status === "approved" && <p className="text-xs text-warn">Editing an approved rule returns it to draft; it needs approval again.</p>}
        </div>
      ) : (
        <>
          <p className="mt-2 font-semibold">{r.statement}</p>
          {r.terms.length > 0 && <p className="mt-0.5 text-[13px] text-muted">Terms: {r.terms.join(", ")}</p>}
          {r.ambiguityNote && <p className="mt-1 rounded bg-warn-soft px-2 py-1 text-[13px] text-warn">{r.kind === "ambiguous" ? "Needs human review. " : "Interpretation. "}{r.ambiguityNote}</p>}
          <p className="mt-1 text-xs text-muted">{r.decidedBy ? `Decided by ${r.decidedBy}, ${fmt(r.decidedAt!)}` : "Awaiting a manager decision"} · {history.length} version record(s)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={btnPrimary} disabled={!mgr || !!busy || r.status === "approved"} onClick={() => decide("approved")} data-testid="approve-rule">Approve</button>
            <button className={btn} disabled={!mgr || !!busy} onClick={() => setEdit(true)} data-testid="edit-rule">Edit</button>
            <button className={btnDanger} disabled={!mgr || !!busy || r.status === "rejected"} onClick={() => decide("rejected")} data-testid="reject-rule">Reject</button>
            {r.status !== "draft" && <button className={btn} disabled={!mgr || !!busy} onClick={() => decide("draft")}>Back to draft</button>}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
    </article>
  );
}

export function RuleTester() {
  const { busy, error, run } = useAction();
  const [text, setText] = useState("Meet NovaPhone X!!! The guaranteed best phone, 100% risk-free.");
  const [out, setOut] = useState<{ findings: FindingDraft[]; notAutomated: Rule[]; approvedRules: number } | null>(null);
  return (
    <Card>
      <h2>Test approved rules on sample content</h2>
      <p className="mb-2 text-muted">Only approved rules run. Draft and rejected rules are ignored. Nothing is saved.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Sample content" data-testid="rule-test-text" />
      <button className={`${btnPrimary} mt-2`} disabled={!!busy} onClick={() => run("t", () => api<NonNullable<typeof out>>("/api/rules/test", "POST", { text }), (r) => setOut(r))} data-testid="run-rule-test">{busy ? "Running…" : "Run approved rules"}</button>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
      {out && (
        <div className="mt-3 space-y-1" data-testid="rule-test-result">
          <p className="text-muted">{out.approvedRules} approved rule(s) applied. {out.findings.length} finding(s).</p>
          {out.findings.map((f, i) => <p key={i}><Badge color={f.verdict === "conflict" ? "red" : "amber"}>{f.verdict}</Badge> <code>{f.text}</code>: {f.explanation}</p>)}
          {out.notAutomated.map((r) => <p key={r.id} className="text-warn">Not automated, human review: {r.statement}</p>)}
        </div>
      )}
    </Card>
  );
}
