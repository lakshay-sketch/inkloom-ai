import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { PGlite as PGliteDb } from "@electric-sql/pglite";
import { applyMigrations, type MigrationExecutor } from "./migrate";

/**
 * PostgreSQL access. Two interchangeable backends behind the same async all/get/run/tx API:
 *  - DATABASE_URL set  -> postgres.js against Supabase/Postgres (use the pooled URL on serverless).
 *  - otherwise         -> embedded PGlite (real Postgres in-process): in memory for DATABASE_PATH=":memory:" (tests),
 *                         else a directory (default .data/pglite). Never allowed on Vercel: it would silently lose data.
 * SQL is written with `?` placeholders and converted to $n here. Schema changes live in db/migrations and are applied by
 * `npm run db:migrate` for Postgres; PGlite applies them itself on first use.
 */
type Param = string | number | null;
type Row = Record<string, unknown>;
interface Conn { query(sql: string, params: Param[]): Promise<{ rows: Row[]; count: number }>; exec(sql: string): Promise<void> }
interface Backend extends Conn { transaction<T>(fn: (c: Conn) => Promise<T>): Promise<T>; close(): Promise<void> }

const MIGRATIONS_DIR = () => path.join(process.cwd(), "db", "migrations");

type G = typeof globalThis & { __inkloomDb?: Promise<Backend>; __inkloomDbKey?: string };
const g = globalThis as G;
const als = new AsyncLocalStorage<Conn>();

/** `?` -> `$1..$n`, ignoring question marks inside single-quoted SQL literals. */
export function toPg(sql: string): string {
  let n = 0; let out = ""; let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === "?" && !quoted ? `$${++n}` : ch;
  }
  return out;
}

function backendKey(): string {
  return process.env.DATABASE_URL ? "url" : `pglite:${process.env.DATABASE_PATH ?? ""}`;
}

async function createPostgres(url: string): Promise<Backend> {
  const postgres = (await import("postgres")).default;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const make = () => postgres(url, {
    max: Number(process.env.DB_POOL_MAX || 3), prepare: false, // prepare:false is required by Supabase's transaction pooler
    idle_timeout: 20, connect_timeout: 15, ssl: local ? false : "require", onnotice: () => {},
    types: { bigint: { to: 20, from: [20], parse: Number, serialize: (x: unknown) => String(x) } },
  });
  let sql = make();
  // A serverless function is frozen between requests and the pooler drops idle connections meanwhile. A pooled connection that
  // sat unused for a while may therefore be dead, and postgres.js then waits on it until the function times out (60 s). After an
  // idle gap (wall-clock time, so it includes any freeze) we start from a fresh client instead of reusing old connections.
  const RECYCLE_MS = Number(process.env.DB_RECYCLE_MS || 5000);
  let active = 0; let lastUsed = Date.now();
  const track = async <T,>(fn: (s: typeof sql) => Promise<T>): Promise<T> => {
    if (active === 0 && Date.now() - lastUsed > RECYCLE_MS) { const old = sql; sql = make(); void old.end({ timeout: 1 }).catch(() => {}); }
    const s = sql; active++;
    try { return await fn(s); } finally { active--; lastUsed = Date.now(); }
  };
  const wrap = (s: { unsafe: (q: string, p?: never[]) => PromiseLike<unknown> }): Conn => ({
    async query(q, p) { const r = (await s.unsafe(q, p as never[])) as unknown as Row[] & { count: number }; return { rows: [...r], count: r.count }; },
    async exec(q) { await s.unsafe(q); },
  });
  // Outside a transaction every statement gets a connection of its own (reserve), so two statements are never in flight on
  // one connection. postgres.js otherwise pipelines them, and Supabase's transaction pooler answers the first and silently
  // drops the rest, which strands the connection (and every query queued behind it) forever.
  const base: Conn = {
    query: (q, p) => track(async (s) => { const r = await s.reserve(); try { return await wrap(r as never).query(q, p); } finally { r.release(); } }),
    exec: (q) => track(async (s) => { const r = await s.reserve(); try { await wrap(r as never).exec(q); } finally { r.release(); } }),
  };
  const backend: Backend = {
    ...base,
    transaction: (fn) => track((s) => s.begin(async (t) => fn(wrap(t as never))) as Promise<never>),
    close: () => sql.end({ timeout: 2 }),
  };
  const ok = await base.query("SELECT to_regclass('public.schema_migrations') AS t", []);
  if (!ok.rows[0]?.t) {
    if (process.env.DB_AUTO_MIGRATE === "1") await applyMigrations(migrationExecutor(backend), MIGRATIONS_DIR());
    else throw new Error("Database is not migrated. Run `npm run db:migrate` (see docs/DEPLOYMENT.md).");
  }
  return backend;
}

async function createPglite(): Promise<Backend> {
  if (process.env.VERCEL) throw new Error("DATABASE_URL is required on Vercel (embedded storage would silently lose data).");
  const { PGlite } = await import("@electric-sql/pglite");
  const p = process.env.DATABASE_PATH;
  let dir: string | undefined;
  if (p !== ":memory:") {
    dir = p || path.join(process.cwd(), ".data", "pglite");
    fs.mkdirSync(path.dirname(dir), { recursive: true });
  }
  const pg = new PGlite(dir);
  await pg.waitReady;
  const wrap = (c: { query: PGliteDb["query"]; exec: PGliteDb["exec"] }): Conn => ({
    async query(q, p2) { const r = await c.query(q, p2 as never[]); return { rows: r.rows as Row[], count: r.affectedRows ?? r.rows.length }; },
    async exec(q) { await c.exec(q); },
  });
  const base = wrap(pg);
  const backend: Backend = {
    ...base,
    transaction: (fn) => pg.transaction((t) => fn(wrap(t as never))),
    close: () => pg.close(),
  };
  await applyMigrations(migrationExecutor(backend), MIGRATIONS_DIR());
  return backend;
}

export function migrationExecutor(b: Pick<Backend, "exec" | "query" | "transaction">): MigrationExecutor {
  const conn = (c: Conn) => ({ exec: (s: string) => c.exec(s), query: async (s: string, p: unknown[]) => (await c.query(s, p as Param[])).rows });
  return { ...conn(b), transaction: (fn) => b.transaction((c) => fn(conn(c))) };
}

function getBackend(): Promise<Backend> {
  const key = backendKey();
  if (g.__inkloomDb && g.__inkloomDbKey === key) return g.__inkloomDb;
  const created = (process.env.DATABASE_URL ? createPostgres(process.env.DATABASE_URL) : createPglite());
  g.__inkloomDb = created; g.__inkloomDbKey = key;
  created.catch(() => { if (g.__inkloomDb === created) g.__inkloomDb = undefined; }); // retry after a failed connect/migrate check
  return created;
}

/** Resolves once the database is reachable and migrated. */
export async function ready(): Promise<void> { await getBackend(); }

export async function closeDb() {
  const b = g.__inkloomDb; g.__inkloomDb = undefined;
  if (b) await (await b).close();
}

export const now = () => new Date().toISOString();

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

async function conn(): Promise<Conn> { return als.getStore() ?? (await getBackend()); }

/** Runs fn in ONE transaction; nested calls join the outer one. Every all/get/run inside fn is routed to it automatically. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (als.getStore()) return fn();
  const b = await getBackend();
  return b.transaction((c) => als.run(c, fn));
}

export async function all<T = Row>(sql: string, ...params: Param[]): Promise<T[]> {
  const r = await (await conn()).query(toPg(sql), params);
  return r.rows.map((x) => ({ ...x })) as T[];
}
export async function get<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined> {
  const r = await (await conn()).query(toPg(sql), params);
  return r.rows[0] ? ({ ...r.rows[0] } as T) : undefined;
}
export async function run(sql: string, ...params: Param[]): Promise<{ changes: number }> {
  const r = await (await conn()).query(toPg(sql), params);
  return { changes: r.count };
}
