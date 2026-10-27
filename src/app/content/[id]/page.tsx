import { cookies } from "next/headers";
import Link from "next/link";
import { currentBrand } from "@/server/seed";
import { getAssetDetail } from "@/server/content";
import { listImpacts } from "@/server/ledger";
import { actorFromRole } from "@/server/auth";
import { llmConfigured } from "@/server/llm";
import { AssetWorkspace } from "@/components/AssetWorkspace";
import { PageHeader, StatusBadge } from "@/components/ui";
import { notFound } from "next/navigation";
import { HttpError } from "@/server/auth";

export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await currentBrand();
  let d;
  try { d = await getAssetDetail(brand.id, id); } catch (e) { if (e instanceof HttpError && e.status === 404) notFound(); throw e; }
  const role = actorFromRole((await cookies()).get("inkloom_role")?.value).role;
  const impacts = await listImpacts(brand.id, { assetId: id });
  return (
    <>
      <PageHeader title={d.asset.title} subtitle={`Saved content ${d.asset.id} · created by ${d.asset.created_by}`} actions={<div className="flex items-center gap-3"><StatusBadge status={d.asset.status} /><Link href="/checker" className="text-accent underline">All content</Link></div>} />
      <AssetWorkspace asset={d.asset} versions={d.versions} run={d.lastRun} findings={d.findings} decisions={d.decisions} impacts={impacts} role={role} llmConfigured={llmConfigured()} />
    </>
  );
}
