import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Minimal executor so the same runner works for PGlite (tests/local) and postgres.js (Supabase). */
export interface MigrationConn {
  exec(sql: string): Promise<void>;
  query(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}
export interface MigrationExecutor extends MigrationConn {
  transaction<T>(fn: (c: MigrationConn) => Promise<T>): Promise<T>;
}
export interface Migration { version: string; sql: string; checksum: string }

export function loadMigrations(dir: string): Migration[] {
  return fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort().map((f) => {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    return { version: f.replace(/\.sql$/, ""), sql, checksum: crypto.createHash("sha256").update(sql).digest("hex") };
  });
}

const LOCK_KEY = 7_391_001; // arbitrary constant; serialises concurrent migrators

/** Applies pending migrations in order, each in its own transaction. Refuses if an applied migration was edited. Returns versions applied. */
export async function applyMigrations(ex: MigrationExecutor, dir: string): Promise<string[]> {
  await ex.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied: string[] = [];
  for (const m of loadMigrations(dir)) {
    await ex.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
      const rows = await c.query("SELECT checksum FROM schema_migrations WHERE version = $1", [m.version]);
      if (rows.length) {
        if (rows[0].checksum !== m.checksum) throw new Error(`Migration ${m.version} was modified after it was applied. Add a new migration instead.`);
        return;
      }
      await c.exec(m.sql);
      await c.query("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES ($1, $2, $3)", [m.version, m.checksum, new Date().toISOString()]);
      applied.push(m.version);
    });
  }
  return applied;
}
