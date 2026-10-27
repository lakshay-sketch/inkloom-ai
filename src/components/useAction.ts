"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Shared pending/error handling for buttons that call the API and then refresh server data. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function run<T>(key: string, fn: () => Promise<T>, after?: (r: T) => void): Promise<T | undefined> {
    setBusy(key); setError("");
    try {
      const r = await fn();
      if (after) after(r);
      else router.refresh();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, setError, run, router };
}
