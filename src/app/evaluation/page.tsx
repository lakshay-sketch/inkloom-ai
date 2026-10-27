import { Card, PageHeader } from "@/components/ui";
import { EvalRunner } from "@/components/EvalRunner";
import { EVAL_CASES, LABELS, LABEL_TEXT } from "@/core/evaluation";

export default function Evaluation() {
  return (
    <>
      <PageHeader title="Testing & Evaluation" subtitle="Runs the real deterministic checker over a fixed, labelled dataset and reports precision, recall and per-label confusion counts." />
      <Card className="mb-4">
        <h2 className="mb-1">About this dataset</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>{EVAL_CASES.length} short synthetic cases written by the developers alongside the checker. Not real customer data.</li>
          <li>Covers {LABELS.length} label types: {LABELS.map((l) => LABEL_TEXT[l]).join("; ")}.</li>
          <li>Runs against a fixed fixture of facts and rules, not the live database, so results are reproducible.</li>
          <li>Some cases are deliberate known failures (number words, benign “best” or “100%”, short ALL-CAPS) to keep the numbers honest.</li>
          <li><b className="text-ink">Limitations:</b> tiny sample, same authors as the checker, English only. These figures say nothing about production accuracy. The optional LLM is excluded from this evaluation.</li>
        </ul>
      </Card>
      <EvalRunner />
    </>
  );
}
