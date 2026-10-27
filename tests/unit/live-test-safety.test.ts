import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

describe("ordinary Playwright config cannot reach a real LLM", () => {
  const cfg = read("playwright.config.ts");
  it("blanks both provider keys and the provider selector for the test server", () => {
    expect(cfg).toMatch(/ANTHROPIC_API_KEY=\s/);
    expect(cfg).toMatch(/GEMINI_API_KEY=\s/);
    expect(cfg).toMatch(/LLM_PROVIDER=\s/);
  });
  it("only runs tests/e2e, which contains no live test", () => {
    expect(cfg).toContain('testDir: "tests/e2e"');
    expect(fs.readdirSync(path.join(root, "tests", "e2e")).join()).not.toMatch(/live/i);
    expect(read("package.json")).not.toMatch(/e2e-live|playwright\.live/);
  });
});

describe("live Gemini UI test is opt-in", () => {
  const live = read("playwright.live.config.ts");
  it("refuses to load without LIVE_GEMINI=1, without a key, or in a dir containing .env.local", () => {
    expect(live).toMatch(/LIVE_GEMINI !== "1"\) throw/);
    expect(live).toMatch(/GEMINI_API_KEY must be provided/);
    expect(live).toMatch(/existsSync\("\.env\.local"\)\) throw/);
  });
  it("pre-seeds with both providers off and never clicks Reset (seeding calls the LLM)", () => {
    expect(live).toMatch(/ANTHROPIC_API_KEY= GEMINI_API_KEY= LLM_PROVIDER= node .*-p 3201/);
    expect(read("tests/e2e-live/live-gemini.spec.ts")).not.toMatch(/getByTestId\("reset-demo"\)\.click/);
  });
  it("uses its own port, database and directory", () => {
    expect(live).toContain("-p 3200");
    expect(live).toContain(".data/e2e-live.db");
    expect(live).toContain('testDir: "tests/e2e-live"');
    expect(live).toContain("retries: 0");
  });
});

describe("fetch guard caps live traffic (stubbed fetch, no network)", () => {
  let dir = ""; let calls = 0; const realFetch = globalThis.fetch;
  const url = "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent";
  const rewriteBody = JSON.stringify({ config: { systemInstruction: 'x Return {"rewrites":[{"id":number}]} y' } });
  const rulesBody = JSON.stringify({ config: { systemInstruction: 'x Return {"rules":[{"statement":string}]} y' } });
  let guarded: typeof fetch;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
    calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response("{}", { status: 200 }); }) as typeof fetch;
    process.env.LIVE_GUARD_DIR = dir;
    vi.resetModules();
    await import(/* @vite-ignore */ `${pathToFileURL(path.join(root, "tests/e2e-live/fetch-guard.mjs")).href}?t=${Math.random()}`);
    guarded = globalThis.fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.LIVE_GUARD_DIR; fs.rmSync(dir, { recursive: true, force: true }); });

  it("allows one request per operation and blocks any repeat (retry)", async () => {
    expect((await guarded(url, { method: "POST", body: rewriteBody })).status).toBe(200);
    await expect(guarded(url, { method: "POST", body: rewriteBody })).rejects.toThrow(/budget exhausted/);
    expect((await guarded(url, { method: "POST", body: rulesBody })).status).toBe(200);
    await expect(guarded(url, { method: "POST", body: rulesBody })).rejects.toThrow(/budget exhausted/);
    expect(calls).toBe(2);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("slot-")).sort()).toEqual(["slot-rewrites", "slot-rules"]);
  });
  it("blocks other hosts and unrecognised bodies but lets localhost through", async () => {
    await expect(guarded("https://api.anthropic.com/v1/messages", { method: "POST", body: rewriteBody })).rejects.toThrow(/host not allowed/);
    await expect(guarded(url, { method: "POST", body: "{}" })).rejects.toThrow(/unrecognised/);
    await expect(guarded(url, { method: "POST", body: Buffer.from(rewriteBody) as unknown as string })).rejects.toThrow(/unrecognised/);
    expect((await guarded("http://localhost:3200/x")).status).toBe(200);
    expect(calls).toBe(1);
  });
  it("logs without leaking keys", async () => {
    await guarded(url, { method: "POST", body: rewriteBody });
    const log = fs.readFileSync(path.join(dir, "guard.log"), "utf8");
    expect(log).toContain("ALLOWED op=rewrites");
    expect(log).not.toMatch(/AIza|key=/);
  });
});
