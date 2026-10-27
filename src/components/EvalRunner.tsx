"use client";
import { useState } from "react";
import { api } from "./api";
import { Badge, Card, Td, Th, btnPrimary } from "./ui";
import { LABEL_TEXT, type EvalReport } from "@/core/evaluation";
import { useAction } from "./useAction";

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);

export function EvalRunner() {
  const { busy, error, run } = useAction();
  const [rep, setRep] = useState<EvalReport | null>(null);
  return (
    <>
      <button className={btnPrimary} disabled={!!busy} onClick={() => run("e", () => api<EvalReport>("/api/evaluation", "POST"), (r) => setRep(r))} data-testid="run-eval">{busy ? "Running…" : "Run Demo Evaluation"}</button>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
      {rep && (
        <div className="mt-4 space-y-4" data-testid="eval-report">
          <Card>
            <h2>Result: {rep.exactCaseMatches} of {rep.cases} cases matched their labels exactly</h2>
            <p className="text-muted">Micro-averaged over all label decisions: precision {pct(rep.micro.precision)}, recall {pct(rep.micro.recall)} (TP {rep.micro.tp}, FP {rep.micro.fp}, FN {rep.micro.fn}). Computed just now by running the real checker on the fixed dataset.</p>
          </Card>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left">
              <thead><tr><Th>Label</Th><Th>TP</Th><Th>FP</Th><Th>FN</Th><Th>TN</Th><Th>Precision</Th><Th>Recall</Th></tr></thead>
              <tbody>{rep.perLabel.map((m) => <tr key={m.label}><Td>{LABEL_TEXT[m.label]}</Td><Td>{m.tp}</Td><Td>{m.fp}</Td><Td>{m.fn}</Td><Td>{m.tn}</Td><Td>{pct(m.precision)}</Td><Td>{pct(m.recall)}</Td></tr>)}</tbody>
            </table>
          </Card>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-left">
              <thead><tr><Th>Case</Th><Th>Text</Th><Th>Expected</Th><Th>Predicted</Th><Th>Result</Th></tr></thead>
              <tbody>{rep.results.map((r) => (
                <tr key={r.id} className={r.correct ? "" : "bg-warn-soft"}>
                  <Td>{r.id}</Td><Td>{r.text}{r.note && <div className="text-xs text-muted">{r.note}</div>}</Td>
                  <Td>{r.expected.length ? r.expected.join(", ") : "none"}</Td><Td>{r.predicted.length ? r.predicted.join(", ") : "none"}</Td>
                  <Td>{r.correct ? <Badge color="green">match</Badge> : <Badge color="amber">mismatch</Badge>}</Td>
                </tr>))}</tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
