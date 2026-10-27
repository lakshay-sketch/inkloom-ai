"use client";
import { useState } from "react";
import { api } from "./api";
import { btn, btnPrimary } from "./ui";
import { FileToText } from "./FileToText";
import { useAction } from "./useAction";

export function CheckerForm({ sample }: { sample: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { busy, error, run, router } = useAction();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run("check", () => api<{ asset: { id: string } }>("/api/assets", "POST", { title, body, check: true }), (r) => router.push(`/content/${r.asset.id}`));
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor="title">Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Spring campaign ad" required minLength={2} maxLength={160} />
      </div>
      <div>
        <label htmlFor="body">Marketing copy</label>
        <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} required minLength={5} maxLength={20000} placeholder="Paste the ad, web copy or social post here…" />
        <div className="mt-1 text-xs text-muted">{body.length.toLocaleString()} / 20,000 characters. The text is saved before checking, so a failed check never loses it.</div>
      </div>
      <FileToText onText={(t, n) => { setBody(t); if (!title) setTitle(n.replace(/\.[^.]+$/, "")); }} />
      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={busy === "check"} data-testid="check-content">{busy === "check" ? "Checking…" : "Check Content"}</button>
        <button type="button" className={btn} onClick={() => { setTitle("Sample ad with problems"); setBody(sample); }} data-testid="load-sample">Load sample problem ad</button>
      </div>
    </form>
  );
}
