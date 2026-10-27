import Link from "next/link";
import { currentBrand } from "@/server/seed";
import { listAudit } from "@/server/auth";
import { Badge, Card, Empty, PageHeader, Td, Th } from "@/components/ui";
import { fmt } from "@/components/api";

const GROUPS = ["all", "fact", "rule", "review", "asset", "finding", "check", "impact", "guideline", "evidence"];

export default async function Audit({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type = "all" } = await searchParams;
  const brand = await currentBrand();
  const all = await listAudit(brand.id, 500);
  const rows = type === "all" ? all : all.filter((r) => r.action.startsWith(type + "."));
  const link = (r: (typeof all)[number]) =>
    r.entity_type === "asset" ? `/content/${r.entity_id}` : r.entity_type === "fact" ? `/knowledge#${r.entity_id}` : r.entity_type === "rule" ? "/calibration" : null;
  return (
    <>
      <PageHeader title="Audit History" subtitle="Append-only record of what happened, when, and which demo user or role did it. Demo roles are a switch, not verified identities." />
      <nav className="mb-3 flex flex-wrap gap-1.5" aria-label="Filter">
        {GROUPS.map((g) => <Link key={g} href={g === "all" ? "/audit" : `/audit?type=${g}`} className={`rounded-full border px-2.5 py-0.5 text-xs ${g === type ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line"}`}>{g}</Link>)}
      </nav>
      {rows.length === 0 ? <Empty title="No events" hint="Nothing matches this filter." /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left" data-testid="audit-table">
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Detail</Th></tr></thead>
            <tbody>{rows.map((r) => {
              const href = link(r);
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-muted">{fmt(r.created_at)}</Td>
                  <Td>{r.actor} <Badge>{r.role}</Badge></Td>
                  <Td><code className="text-xs">{r.action}</code></Td>
                  <Td>{r.detail} {href && <Link className="text-accent underline" href={href}>open</Link>}</Td>
                </tr>);
            })}</tbody>
          </table>
        </Card>
      )}
    </>
  );
}
