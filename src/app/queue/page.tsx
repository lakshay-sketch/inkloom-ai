import { currentBrand } from "@/server/seed";
import { listAssets } from "@/server/content";
import { PageHeader } from "@/components/ui";
import { QueueTable } from "@/components/QueueTable";

const REASON: Record<string, string> = {
  needs_rereview: "An approved fact changed and this asset still carries the old value",
  flagged: "Latest check found items needing attention",
  under_review: "Submitted; waiting for a reviewer decision",
  changes_requested: "A reviewer asked for changes",
};

export default async function Queue() {
  const brand = await currentBrand();
  const rows = (await listAssets(brand.id))
    .filter((a) => a.status in REASON)
    .map((a) => ({ id: a.id, title: a.title, status: a.status, version: a.current_version, openFindings: a.open_findings, openImpacts: a.open_impacts, updated: a.updated_at, reason: REASON[a.status] }));
  return (
    <>
      <PageHeader title="Review Queue" subtitle="Everything that needs a human: flagged content, items under review, and assets made outdated by a fact change. Approved content is never re-approved automatically." />
      <QueueTable rows={rows} />
    </>
  );
}
