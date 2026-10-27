# Inkloom AI: brand governance prototype

Code Star Round 2 MVP. Checks marketing content against **approved facts** (Claim Ledger) and **approved, testable rules** (Guideline Calibration), explains every finding, and leaves the final decision to a human.

> **Prototype status, read first.** Storage is a local **SQLite** file, not Supabase/Postgres. Sign-in is a **demo role switch**, not authentication, and there is one brand. All demo data (NovaTech, NovaPhone X) is **fictional**. The optional Claude integration is implemented but **has not been run against the live API** (no key was available). See [Known limitations](#known-limitations).

## Problem and users
Facts change but published content does not ("40-hour battery" becomes 32 hours and nobody knows which ads still say 40), and guidelines such as "premium but approachable" are read differently by different reviewers. Target users: brand managers, content creators, agencies, legal/compliance reviewers, approvers (see the Round 1 plan).

## Differentiators implemented
| Differentiator | What works |
|---|---|
| **Claim Ledger** | Register facts with evidence; edit values (append-only version history); deterministic claim extraction and comparison; **changing a fact scans all saved content and persists affected-asset records** (old value, new value, prior status), flags them for re-review, never auto-approves. |
| **Guideline Calibration** | Import guideline text (txt/md/pdf/docx); propose draft rules (rule-based, plus Claude if configured); edit, approve, reject (versioned); ambiguous rules are flagged for human review and never auto-enforced; test approved rules on sample text. |

### Three named improvements
1. **Evidence-grounded verification:** every factual finding cites a registered fact (with version) and evidence record; if none exists the UI says **Evidence required** and routes it to human review. Unsupported ≠ false.
2. **Claim-change impact tracking:** `updateFact` (src/server/ledger.ts) creates a fact version and, in the same transaction, persists `impacts` rows for saved assets still carrying the old value.
3. **Human approval and audit trail:** decisions (approve / request changes / reject + comment) are stored with reviewer, role, timestamp and content version; fact, rule, finding and review actions are written to `audit_events`.

## Pages
Dashboard · Brand Knowledge Base · Content Checker (+ content workspace) · Claim Ledger · Guideline Calibration · Review Queue · Audit History · Testing & Evaluation.

## Architecture
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Layers: `src/core` (pure deterministic logic) → `src/server` (SQLite services, roles, audit, LLM adapter) → `src/app/api` (route handlers) → React pages/components.

## Setup
Requires Node 24 (uses the built-in `node:sqlite`).
```bash
npm install
cp .env.example .env.local      # optional: add ANTHROPIC_API_KEY
npm run dev                     # http://localhost:3000, auto-seeds the NovaTech demo
```
The first page load seeds fictional demo data. **Reset demo data** on the dashboard wipes the local DB and reseeds it.

### Environment variables
See `.env.example`. `ANTHROPIC_API_KEY` is read server-side only and never sent to the browser. With no key the app runs fully deterministically and says so in the UI.

### Database
Schema: [`db/schema.sql`](db/schema.sql) (applied automatically on first connection; `CREATE TABLE IF NOT EXISTS`). Tables: brands, guidelines, rules, rule_versions, evidence, facts, fact_versions, assets, asset_versions, analysis_runs, findings, review_decisions, impacts, audit_events; FKs, CHECK constraints and indexes; each service entry point verifies the record belongs to the brand (cross-brand access is unit-tested). A handful of follow-up statements in `src/server/content.ts` then use record IDs without repeating `brand_id`; adding it everywhere is a listed hardening TODO. **There is no Supabase migration**: porting this schema to Postgres is future work.

## Tests
```bash
npm run lint && npx tsc --noEmit
npm test            # vitest: 57 unit/integration tests
npm run test:e2e    # playwright: builds, starts the app on :3100 with a throw-away DB, 3 browser tests
```
Results and caveats: [docs/TESTING.md](docs/TESTING.md).

## Deployment
Not deployed. Vercel would run the app but its filesystem is **not durable**, so data would reset on cold starts; use it only for a read-through demo, or run locally for judging. A durable deployment needs the Postgres port. Steps and blockers: [docs/ROUND2_SUBMISSION.md](docs/ROUND2_SUBMISSION.md#deployment).

## Known limitations
- SQLite local storage; not production persistence. Single brand in the UI (brand scoping is enforced in the service layer and unit-tested).
- Demo roles are a dropdown, **not authentication or access control**. Role checks run server-side but any visitor can switch roles.
- Claim matching is digits + units + nearest keyword. It misses number words ("forty"), paraphrases ("two days of battery") and unit conversion.
- Multi-reviewer calibration / agreement statistics from the Round 1 plan are **not implemented**.
- No image/visual/accessibility checks, no OCR (scanned PDFs are rejected), no integrations (Drive, Slack, CMS), no RAG/vector search, no LangGraph (Round 1 planned stack replaced by a simpler one).
- Claude integration untested against the live API.
- Evaluation is 33 synthetic cases written with the checker; it proves nothing about production accuracy.

## Future scope
Postgres/Supabase + real auth and RLS; reviewer calibration with agreement statistics; semantic claim matching with evidence retrieval; OCR and visual checks; Slack/Drive/CMS integrations.

## Team
See [docs/TEAM_CONTRIBUTIONS.md](docs/TEAM_CONTRIBUTIONS.md) (placeholders; to be completed by the team).
