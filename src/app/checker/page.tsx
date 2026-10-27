import Link from "next/link";
import { currentBrand, SAMPLE_BAD_AD } from "@/server/seed";
import { listAssets } from "@/server/content";
import { Card, Empty, PageHeader, StatusBadge, Td, Th } from "@/components/ui";
import { CheckerForm } from "@/components/CheckerForm";
import { fmt } from "@/components/api";

export default async function CheckerPage() {
  const brand = await currentBrand();
  const assets = await listAssets(brand.id);
  return (
    <>
      <PageHeader title="Content Checker" subtitle="Paste marketing copy. It is saved, then checked against this brand's approved facts and approved rules only." />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card><CheckerForm sample={SAMPLE_BAD_AD} /></Card>
        <Card>
          <h2 className="mb-2">How a check works</h2>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>Numbers and units are matched to approved facts (exact, deterministic).</li>
            <li>Approved terminology and style rules are applied. Draft rules are ignored.</li>
            <li>Claims that cannot be verified are routed to a human, never called false.</li>
            <li>Suggested rewrites are advisory; a reviewer decides.</li>
          </ol>
        </Card>
      </div>
      <h2 className="mt-6 mb-2">Saved content</h2>
      {assets.length === 0 ? <Empty title="No content yet" hint="Check your first piece of copy above." /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead><tr><Th>Title</Th><Th>Status</Th><Th>Version</Th><Th>Open items</Th><Th>Updated</Th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <Td><Link className="font-semibold text-accent hover:underline" href={`/content/${a.id}`}>{a.title}</Link></Td>
                  <Td><StatusBadge status={a.status} /></Td>
                  <Td>v{a.current_version}</Td>
                  <Td>{a.open_findings + a.open_impacts}</Td>
                  <Td className="text-muted">{fmt(a.updated_at)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
