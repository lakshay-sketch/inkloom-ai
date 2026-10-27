"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Empty, StatusBadge, Td, Th } from "./ui";
import { fmt } from "./api";

interface Row { id: string; title: string; status: string; version: number; openFindings: number; openImpacts: number; updated: string; reason: string }

export function QueueTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const shown = useMemo(() => rows.filter((r) => (status === "all" || r.status === status) && r.title.toLowerCase().includes(q.toLowerCase())), [rows, q, status]);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="min-w-48 flex-1"><label htmlFor="q">Search title</label><input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" data-testid="queue-search" /></div>
        <div className="w-56"><label htmlFor="st">Status</label>
          <select id="st" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="queue-status">
            <option value="all">All awaiting action</option><option value="needs_rereview">Outdated: re-review</option><option value="flagged">Flagged</option><option value="under_review">Under review</option><option value="changes_requested">Changes requested</option>
          </select>
        </div>
      </div>
      {shown.length === 0 ? <Empty title="Queue is clear" hint={rows.length ? "No item matches the filter." : "Nothing is waiting for review. Flagged content, items submitted for review and assets made outdated by a fact change appear here."} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[680px] text-left" data-testid="queue-table">
            <thead><tr><Th>Asset</Th><Th>Status</Th><Th>Why it is here</Th><Th>Open items</Th><Th>Updated</Th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/content/${r.id}`} className="font-semibold text-accent hover:underline">{r.title}</Link> <span className="text-muted">v{r.version}</span></Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td>{r.reason}</Td>
                <Td>{r.openFindings + r.openImpacts}</Td>
                <Td className="text-muted">{fmt(r.updated)}</Td>
              </tr>))}</tbody>
          </table>
        </Card>
      )}
    </>
  );
}
