import Link from "next/link";
import { currentBrand } from "@/server/seed";
import { listEvidence, listFacts } from "@/server/knowledge";
import { listAssets, getAssetDetail } from "@/server/content";
import { listImpacts } from "@/server/ledger";
import { extractClaims, factValueNormalized } from "@/core/claims";
import { Badge, Card, Empty, PageHeader, StatusBadge, Td, Th } from "@/components/ui";
import { fmt } from "@/components/api";

export default async function Ledger() {
  const brand = await currentBrand();
  const facts = await listFacts(brand.id);
  const evidence = new Map((await listEvidence(brand.id)).map((e) => [e.id, e]));
  const assets = await listAssets(brand.id);
  // Live trace: which saved assets (latest version) carry a claim about each fact, and does it match the current value?
  const uses = (await Promise.all(assets.map(async (a) => {
    const body = (await getAssetDetail(brand.id, a.id)).versions[0].body;
    return extractClaims(body, facts).map((c) => ({ asset: a, claim: c, matches: c.value === factValueNormalized(c.fact) }));
  }))).flat();
  const impacts = await listImpacts(brand.id);
  return (
    <>
      <PageHeader title="Claim Ledger" subtitle="Approved facts, their evidence, and every saved asset that makes a claim about them. Matching is exact/normalised for numbers and patterns; paraphrases and number words are not detected." />
      {facts.length === 0 ? <Empty title="No facts in the ledger" hint="Register an approved fact first." href="/knowledge" cta="Open Knowledge Base" /> : (
        <div className="space-y-3">
          {facts.map((f) => {
            const u = uses.filter((x) => x.claim.fact.id === f.id);
            const ev = f.evidenceId ? evidence.get(f.evidenceId) : undefined;
            return (
              <Card key={f.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2>{f.product} · {f.attribute}: {f.value} {f.unit} <Badge color="teal">v{f.version}</Badge></h2>
                  <Link className="text-accent underline" href={`/knowledge#${f.id}`}>Fact, evidence and history</Link>
                </div>
                <p className="text-muted">{ev ? `Evidence: ${ev.title} (${ev.reference})` : "Evidence required: none registered"}</p>
                {u.length === 0 ? <p className="mt-2 text-muted">No saved asset makes a claim about this fact.</p> : (
                  <table className="mt-2 w-full text-left">
                    <thead><tr><Th>Asset</Th><Th>Claim in text</Th><Th>Versus current</Th><Th>Asset status</Th></tr></thead>
                    <tbody>{u.map((x, i) => (
                      <tr key={i}>
                        <Td><Link className="font-semibold text-accent hover:underline" href={`/content/${x.asset.id}`}>{x.asset.title}</Link></Td>
                        <Td><code>{x.claim.text}</code></Td>
                        <Td>{x.matches ? <Badge color="green">matches v{f.version}</Badge> : <Badge color="red">differs from v{f.version}</Badge>}</Td>
                        <Td><StatusBadge status={x.asset.status} /></Td>
                      </tr>))}</tbody>
                  </table>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <h2 className="mt-6 mb-2">Change-impact records</h2>
      {impacts.length === 0 ? <Empty title="No fact has changed under saved content" hint="Change an approved fact to see affected assets here." href="/knowledge" cta="Change a fact" /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left" data-testid="impact-table">
            <thead><tr><Th>Affected asset</Th><Th>Outdated claim</Th><Th>Old → new</Th><Th>Prior status</Th><Th>Impact</Th><Th>Detected</Th></tr></thead>
            <tbody>{impacts.map((i) => (
              <tr key={i.id}>
                <Td><Link className="font-semibold text-accent hover:underline" href={`/content/${i.asset_id}`}>{i.asset_title}</Link><div className="text-xs"><StatusBadge status={i.asset_status ?? ""} /></div></Td>
                <Td><code>{i.claim_text}</code></Td>
                <Td><Link className="underline" href={`/knowledge#${i.fact_id}`}>{i.attribute}</Link>: {i.old_value} → <b>{i.new_value}</b> {i.unit} (v{i.old_version}→v{i.new_version})</Td>
                <Td>{i.prior_status.replace("_", " ")}</Td>
                <Td>{i.status === "open" ? <Badge color="red">Open: re-review</Badge> : <Badge color="green">Resolved {i.resolved_at && fmt(i.resolved_at)}</Badge>}</Td>
                <Td className="text-muted">{fmt(i.created_at)}</Td>
              </tr>))}</tbody>
          </table>
        </Card>
      )}
    </>
  );
}
