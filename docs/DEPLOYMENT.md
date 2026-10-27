# Deployment (Vercel + Supabase PostgreSQL)

## Storage
- `DATABASE_URL` set: PostgreSQL via `postgres.js` (Supabase). Unset: embedded Postgres (PGlite) for local dev and tests only. On Vercel the app refuses to start without `DATABASE_URL` so data can never silently live in `/tmp`.
- Schema = `db/migrations/*.sql`, applied in order and recorded in `schema_migrations` with a checksum (an applied file that is edited later is rejected; add a new migration instead).

## One-time setup
1. Create a separate Supabase project for the demo. In *Project Settings > Database > Connection string* copy the **transaction pooler** string (port 6543) and the **direct** string.
2. Migrate (never done at cold start):
   `DATABASE_URL_DIRECT='postgresql://…' npm run db:migrate`
3. Vercel environment variables (names only):
   `DATABASE_URL` (pooled), `GEMINI_API_KEY`, `LLM_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `LLM_DISABLED` (set `1` for a deterministic-only emergency mode), `DEMO_ROLE_SWITCH`, `DEMO_RESET_ENABLED` (leave unset in Production), optional `DB_POOL_MAX`, `LLM_TIMEOUT_MS`, `LLM_DEADLINE_MS`. Leave `ANTHROPIC_API_KEY` and `DATABASE_PATH` unset.
4. The first request seeds the fictional demo brand once (guarded by a Postgres advisory lock, no LLM calls).

## Verify before promoting
- Deploy a Preview against the demo database; reload pages, redeploy, and confirm created content is still there.
- Production defaults: role switching is OFF (everyone is a Creator) unless `DEMO_ROLE_SWITCH=1`; reset is OFF unless `DEMO_RESET_ENABLED=1`.

## Rollback
Migrations are additive. Use Supabase backups for the data and Vercel's instant rollback for the code.
