"use client";
import Link from "next/link";
import { useState } from "react";
import { api, fmt } from "./api";
import { Badge, Card, SeverityBadge, StatusBadge, VerdictBadge, btn, btnDanger, btnPrimary } from "./ui";
import { useAction } from "./useAction";
import type { Asset, AssetVersion, Decision, Finding, Run } from "@/server/content";
import type { ImpactRow } from "@/server/ledger";

interface Props {
  asset: Asset; versions: AssetVersion[]; run: Run | null; findings: Finding[]; decisions: Decision[]; impacts: ImpactRow[];
  role: string; llmConfigured: boolean;
}

const CONF: Record<string, string> = { exact: "Exact match", pattern: "Pattern match", low: "Low confidence: human check" };

function Highlighted({ body, findings }: { body: string; findings: Finding[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const f of [...findings].sort((a, b) => a.start_offset - b.start_offset)) {
    if (f.start_offset < at || body.slice(f.start_offset, f.end_offset) !== f.text) continue;
    parts.push(body.slice(at, f.start_offset));
    const cls = f.verdict === "supported" ? "bg-ok-soft" : f.verdict === "conflict" ? "bg-danger-soft" : "bg-warn-soft";
    parts.push(<mark key={f.id} className={`hl ${cls} ${f.review_status !== "open" ? "opacity-50" : ""}`} title={f.id}>{f.text}</mark>);
    at = f.end_offset;
  }
  parts.push(body.slice(at));
  return <p className="whitespace-pre-wrap leading-relaxed" data-testid="asset-body">{parts}</p>;
}

function FindingCard({ f, busy, onAct }: { f: Finding; busy: string | null; onAct: (id: string, action: "accept" | "edit" | "reject", replacement?: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(f.suggestion ?? "");
  const open = f.review_status === "open";
  const evidence = f.evidence_id
    ? <>{f.evidence_title} <code className="text-xs">({f.evidence_reference})</code></>
    : f.fact_id ? <b className="text-danger">Evidence required: none registered for this fact</b> : f.evidence_required ? <b className="text-warn">Evidence required: no registered fact supports this</b> : <span className="text-muted">Not applicable</span>;
  return (
    <article className="rounded-md border border-line p-3" data-testid="finding" data-verdict={f.verdict}>
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="text-xs text-muted">{f.id}</code>
        <Badge color="teal">{f.category}</Badge>
        <SeverityBadge severity={f.severity} />
        <VerdictBadge verdict={f.verdict} />
        {!open && <Badge color="gray">{f.review_status}</Badge>}
      </div>
      <p className="mt-2">Text: <mark className="hl bg-info-soft font-mono text-[13px]">{f.text}</mark></p>
      <p className="mt-1">{f.explanation}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
        {f.fact_id && (<><dt className="text-muted">Approved fact</dt><dd><Link className="text-accent underline" href={`/knowledge#${f.fact_id}`}>{f.fact_label} (v{f.fact_version})</Link></dd></>)}
        {f.rule_id && (<><dt className="text-muted">Approved rule</dt><dd><Link className="text-accent underline" href="/calibration">{f.rule_statement}</Link></dd></>)}
        <dt className="text-muted">Evidence</dt><dd>{evidence}</dd>
        <dt className="text-muted">Confidence</dt><dd>{CONF[f.confidence]}</dd>
        {f.resolved_text !== null && <><dt className="text-muted">Applied</dt><dd>&ldquo;{f.resolved_text}&rdquo;</dd></>}
      </dl>
      {f.verdict !== "supported" && open && (
        <div className="mt-3 rounded-md bg-accent-soft p-2.5">
          <div className="text-xs font-semibold text-accent">Suggested correction ({f.suggestion_source === "llm" ? "AI-drafted" : "rule-based"}, advisory)</div>
          {editing ? (
            <div className="mt-1 flex gap-2">
              <input aria-label="Replacement text" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} data-testid="edit-input" />
              <button className={btnPrimary} disabled={!!busy} onClick={() => onAct(f.id, "edit", text)}>Apply</button>
              <button className={btn} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <p className="mt-0.5">{f.suggestion === null ? <i className="text-muted">No automatic suggestion; edit manually or add evidence.</i> : f.suggestion === "" ? <i>Remove this text</i> : <b>&ldquo;{f.suggestion}&rdquo;</b>}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className={btnPrimary} disabled={!!busy || f.suggestion === null} onClick={() => onAct(f.id, "accept")} data-testid="accept">Accept</button>
                <button className={btn} disabled={!!busy} onClick={() => setEditing(true)} data-testid="edit">Edit</button>
                <button className={btn} disabled={!!busy} onClick={() => onAct(f.id, "reject")} data-testid="dismiss">Dismiss (keep original)</button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function AssetWorkspace({ asset, versions, run, findings, decisions, impacts, role, llmConfigured }: Props) {
  const { busy, error, run: act } = useAction();
  const [draft, setDraft] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const latest = versions[0];
  const checkedCurrent = run?.asset_version === asset.current_version;
  const open = findings.filter((f) => f.review_status === "open" && f.verdict !== "supported");
  const canDecide = role === "reviewer" || role === "manager";
  const openImpacts = impacts.filter((i) => i.status === "open");

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-4">
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2>Version {latest.version} (current)</h2>
            <div className="flex gap-2">
              <button className={btn} disabled={draft !== null || !!busy} onClick={() => setDraft(latest.body)} data-testid="edit-text">Edit text</button>
              <button className={btnPrimary} disabled={!!busy} onClick={() => act("check", () => api(`/api/assets/${asset.id}/check`, "POST"))} data-testid="recheck">
                {busy === "check" ? "Checking…" : run ? "Recheck" : "Run check"}
              </button>
            </div>
          </div>
          {draft !== null ? (
            <div className="space-y-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7} maxLength={20000} aria-label="Edit content" data-testid="edit-textarea" />
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={!!busy} onClick={() => act("save", () => api(`/api/assets/${asset.id}/edit`, "POST", { body: draft }), () => { setDraft(null); location.reload(); })}>Save as new version</button>
                <button className={btn} onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          ) : checkedCurrent ? <Highlighted body={latest.body} findings={findings} /> : <p className="whitespace-pre-wrap">{latest.body}</p>}
          {!checkedCurrent && draft === null && (
            <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-warn" role="status">{run ? "The text changed since the last check." : "This version has not been checked."} Run the check before reviewing.</p>
          )}
          {run && <p className="mt-2 text-xs text-muted">Last check: v{run.asset_version}, {fmt(run.created_at)} by {run.created_by}. {run.summary}. AI rewrites: {run.llm_status === "not_configured" ? "off (no API key)" : run.llm_status === "ok" ? "on" : <span className="text-danger">{run.llm_status}. Deterministic findings above are still valid.</span>}</p>}
          {error && <p role="alert" className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
        </Card>

        {openImpacts.length > 0 && (
          <Card className="border-danger/40">
            <h2 className="text-danger">Outdated claim after a fact change</h2>
            {openImpacts.map((i) => (
              <p key={i.id} className="mt-1" data-testid="impact">
                &ldquo;{i.claim_text}&rdquo; was true under {i.product} {i.attribute} v{i.old_version} ({i.old_value} {i.unit}). Approved value is now <b>{i.new_value} {i.unit}</b> (v{i.new_version}). Previous status: {i.prior_status}.{" "}
                <Link className="text-accent underline" href={`/knowledge#${i.fact_id}`}>Open changed fact</Link>
              </p>
            ))}
          </Card>
        )}

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2>Findings {checkedCurrent ? `(${findings.length})` : ""}</h2>
            <span className="text-xs text-muted">AI suggestions are advisory. A human makes the final decision.</span>
          </div>
          {!run ? <p className="text-muted">No check has been run yet.</p> : findings.length === 0 ? <p className="text-muted">No claims or rule violations were found. That does not prove the copy is accurate: only registered facts and approved rules are checked.</p> : (
            <div className="space-y-3">
              {findings.map((f) => <FindingCard key={f.id} f={f} busy={busy} onAct={(id, action, replacement) => act(id, () => api(`/api/findings/${id}`, "POST", { action, replacement }))} />)}
            </div>
          )}
          {run && !llmConfigured && <p className="mt-3 text-xs text-muted">Not automated: ambiguous approved rules are never enforced automatically and need human review.</p>}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <h2 className="mb-1">Review</h2>
          <p className="mb-2">Status: <StatusBadge status={asset.status} /></p>
          {asset.status === "approved" && <p className="mb-2 rounded-md bg-ok-soft px-3 py-2 text-ok">Approved by a human reviewer for v{decisions[0]?.asset_version}. Not published anywhere: Inkloom never publishes automatically.</p>}
          {!canDecide && <p className="mb-2 text-xs text-warn">Only a Reviewer or Brand Manager can decide. Switch the demo role in the sidebar.</p>}
          {checkedCurrent && open.length > 0 && <p className="mb-2 text-xs text-muted">{open.length} unresolved item(s). Approving requires a comment confirming human verification; open conflicts block approval.</p>}
          <label htmlFor="comment">Comment</label>
          <textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} data-testid="decision-comment" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={btn} disabled={!!busy || !checkedCurrent || !["draft", "flagged", "changes_requested", "needs_rereview"].includes(asset.status)} onClick={() => act("submit", () => api(`/api/assets/${asset.id}/submit`, "POST"))} data-testid="submit-review">Submit for review</button>
            <button className={btnPrimary} disabled={!!busy || !canDecide || !checkedCurrent} onClick={() => act("approve", () => api(`/api/assets/${asset.id}/decision`, "POST", { decision: "approved", comment }), () => { setComment(""); location.reload(); })} data-testid="approve">Approve</button>
            <button className={btn} disabled={!!busy || !canDecide || !checkedCurrent} onClick={() => act("changes", () => api(`/api/assets/${asset.id}/decision`, "POST", { decision: "changes_requested", comment }), () => { setComment(""); location.reload(); })} data-testid="request-changes">Request changes</button>
            <button className={btnDanger} disabled={!!busy || !canDecide || !checkedCurrent} onClick={() => act("reject", () => api(`/api/assets/${asset.id}/decision`, "POST", { decision: "rejected", comment }), () => { setComment(""); location.reload(); })} data-testid="reject">Reject</button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-2">Decisions</h2>
          {decisions.length === 0 ? <p className="text-muted">No human decision recorded yet, so this asset is not approved.</p> : (
            <ul className="divide-y divide-line">
              {decisions.map((d) => (
                <li key={d.id} className="py-1.5"><b>{d.decision.replace("_", " ")}</b> v{d.asset_version} by {d.reviewer} ({d.role})<div className="text-xs text-muted">{fmt(d.decided_at)}{d.comment && ` · ${d.comment}`}</div></li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-2">Version history</h2>
          <ul className="space-y-2">
            {versions.map((v) => (
              <li key={v.version}>
                <details open={v.version === versions[0].version && false}>
                  <summary className="cursor-pointer"><b>v{v.version}</b>{v.version === 1 && <Badge>original</Badge>} <span className="text-xs text-muted">{fmt(v.created_at)} · {v.created_by}</span></summary>
                  <p className="mt-1 text-xs text-muted">{v.change_note}</p>
                  <p className="mt-1 whitespace-pre-wrap rounded bg-info-soft p-2 text-[13px]">{v.body}</p>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
