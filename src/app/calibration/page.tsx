import { cookies } from "next/headers";
import { currentBrand } from "@/server/seed";
import { listGuidelines, listRules, ruleHistory } from "@/server/knowledge";
import { actorFromRole } from "@/server/auth";
import { llmConfigured } from "@/server/llm";
import { Card, Empty, PageHeader } from "@/components/ui";
import { GuidelineForm, ProposeButton, RuleCard, RuleTester } from "@/components/Calibration";

export default async function Calibration() {
  const brand = await currentBrand();
  const role = actorFromRole((await cookies()).get("inkloom_role")?.value).role;
  const guidelines = await listGuidelines(brand.id);
  const rules = await listRules(brand.id);
  const histories = new Map(await Promise.all(rules.map(async (r) => [r.id, await ruleHistory(brand.id, r.id)] as const)));
  const groups: [string, typeof rules][] = [
    ["Needs a manager decision (draft)", rules.filter((r) => r.status === "draft")],
    ["Approved", rules.filter((r) => r.status === "approved")],
    ["Rejected", rules.filter((r) => r.status === "rejected")],
  ];
  return (
    <>
      <PageHeader title="Guideline Calibration" subtitle="Turn guideline prose into specific, testable rules. Proposals are drafts until a brand manager approves them. Ambiguous rules are flagged for human review, never auto-enforced." />
      <div className="mb-4 rounded-md border border-line bg-info-soft px-3 py-2 text-xs text-muted">
        Proposals come from deterministic phrase analysis{llmConfigured() ? " plus Claude (validated JSON, labelled “AI interpretation”)" : "; AI proposals are off because no API key is configured"}.
        Multi-reviewer agreement testing from the Round 1 plan is <b className="text-ink">not implemented</b> and no agreement statistics are claimed.
      </div>
      <h2 className="mb-2">Guidelines</h2>
      {guidelines.length === 0 ? <Empty title="No guidelines imported" hint="Add a guideline below, then generate proposed rules." /> : guidelines.map((g) => (
        <Card key={g.id} className="mb-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1"><h3>{g.title}</h3><p className="mt-1 whitespace-pre-wrap text-muted">{g.body}</p></div>
            <ProposeButton guidelineId={g.id} role={role} />
          </div>
        </Card>
      ))}
      <Card className="mb-6"><h3 className="mb-2">Import another guideline</h3><GuidelineForm role={role} /></Card>
      {groups.map(([title, rs]) => (
        <section key={title} className="mb-5">
          <h2 className="mb-2">{title} ({rs.length})</h2>
          <div className="space-y-2">{rs.length === 0 ? <p className="text-muted">None.</p> : rs.map((r) => <RuleCard key={r.id} r={r} role={role} history={histories.get(r.id) ?? []} />)}</div>
        </section>
      ))}
      <RuleTester />
    </>
  );
}
