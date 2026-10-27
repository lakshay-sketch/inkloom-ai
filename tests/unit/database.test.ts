import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PGlite as PGliteDb } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..");
const tmp: string[] = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "inkloom-db-")); tmp.push(d); return d; };
let savedPath: string | undefined; let savedUrl: string | undefined; let savedVercel: string | undefined;

beforeEach(() => { savedPath = process.env.DATABASE_PATH; savedUrl = process.env.DATABASE_URL; savedVercel = process.env.VERCEL; delete process.env.DATABASE_URL; delete process.env.VERCEL; });
afterEach(async () => {
  const db = await import("@/server/db"); await db.closeDb();
  for (const [k, v] of [["DATABASE_PATH", savedPath], ["DATABASE_URL", savedUrl], ["VERCEL", savedVercel]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.resetModules();
  while (tmp.length) fs.rmSync(tmp.pop()!, { recursive: true, force: true });
});

describe("SQL placeholder conversion", () => {
  it("turns ? into $n but leaves ? inside quoted literals alone", async () => {
    const { toPg } = await import("@/server/db");
    expect(toPg("SELECT * FROM t WHERE a = ? AND b = ? LIMIT ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = $2 LIMIT $3");
    expect(toPg("SELECT 'what?' AS q, x FROM t WHERE y = ?")).toBe("SELECT 'what?' AS q, x FROM t WHERE y = $1");
  });
});

describe("migrations", () => {
  const TABLES = ["brands", "guidelines", "evidence", "facts", "fact_versions", "rules", "rule_versions", "assets", "asset_versions", "analysis_runs", "findings", "review_decisions", "impacts", "audit_events"];
  async function freshExecutor() {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    const conn = (c: { query: PGliteDb["query"]; exec: PGliteDb["exec"] }) => ({ exec: async (s: string) => { await c.exec(s); }, query: async (s: string, p: unknown[]) => (await c.query(s, p as never[])).rows as Record<string, unknown>[] });
    return { pg, ex: { ...conn(pg), transaction: <T,>(fn: (c: ReturnType<typeof conn>) => Promise<T>) => pg.transaction((t) => fn(conn(t as never))) } };
  }
  it("applies 0001_init once, records it, and is idempotent", async () => {
    const { applyMigrations } = await import("@/server/migrate");
    const { pg, ex } = await freshExecutor();
    const dir = path.join(root, "db", "migrations");
    expect(await applyMigrations(ex, dir)).toEqual(["0001_init"]);
    expect(await applyMigrations(ex, dir)).toEqual([]);
    const tables = (await pg.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map((r) => r.table_name);
    for (const t of [...TABLES, "schema_migrations"]) expect(tables).toContain(t);
    expect((await pg.query("SELECT version FROM schema_migrations")).rows).toHaveLength(1);
    await pg.close();
  });
  it("refuses to continue if an applied migration file was edited", async () => {
    const { applyMigrations } = await import("@/server/migrate");
    const { pg, ex } = await freshExecutor();
    const dir = mk();
    fs.copyFileSync(path.join(root, "db", "migrations", "0001_init.sql"), path.join(dir, "0001_init.sql"));
    await applyMigrations(ex, dir);
    fs.appendFileSync(path.join(dir, "0001_init.sql"), "\n-- tampered\n");
    await expect(applyMigrations(ex, dir)).rejects.toThrow(/modified after it was applied/);
    await pg.close();
  });
  it("applies later migrations in order and rolls a failing one back completely", async () => {
    const { applyMigrations } = await import("@/server/migrate");
    const { pg, ex } = await freshExecutor();
    const dir = mk();
    fs.copyFileSync(path.join(root, "db", "migrations", "0001_init.sql"), path.join(dir, "0001_init.sql"));
    fs.writeFileSync(path.join(dir, "0002_ok.sql"), "CREATE TABLE extra_ok (id TEXT PRIMARY KEY);");
    fs.writeFileSync(path.join(dir, "0003_bad.sql"), "CREATE TABLE extra_bad (id TEXT PRIMARY KEY); SELECT * FROM does_not_exist;");
    await expect(applyMigrations(ex, dir)).rejects.toThrow();
    const names = (await pg.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map((r) => r.table_name);
    expect(names).toContain("extra_ok");
    expect(names).not.toContain("extra_bad");
    expect((await pg.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) => r.version)).toEqual(["0001_init", "0002_ok"]);
    await pg.close();
  });
  it("has no SQLite-only constructs left in the application code or schema", () => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|tsx|sql)$/.test(f.name)) { const t = fs.readFileSync(p, "utf8"); if (/node:sqlite|\browid\b|PRAGMA|INSERT OR (IGNORE|REPLACE)|AUTOINCREMENT/.test(t)) hits.push(path.relative(root, p)); } } };
    walk(path.join(root, "src")); walk(path.join(root, "db"));
    expect(hits).toEqual([]);
  });
});

describe("transactions and constraints", () => {
  beforeEach(() => { process.env.DATABASE_PATH = ":memory:"; });
  const brand = (id: string) => `INSERT INTO brands (id, name, is_demo, tone, created_at) VALUES ('${id}','n',0,'t','2026-01-01')`;
  it("rolls back every write when the transaction throws, and commits otherwise", async () => {
    const { tx, run, get, ready } = await import("@/server/db"); await ready();
    await expect(tx(async () => { await run(brand("B-ROLL")); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await get("SELECT id FROM brands WHERE id = ?", "B-ROLL")).toBeUndefined();
    await tx(async () => { await run(brand("B-OK")); });
    expect(await get("SELECT id FROM brands WHERE id = ?", "B-OK")).toBeDefined();
  });
  it("joins nested transactions to the outer one (outer rollback undoes inner writes)", async () => {
    const { tx, run, get, ready } = await import("@/server/db"); await ready();
    await expect(tx(async () => { await tx(async () => { await run(brand("B-NEST")); }); throw new Error("outer fails"); })).rejects.toThrow();
    expect(await get("SELECT id FROM brands WHERE id = ?", "B-NEST")).toBeUndefined();
  });
  it("serialises concurrent transactions without lost updates", async () => {
    const { tx, run, get, ready } = await import("@/server/db"); await ready();
    await run(brand("B-CNT"));
    await run("INSERT INTO assets (id, brand_id, title, status, current_version, created_by, created_at, updated_at) VALUES ('A-CNT','B-CNT','t','draft',1,'u','2026-01-01','2026-01-01')");
    await Promise.all(Array.from({ length: 8 }, () => tx(async () => {
      const a = await get<{ current_version: number }>("SELECT current_version FROM assets WHERE id = ?", "A-CNT");
      await run("UPDATE assets SET current_version = ? WHERE id = ?", a!.current_version + 1, "A-CNT");
    })));
    expect((await get<{ current_version: number }>("SELECT current_version FROM assets WHERE id = ?", "A-CNT"))!.current_version).toBe(9);
  });
  it("keeps foreign keys, CHECK and unique constraints", async () => {
    const { run, all, ready } = await import("@/server/db"); await ready();
    await expect(run("INSERT INTO assets (id, brand_id, title, status, current_version, created_by, created_at, updated_at) VALUES ('A1','NOPE','t','draft',1,'u','x','x')")).rejects.toThrow(/foreign key|violates/i);
    await run(brand("B-C"));
    await expect(run("INSERT INTO assets (id, brand_id, title, status, current_version, created_by, created_at, updated_at) VALUES ('A2','B-C','t','bogus',1,'u','x','x')")).rejects.toThrow(/check|violates/i);
    const imp = "INSERT INTO facts (id, brand_id, product, attribute, kind, value, updated_by, updated_at, created_at) VALUES ('F1','B-C','p','a','text','v','u','x','x')";
    await run(imp);
    await run("INSERT INTO assets (id, brand_id, title, status, current_version, created_by, created_at, updated_at) VALUES ('A3','B-C','t','draft',1,'u','x','x')");
    const ins = "INSERT INTO impacts (id, brand_id, fact_id, old_version, new_version, asset_id, asset_version, claim_text, old_value, new_value, prior_status, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING";
    await run(ins, "I1", "B-C", "F1", 1, 2, "A3", 1, "c", "o", "n", "approved", "open", "x");
    await run(ins, "I2", "B-C", "F1", 1, 2, "A3", 1, "c", "o", "n", "approved", "open", "x");
    expect(await all("SELECT id FROM impacts")).toHaveLength(1);
  });
  it("orders same-timestamp rows by insertion (seq replaces rowid)", async () => {
    const { run, ready } = await import("@/server/db"); await ready();
    const { listAudit } = await import("@/server/auth");
    await run(brand("B-ORD"));
    for (const id of ["AU-1", "AU-2", "AU-3"]) await run("INSERT INTO audit_events (id, brand_id, action, entity_type, entity_id, actor, role, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?)", id, "B-ORD", "a", "e", id, "u", "r", "", "2026-01-01T00:00:00.000Z");
    expect((await listAudit("B-ORD")).map((r) => r.id)).toEqual(["AU-3", "AU-2", "AU-1"]);
  });
});

describe("persistence", () => {
  it("data written by one database instance is there after closing and reopening (new instance)", async () => {
    process.env.DATABASE_PATH = path.join(mk(), "pg");
    vi.resetModules();
    let db = await import("@/server/db");
    const { resetDemo } = await import("@/server/seed");
    let content = await import("@/server/content");
    const b = await resetDemo();
    const before = await content.listAssets(b.id);
    const { listAudit } = await import("@/server/auth");
    const auditBefore = (await listAudit(b.id)).map((r) => r.id);
    expect(before).toHaveLength(3);
    await db.closeDb();

    vi.resetModules();
    db = await import("@/server/db"); content = await import("@/server/content");
    const auth = await import("@/server/auth"); const seed = await import("@/server/seed");
    const after = await content.listAssets(b.id);
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id));
    expect((await auth.listAudit(b.id)).map((r) => r.id)).toEqual(auditBefore);
    expect((await seed.currentBrand()).id).toBe(b.id); // reopened DB is not reseeded
    const detail = await content.getAssetDetail(b.id, after[0].id);
    expect(detail.versions[0].body.length).toBeGreaterThan(10);
  });
});

describe("production safety", () => {
  it("refuses to use embedded storage on Vercel without DATABASE_URL (would silently lose data)", async () => {
    process.env.VERCEL = "1"; process.env.DATABASE_PATH = ":memory:";
    vi.resetModules();
    const { ready } = await import("@/server/db");
    await expect(ready()).rejects.toThrow(/DATABASE_URL is required on Vercel/);
  });
});

// Optional: runs only when a throwaway Postgres is provided (TEST_PG_EMPTY_URL = a migrated-never database).
describe.skipIf(!process.env.TEST_PG_EMPTY_URL)("postgres.js backend", () => {
  it("fails with a clear message when the database has not been migrated", async () => {
    process.env.DATABASE_URL = process.env.TEST_PG_EMPTY_URL;
    vi.resetModules();
    const { ready } = await import("@/server/db");
    await expect(ready()).rejects.toThrow(/not migrated.*db:migrate/);
  });
});

// Optional: needs a migrated throwaway Postgres in TEST_PG_URL.
describe.skipIf(!process.env.TEST_PG_URL)("idle connection recycling (postgres.js backend)", () => {
  it("starts from a fresh connection after an idle gap, so a connection dropped while idle is never reused", async () => {
    process.env.DATABASE_URL = process.env.TEST_PG_URL; process.env.DB_RECYCLE_MS = "300";
    vi.resetModules();
    const { all } = await import("@/server/db");
    const pid = async () => (await all<{ p: number }>("SELECT pg_backend_pid() AS p"))[0].p;
    const first = await pid();
    await new Promise((r) => setTimeout(r, 600)); // longer than DB_RECYCLE_MS: simulates a frozen, idle function
    const afterGap = await pid();
    expect(afterGap).not.toBe(first);
    delete process.env.DB_RECYCLE_MS;
  });
});
