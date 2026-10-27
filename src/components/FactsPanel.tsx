"use client";
import { useState } from "react";
import { api, fmt } from "./api";
import { Badge, Card, btn, btnPrimary } from "./ui";
import { useAction } from "./useAction";
import type { Fact, EvidenceRow, FactVersion } from "@/server/knowledge";

type Hist = Record<string, FactVersion[]>;

export function FactsPanel({ facts, evidence, history, role }: { facts: Fact[]; evidence: EvidenceRow[]; history: Hist; role: string }) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [evMode, setEvMode] = useState<"keep" | "existing" | "new">("keep");
  const [evId, setEvId] = useState("");
  const [evTitle, setEvTitle] = useState("");
  const [evRef, setEvRef] = useState("");
  const [result, setResult] = useState("");
  const isMgr = role === "manager";
  const evById = new Map(evidence.map((e) => [e.id, e]));

  function startEdit(f: Fact) { setEditing(f.id); setValue(f.value); setReason(""); setEvMode("keep"); setEvId(""); setEvTitle(""); setEvRef(""); setResult(""); }
  async function save(f: Fact) {
    const body: Record<string, unknown> = { value, reason };
    if (evMode === "existing") body.evidenceId = evId || null;
    if (evMode === "new") body.evidence = { title: evTitle, reference: evRef, excerpt: "" };
    await run("save" + f.id, () => api<{ impacts: unknown[] }>(`/api/facts/${f.id}`, "PATCH", body), (r) => {
      setEditing(null);
      setResult(`${f.attribute} updated. ${r.impacts.length} saved asset(s) contained the old value and were flagged for re-review.`);
      location.reload();
    });
  }
  return (
    <div className="space-y-3">
      {result && <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-ok">{result}</p>}
      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      {facts.map((f) => {
        const ev = f.evidenceId ? evById.get(f.evidenceId) : undefined;
        return (
          <Card key={f.id} id={f.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3>{f.product} · {f.attribute}</h3>
                <p className="mt-0.5 text-lg font-bold" data-testid={`fact-value-${f.attribute}`}>{f.value} {f.unit} <Badge color="teal">v{f.version} current</Badge></p>
                <p className="text-xs text-muted">Keywords: {f.kind === "numeric" ? f.keywords.join(", ") : `pattern ${f.pattern}`} · updated {fmt(f.updatedAt)} by {f.updatedBy}</p>
                <p className="mt-1">{ev ? <>Evidence: {ev.title} <code className="text-xs">({ev.reference})</code></> : <b className="text-danger">Evidence required: none registered. Matching claims go to human review.</b>}</p>
              </div>
              <button className={btn} disabled={!isMgr || !!busy} title={isMgr ? "" : "Switch role to Brand Manager"} onClick={() => startEdit(f)} data-testid={`change-${f.attribute}`}>Change value</button>
            </div>
            {editing === f.id && (
              <div className="mt-3 grid gap-2 rounded-md bg-info-soft p-3 md:grid-cols-2">
                <div><label htmlFor={`v${f.id}`}>New approved value {f.unit && `(${f.unit})`}</label><input id={`v${f.id}`} value={value} onChange={(e) => setValue(e.target.value)} data-testid="new-value" /></div>
                <div><label htmlFor={`r${f.id}`}>Reason for change (required)</label><input id={`r${f.id}`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="change-reason" /></div>
                <div>
                  <label htmlFor={`m${f.id}`}>Evidence</label>
                  <select id={`m${f.id}`} value={evMode} onChange={(e) => setEvMode(e.target.value as typeof evMode)}>
                    <option value="keep">Keep current evidence reference</option><option value="existing">Choose registered evidence</option><option value="new">Register new evidence</option>
                  </select>
                </div>
                <div>
                  {evMode === "existing" && (<><label htmlFor={`e${f.id}`}>Evidence record</label><select id={`e${f.id}`} value={evId} onChange={(e) => setEvId(e.target.value)}><option value="">None (evidence required)</option>{evidence.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></>)}
                  {evMode === "new" && (<div className="grid gap-2"><input placeholder="Evidence title" aria-label="Evidence title" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} /><input placeholder="Document name / URL / ID" aria-label="Evidence reference" value={evRef} onChange={(e) => setEvRef(e.target.value)} /></div>)}
                </div>
                <div className="flex gap-2 md:col-span-2">
                  <button className={btnPrimary} disabled={!!busy} onClick={() => save(f)} data-testid="save-fact">{busy === "save" + f.id ? "Saving…" : "Save new version"}</button>
                  <button className={btn} onClick={() => setEditing(null)}>Cancel</button>
                </div>
                <p className="text-xs text-muted md:col-span-2">Saving keeps the old version and scans all saved content for claims still carrying the old value. Nothing is re-approved automatically.</p>
              </div>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-accent">Version history ({history[f.id]?.length ?? 0})</summary>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {(history[f.id] ?? []).map((v) => (
                    <tr key={v.id} className="border-b border-line"><td className="py-1 font-semibold">v{v.version}</td><td>{v.value} {v.unit}</td><td>{v.evidence_id ? evById.get(v.evidence_id)?.reference : "no evidence"}</td><td>{v.reason}</td><td className="text-muted">{v.changed_by}, {fmt(v.changed_at)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Card>
        );
      })}
    </div>
  );
}

export function AddFactForm({ role }: { role: string }) {
  const { busy, error, run } = useAction();
  const [f, setF] = useState({ product: "NovaPhone X", attribute: "", kind: "numeric", value: "", unit: "", keywords: "", pattern: "", evTitle: "", evRef: "" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      product: f.product, attribute: f.attribute, kind: f.kind, value: f.value, unit: f.unit,
      keywords: f.keywords.split(",").map((s) => s.trim()).filter(Boolean), pattern: f.pattern,
    };
    if (f.evTitle || f.evRef) body.evidence = { title: f.evTitle, reference: f.evRef, excerpt: "" };
    await run("add", () => api("/api/facts", "POST", body), () => location.reload());
  }
  return (
    <form onSubmit={submit} className="grid gap-2 md:grid-cols-3">
      <div><label htmlFor="fp">Product</label><input id="fp" value={f.product} onChange={set("product")} required /></div>
      <div><label htmlFor="fa">Attribute</label><input id="fa" value={f.attribute} onChange={set("attribute")} placeholder="Weight" required /></div>
      <div><label htmlFor="fk">Type</label><select id="fk" value={f.kind} onChange={set("kind")}><option value="numeric">Numeric</option><option value="text">Text / code</option></select></div>
      <div><label htmlFor="fv">Approved value</label><input id="fv" value={f.value} onChange={set("value")} required /></div>
      {f.kind === "numeric"
        ? (<><div><label htmlFor="fu">Unit</label><input id="fu" value={f.unit} onChange={set("unit")} placeholder="hours, years, mAh…" required /></div>
            <div><label htmlFor="fw">Keywords (comma separated)</label><input id="fw" value={f.keywords} onChange={set("keywords")} placeholder="battery, charge" required /></div></>)
        : <div className="md:col-span-2"><label htmlFor="fx">Detection pattern (regex)</label><input id="fx" value={f.pattern} onChange={set("pattern")} placeholder="\bIP\s?\d{2}\b" required /></div>}
      <div><label htmlFor="et">Evidence title (optional)</label><input id="et" value={f.evTitle} onChange={set("evTitle")} /></div>
      <div><label htmlFor="er">Evidence reference</label><input id="er" value={f.evRef} onChange={set("evRef")} placeholder="doc name, URL or ID" /></div>
      <div className="flex items-end"><button className={btnPrimary} disabled={role !== "manager" || !!busy}>{busy ? "Saving…" : "Register fact"}</button></div>
      {role !== "manager" && <p className="text-xs text-warn md:col-span-3">Switch to the Brand Manager role to register facts.</p>}
      {error && <p role="alert" className="text-danger md:col-span-3">{error}</p>}
    </form>
  );
}
