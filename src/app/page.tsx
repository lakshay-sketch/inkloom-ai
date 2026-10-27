import Link from "next/link";
import { currentBrand } from "@/server/seed";
import { dashboardData } from "@/server/dashboard";
import { llmConfigured, llmProviderName } from "@/server/llm";
import { resetEnabled } from "@/server/auth";
import { Badge, Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { fmt } from "@/components/api";
import { ResetDemoButton } from "@/components/ResetDemoButton";

export default async function Dashboard() {
  const brand = await currentBrand();
  const d = await dashboardData(brand.id);
  const stat = (label: string, value: number | string, hint: string, tone = "") => (
    <Card>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-muted">{hint}</div>
    </Card>
  );
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${brand.name}. All figures below are counted from stored records.`}
        actions={resetEnabled() ? <ResetDemoButton /> : undefined}
      />
      <div className="mb-4 rounded-md border border-line bg-info-soft px-3 py-2 text-xs text-muted">
        <b className="text-ink">Prototype mode:</b> fictional NovaTech data, local SQLite storage, demo role switch instead of real sign-in,{" "}
        {llmConfigured() ? `${llmProviderName()} configured for rewrite drafts and rule proposals.` : "no LLM key set, so all checks are deterministic (rewrite drafts and AI rule proposals are off)."}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Assets with a decision", d.reviewedAssets, `of ${d.totalAssets} saved assets`)}
        {stat("Awaiting review", d.awaiting, "flagged, under review, changes requested or outdated")}
        {stat("Affected by fact change", d.openImpacts.length, "open outdated-claim records", d.openImpacts.length ? "text-danger" : "")}
        {stat("Open findings", d.openBySeverity.high + d.openBySeverity.medium + d.openBySeverity.low, `${d.openBySeverity.high} high, ${d.openBySeverity.medium} medium, ${d.openBySeverity.low} low`)}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2">Assets affected by a changed fact</h2>
          {d.openImpacts.length === 0 ? (
            <Empty title="Nothing outdated" hint="Change an approved fact in the Knowledge Base and saved content that still carries the old value appears here." href="/knowledge" cta="Open facts" />
          ) : (
            <ul className="divide-y divide-line">
              {d.openImpacts.map((i) => (
                <li key={i.id} className="py-2">
                  <Link href={`/content/${i.asset_id}`} className="font-semibold text-accent hover:underline">{i.asset_title}</Link>{" "}
                  <StatusBadge status={i.asset_status ?? ""} />
                  <div className="text-xs text-muted">
                    &ldquo;{i.claim_text}&rdquo;: {i.attribute} changed {i.old_value} &rarr; {i.new_value} {i.unit}.{" "}
                    <Link href={`/knowledge#${i.fact_id}`} className="underline">View fact</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-2">Recently updated approved facts</h2>
          <table className="w-full text-left">
            <tbody>
              {d.recentFacts.map((f) => (
                <tr key={f.id} className="border-b border-line last:border-0">
                  <td className="py-1.5"><Link href={`/knowledge#${f.id}`} className="font-semibold hover:underline">{f.product} · {f.attribute}</Link></td>
                  <td className="py-1.5">{f.value} {f.unit}</td>
                  <td className="py-1.5"><Badge>v{f.version}</Badge></td>
                  <td className="py-1.5 text-xs text-muted">{fmt(f.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <h2 className="mb-2">Recent review decisions</h2>
          {d.recentReviews.length === 0 ? (
            <Empty title="No decisions yet" hint="Check some content, then approve, reject or request changes from its page." href="/checker" cta="Check content" />
          ) : (
            <ul className="divide-y divide-line">
              {d.recentReviews.map((r, i) => (
                <li key={i} className="py-1.5">
                  <Link href={`/content/${r.asset_id}`} className="font-semibold hover:underline">{r.title}</Link> v{r.asset_version}:{" "}
                  <b>{r.decision.replace("_", " ")}</b> by {r.reviewer}
                  <div className="text-xs text-muted">{fmt(r.decided_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between"><h2>Recent activity</h2><Link href="/audit" className="text-xs text-accent underline">All audit history</Link></div>
          <ul className="divide-y divide-line">
            {d.recentActivity.map((a) => (
              <li key={a.id} className="py-1.5">
                <code className="text-xs">{a.action}</code> <span className="text-muted">by {a.actor}</span>
                <div className="truncate text-xs text-muted">{a.detail}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
