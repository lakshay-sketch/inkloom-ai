"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

const NAV = [
  ["/", "Dashboard"], ["/knowledge", "Brand Knowledge Base"], ["/checker", "Content Checker"], ["/ledger", "Claim Ledger"],
  ["/calibration", "Guideline Calibration"], ["/queue", "Review Queue"], ["/audit", "Audit History"], ["/evaluation", "Testing & Evaluation"],
] as const;

export function Sidebar({ role, brand, llm, roleSwitch, queueCount }: { role: string; brand: string; llm: string; roleSwitch: boolean; queueCount: number }) {
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function setRole(r: string) {
    setBusy(true);
    try { await api("/api/role", "POST", { role: r }); router.refresh(); } finally { setBusy(false); }
  }
  return (
    <aside className="flex w-full flex-col gap-4 border-b border-line bg-surface p-4 md:fixed md:inset-y-0 md:w-60 md:border-r md:border-b-0">
      <div>
        <div className="text-lg font-bold tracking-tight">Inkloom <span className="text-accent">AI</span></div>
        <div className="text-xs text-muted">Brand governance</div>
      </div>
      <div className="rounded-md bg-info-soft px-2.5 py-2 text-xs">
        <div className="font-semibold">{brand}</div>
        <div className="text-muted">Single-brand local demo</div>
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Main">
        {NAV.map(([href, label]) => {
          const active = href === "/" ? path === "/" : path.startsWith(href) || (href === "/checker" && path.startsWith("/content"));
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 whitespace-nowrap ${active ? "bg-accent-soft font-semibold text-accent" : "hover:bg-info-soft"}`}>
              {label}
              {href === "/queue" && queueCount > 0 && <span className="ml-2 rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">{queueCount}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="md:mt-auto">
        <label htmlFor="role">Demo role (not real sign-in)</label>
        <select id="role" value={role} disabled={busy || !roleSwitch} onChange={(e) => setRole(e.target.value)} data-testid="role-select">
          <option value="creator">Creator: Asha</option>
          <option value="reviewer">Reviewer: Ravi</option>
          <option value="manager">Brand Manager: Meera</option>
        </select>
        {!roleSwitch && <p className="mt-1 text-[11px] text-muted">Role switching is disabled on this deployment.</p>}
        <p className="mt-2 text-[11px] text-muted">AI: {llm}</p>
      </div>
    </aside>
  );
}
