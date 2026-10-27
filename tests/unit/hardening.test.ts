import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const generateContent = vi.fn();
const anthropicCreate = vi.fn();
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent }; } }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: anthropicCreate }; } }));

const ENV_KEYS = ["NODE_ENV", "DEMO_ROLE_SWITCH", "DEMO_RESET_ENABLED", "LLM_DISABLED", "LLM_DEADLINE_MS", "LLM_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL", "ANTHROPIC_API_KEY"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS.filter((k) => k !== "NODE_ENV")) delete process.env[k];
  generateContent.mockReset(); anthropicCreate.mockReset();
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const setNodeEnv = (v: string) => { (process.env as Record<string, string>).NODE_ENV = v; };

describe("role switching is not an authorization mechanism", () => {
  it("is on in dev/test by default, off in production unless explicitly enabled", async () => {
    const { roleSwitchEnabled } = await import("@/server/auth");
    setNodeEnv("development"); expect(roleSwitchEnabled()).toBe(true);
    setNodeEnv("test"); expect(roleSwitchEnabled()).toBe(true);
    setNodeEnv("production"); expect(roleSwitchEnabled()).toBe(false);
    process.env.DEMO_ROLE_SWITCH = "1"; expect(roleSwitchEnabled()).toBe(true);
    setNodeEnv("development"); process.env.DEMO_ROLE_SWITCH = "0"; expect(roleSwitchEnabled()).toBe(false);
  });
  it("in production ignores any client-supplied role: everyone is a Creator", async () => {
    setNodeEnv("production");
    const { actorFromRole } = await import("@/server/auth");
    for (const forged of ["manager", "reviewer", "creator", undefined, "admin", ""]) expect(actorFromRole(forged).role).toBe("creator");
  });
  it("with switching enabled keeps the existing demo behaviour (cookie respected, default manager)", async () => {
    process.env.DEMO_ROLE_SWITCH = "1";
    const { actorFromRole } = await import("@/server/auth");
    expect(actorFromRole("reviewer").role).toBe("reviewer");
    expect(actorFromRole(undefined).role).toBe("manager");
  });
  it("POST /api/role refuses to set a role cookie when disabled (production default)", async () => {
    setNodeEnv("production");
    const { POST } = await import("@/app/api/role/route");
    const res = await POST(new NextRequest("http://x/api/role", { method: "POST", body: JSON.stringify({ role: "manager" }) }));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("POST /api/role still works when enabled and rejects unknown roles", async () => {
    process.env.DEMO_ROLE_SWITCH = "1";
    const { POST } = await import("@/app/api/role/route");
    const ok = await POST(new NextRequest("http://x/api/role", { method: "POST", body: JSON.stringify({ role: "reviewer" }) }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain("inkloom_role=reviewer");
    const bad = await POST(new NextRequest("http://x/api/role", { method: "POST", body: JSON.stringify({ role: "root" }) }));
    expect(bad.status).toBe(400);
  });
});

describe("destructive reset is disabled by default", () => {
  it("is refused for everyone, including a manager, unless DEMO_RESET_ENABLED=1", async () => {
    const { assertResetAllowed, DEMO_USERS, HttpError } = await import("@/server/auth");
    expect(() => assertResetAllowed(DEMO_USERS.manager)).toThrow(HttpError);
    try { assertResetAllowed(DEMO_USERS.manager); } catch (e) { expect((e as InstanceType<typeof HttpError>).status).toBe(403); }
  });
  it("when enabled still requires the manager role", async () => {
    process.env.DEMO_RESET_ENABLED = "1";
    const { assertResetAllowed, DEMO_USERS } = await import("@/server/auth");
    expect(() => assertResetAllowed(DEMO_USERS.creator)).toThrow(/cannot reset/);
    expect(() => assertResetAllowed(DEMO_USERS.manager)).not.toThrow();
  });
});

describe("seeding and the LLM", () => {
  it("seedDemo/resetDemo never call the LLM even when a provider is configured", async () => {
    process.env.GEMINI_API_KEY = "AIzaFAKEKEYFORTESTS0123456789abcdef";
    process.env.LLM_PROVIDER = "gemini";
    const { resetDemo } = await import("@/server/seed");
    await resetDemo();
    expect(generateContent).not.toHaveBeenCalled();
    expect(anthropicCreate).not.toHaveBeenCalled();
  });
  it("the seeded checks record the LLM as off, not failed", async () => {
    process.env.GEMINI_API_KEY = "AIzaFAKEKEYFORTESTS0123456789abcdef";
    const { resetDemo } = await import("@/server/seed");
    const { listAssets, getAssetDetail } = await import("@/server/content");
    const b = await resetDemo();
    for (const a of await listAssets(b.id)) expect((await getAssetDetail(b.id, a.id)).lastRun?.llm_status).toBe("not_configured");
  });
});

describe("LLM kill switch, default model and deadline", () => {
  const req = [{ id: 0, text: "rugged", sentence: "A rugged phone.", reason: "vague" }];
  it("LLM_DISABLED turns every LLM path off even with keys set", async () => {
    process.env.GEMINI_API_KEY = "AIzaFAKEKEYFORTESTS0123456789abcdef"; process.env.ANTHROPIC_API_KEY = "sk-test-placeholder";
    process.env.LLM_DISABLED = "1";
    const llm = await import("@/server/llm");
    expect(llm.llmConfigured()).toBe(false);
    expect((await llm.suggestRewrites(req)).status).toBe("not_configured");
    expect((await llm.proposeRulesLLM("some guideline text")).status).toBe("not_configured");
    expect(llm.llmStatusLabel()).toMatch(/disabled by the operator/);
    expect(generateContent).not.toHaveBeenCalled(); expect(anthropicCreate).not.toHaveBeenCalled();
  });
  it("labels the provider that is actually configured", async () => {
    const llm = await import("@/server/llm");
    expect(llm.llmStatusLabel()).toBe("no API key, deterministic mode");
    process.env.GEMINI_API_KEY = "AIzaFAKEKEYFORTESTS0123456789abcdef";
    expect(llm.llmStatusLabel()).toBe("Gemini configured");
    process.env.ANTHROPIC_API_KEY = "sk-test-placeholder";
    expect(llm.llmStatusLabel()).toBe("Claude configured");
    process.env.LLM_PROVIDER = "gemini";
    expect(llm.llmStatusLabel()).toBe("Gemini configured");
  });
  it("a provider that never answers is cut off at the deadline and reported as failed", async () => {
    process.env.GEMINI_API_KEY = "AIzaFAKEKEYFORTESTS0123456789abcdef"; process.env.LLM_DEADLINE_MS = "60";
    generateContent.mockReturnValue(new Promise(() => {}));
    const { suggestRewrites } = await import("@/server/llm");
    const t = Date.now();
    const r = await suggestRewrites(req);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.status).toMatch(/^failed: timed out after 60 ms/);
    expect(r.rewrites.size).toBe(0);
  });
  it("a check completes with deterministic findings when the provider hangs", async () => {
    process.env.GEMINI_API_KEY = "AIzaFAKEKEYFORTESTS0123456789abcdef"; process.env.LLM_DEADLINE_MS = "60";
    generateContent.mockReturnValue(new Promise(() => {}));
    const { resetDemo } = await import("@/server/seed");
    const { DEMO_USERS } = await import("@/server/auth");
    const { createAsset, runCheck } = await import("@/server/content");
    const b = await resetDemo();
    const a = await createAsset(b.id, DEMO_USERS.creator, { title: "Hang test", body: "Rugged phone with 48 hours of battery." });
    const r = await runCheck(b.id, DEMO_USERS.creator, a.id);
    expect(r.run.llm_status).toMatch(/^failed: timed out/);
    expect(r.findings.some((f) => f.text === "48 hours" && f.verdict === "conflict")).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("runCheck/proposeRules accept llm:false and make no call", async () => {
    process.env.GEMINI_API_KEY = "AIzaFAKEKEYFORTESTS0123456789abcdef";
    const { resetDemo } = await import("@/server/seed");
    const { DEMO_USERS } = await import("@/server/auth");
    const { createAsset, runCheck } = await import("@/server/content");
    const { addGuideline, proposeRules } = await import("@/server/knowledge");
    const b = await resetDemo();
    const a = await createAsset(b.id, DEMO_USERS.creator, { title: "No llm", body: "Rugged phone with 48 hours of battery." });
    expect((await runCheck(b.id, DEMO_USERS.creator, a.id, { llm: false })).run.llm_status).toBe("not_configured");
    const g = await addGuideline(b.id, DEMO_USERS.manager, { title: "Tone guideline", body: 'Never use the word "cheap". Keep it friendly.' });
    expect((await proposeRules(b.id, DEMO_USERS.manager, g.id, { llm: false })).llmStatus).toBe("not_configured");
    expect(generateContent).not.toHaveBeenCalled();
  });
});
