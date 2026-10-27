"use client";
import { useState } from "react";

/** Uploads a file to /api/extract and hands the extracted text to the parent. File is parsed server-side as data only. */
export function FileToText({ onText, label = "Or upload a .txt, .md, .pdf or .docx (max 5 MB)" }: { onText: (t: string, name: string) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMsg("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      onText(data.text, data.filename);
      setMsg(`Loaded ${data.filename}${data.truncated ? " (truncated to 50,000 characters)" : ""}. Review the text before using it.`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div>
      <label htmlFor="upload">{label}</label>
      <input id="upload" type="file" accept=".txt,.md,.pdf,.docx" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} data-testid="file-input" />
      {busy && <p className="mt-1 text-xs text-muted">Extracting text…</p>}
      {msg && <p className="mt-1 text-xs text-muted" role="status">{msg}</p>}
    </div>
  );
}
