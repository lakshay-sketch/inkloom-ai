import Link from "next/link";
import type { ReactNode } from "react";

const tone: Record<string, string> = {
  red: "bg-danger-soft text-danger",
  amber: "bg-warn-soft text-warn",
  green: "bg-ok-soft text-ok",
  teal: "bg-accent-soft text-accent",
  gray: "bg-info-soft text-muted",
};

export function Badge({ children, color = "gray" }: { children: ReactNode; color?: keyof typeof tone }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tone[color]}`}>{children}</span>;
}

const STATUS: Record<string, [string, keyof typeof tone]> = {
  draft: ["Draft", "gray"], flagged: ["Flagged", "amber"], under_review: ["Under review", "teal"], approved: ["Approved", "green"],
  changes_requested: ["Changes requested", "amber"], rejected: ["Rejected", "red"], needs_rereview: ["Outdated: re-review", "red"],
};
export const StatusBadge = ({ status }: { status: string }) => <Badge color={STATUS[status]?.[1] ?? "gray"}>{STATUS[status]?.[0] ?? status}</Badge>;

const VERDICT: Record<string, [string, keyof typeof tone]> = {
  supported: ["Supported", "green"], conflict: ["Conflict detected", "red"], unsupported: ["Unsupported", "amber"], needs_review: ["Needs human review", "amber"],
};
export const VerdictBadge = ({ verdict }: { verdict: string }) => <Badge color={VERDICT[verdict]?.[1] ?? "gray"}>{VERDICT[verdict]?.[0] ?? verdict}</Badge>;
export const SeverityBadge = ({ severity }: { severity: string }) => (
  <Badge color={severity === "high" ? "red" : severity === "medium" ? "amber" : "gray"}>{severity[0].toUpperCase() + severity.slice(1)}</Badge>
);

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Empty({ title, hint, href, cta }: { title: string; hint: string; href?: string; cta?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-muted">{hint}</p>
      {href && cta && <Link href={href} className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 font-semibold text-white">{cta}</Link>}
    </div>
  );
}

export const btn = "inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 font-semibold hover:bg-info-soft disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = "inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const btnDanger = "inline-flex items-center justify-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-3 py-1.5 font-semibold text-danger hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export function Th({ children }: { children?: ReactNode }) {
  return <th className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</th>;
}
export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-line px-3 py-2 align-top ${className}`}>{children}</td>;
}
export const ASSET_LABEL = "AI suggestions are advisory. A human makes the final decision.";
