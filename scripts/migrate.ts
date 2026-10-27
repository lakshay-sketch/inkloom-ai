// Applies db/migrations to a Postgres database. Usage: DATABASE_URL_DIRECT=postgres://... npm run db:migrate
// Prefer the DIRECT (non-pooled) connection string for migrations. Never prints the connection string.
import path from "node:path";
import postgres from "postgres";
import { applyMigrations } from "../src/server/migrate.ts";

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL_DIRECT (or DATABASE_URL) to the Postgres connection string."); process.exit(1); }
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : "require", onnotice: () => {} });
const conn = (s: { unsafe: (q: string, p?: never[]) => PromiseLike<unknown> }) => ({
  exec: async (q: string) => { await s.unsafe(q); },
  query: async (q: string, p: unknown[]) => [...((await s.unsafe(q, p as never[])) as Record<string, unknown>[])],
});
try {
  const applied = await applyMigrations({ ...conn(sql as never), transaction: (fn) => sql.begin((t) => fn(conn(t as never))) as Promise<never> }, path.join(process.cwd(), "db", "migrations"));
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database already up to date.");
} catch (e) {
  console.error("Migration failed:", e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/[^\s]+/g, "[redacted]") : "unknown error");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
