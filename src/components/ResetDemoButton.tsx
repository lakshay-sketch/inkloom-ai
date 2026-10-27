"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { btn } from "./ui";

export function ResetDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function reset() {
    if (!confirm("Reset the demo? This deletes ALL data in this local database and reloads the fictional NovaTech sample.")) return;
    setBusy(true); setErr("");
    try { await api("/api/demo/reset", "POST"); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="text-right">
      <button className={btn} onClick={reset} disabled={busy} data-testid="reset-demo">{busy ? "Resetting…" : "Reset demo data"}</button>
      {err && <p role="alert" className="mt-1 max-w-xs text-xs text-danger">{err}</p>}
    </div>
  );
}
