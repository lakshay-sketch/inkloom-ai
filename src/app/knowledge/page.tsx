import { cookies } from "next/headers";
import { currentBrand } from "@/server/seed";
import { factHistory, listEvidence, listFacts, listGuidelines } from "@/server/knowledge";
import { actorFromRole } from "@/server/auth";
import { Card, Empty, PageHeader } from "@/components/ui";
import { AddFactForm, FactsPanel } from "@/components/FactsPanel";
import { GuidelineForm } from "@/components/Calibration";
import { fmt } from "@/components/api";

export default async function Knowledge() {
  const brand = await currentBrand();
  const role = actorFromRole((await cookies()).get("inkloom_role")?.value).role;
  const facts = await listFacts(brand.id);
  const evidence = await listEvidence(brand.id);
  const history = Object.fromEntries(await Promise.all(facts.map(async (f) => [f.id, await factHistory(brand.id, f.id)] as const)));
  const guidelines = await listGuidelines(brand.id);
  return (
    <>
      <PageHeader title="Brand Knowledge Base" subtitle={`Approved facts, their evidence and brand guidelines for ${brand.name}. Content is checked against these records only.`} />
      <h2 className="mb-2">Approved facts</h2>
      {facts.length === 0 ? <Empty title="No approved facts" hint="Register a fact below to start checking claims." /> : <FactsPanel facts={facts} evidence={evidence} history={history} role={role} />}
      <Card className="mt-3"><h3 className="mb-2">Register a new approved fact</h3><AddFactForm role={role} /></Card>

      <h2 className="mt-6 mb-2">Evidence records</h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-left">
          <thead><tr className="text-xs text-muted"><th className="p-2">Title</th><th className="p-2">Reference</th><th className="p-2">Excerpt</th><th className="p-2">Added</th></tr></thead>
          <tbody>{evidence.map((e) => <tr key={e.id} className="border-t border-line"><td className="p-2">{e.title}</td><td className="p-2"><code className="text-xs">{e.reference}</code></td><td className="p-2 text-muted">{e.excerpt || "none"}</td><td className="p-2 text-xs text-muted">{fmt(e.created_at)}</td></tr>)}</tbody>
        </table>
      </Card>

      <h2 className="mt-6 mb-2">Brand guidelines</h2>
      {guidelines.map((g) => (
        <Card key={g.id} className="mb-2"><h3>{g.title}</h3><p className="mt-1 whitespace-pre-wrap text-muted">{g.body}</p><p className="mt-1 text-xs text-muted">Added by {g.created_by}, {fmt(g.created_at)}. Turn it into testable rules on the Guideline Calibration page.</p></Card>
      ))}
      <Card><h3 className="mb-2">Add a guideline</h3><GuidelineForm role={role} /></Card>
    </>
  );
}
