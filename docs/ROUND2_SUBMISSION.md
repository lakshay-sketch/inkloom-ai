# Round 2 submission map

Status words: **Done** = implemented and exercised by a test or a recorded run; **Partial** = works with stated limits; **Not done**. Documentation alone never counts as done.

## 1. Core workflow runs end to end (30)
| Step | Status | Code | Test evidence |
|---|---|---|---|
| Demo brand, fictional, usable immediately | Done | `src/server/seed.ts` (built via the real services) | workflow.test "seeded demo"; e2e step 1 |
| Register/edit facts, evidence, version history | Done | `knowledge.ts` `createFact`, `ledger.ts` `updateFact`, `FactsPanel.tsx` | workflow.test; e2e |
| Upload guidelines (txt/md/pdf/docx) | Partial: tiny synthetic fixtures only | `extract.ts`, `FileToText.tsx` | extract.test |
| Submit content, validate, persist, findings | Done | `content.ts` `createAsset`/`runCheck`, `core/checker.ts` | core.test, workflow.test, e2e |
| Explainable findings (id, category, severity, text, explanation, fact/rule, evidence, suggestion, confidence, status) | Done | `AssetWorkspace.tsx` `FindingCard` | e2e asserts conflict text, evidence ref, suggested value |
| Accept / edit / reject suggestion, recheck, original preserved | Done | `content.ts` `applyFinding` | workflow.test; e2e |
| Approve / request changes / reject with comment, who/role/time/version | Done | `content.ts` `decide` | workflow.test; e2e |
| Claim Ledger 40 → 32 impact | Done (exact/normalised matching only) | `ledger.ts`, `core/impact.ts` | workflow.test showcase; e2e |
Limits: single brand, demo roles, deterministic matching only.

## 2. Technical depth and reliability (25)
- Validation (Zod) on all inputs; upload type/size/magic-byte checks; error mapping in `http.ts`; transactions in `db.ts`; double-submit guard; seeding race fixed and regression-tested.
- LLM adapter isolates provider, timeout + 1 retry, Zod-validated output, key redaction, untrusted text in data tags, invented-number guard. **Tested with a mock only; never run live.**
- Brand scoping: every service entry point verifies brand ownership first (cross-brand access tested). About nine follow-up statements in `content.ts` use record IDs only, relying on that check; not full defence-in-depth. DB constraints (FKs, CHECK, unique indexes) in `db/schema.sql`.
- Evaluation harness with confusion counts, honest 28/33 result (docs/TESTING.md).
- Remaining: SQLite not Postgres; no real auth; no rate limiting; no OCR.

## 3. Progress against the Round 1 plan (20)
| Round 1 item | Status |
|---|---|
| Fact registry, evidence links, version history | Done |
| AI claim extraction and verification | Partial: deterministic extraction; LLM not used for verification (by design) |
| Fact-change detection + affected-content dashboard | Done |
| Guideline → candidate rules, manager approval | Done (rule-based; AI proposals implemented but not run live) |
| Reviewer consistency test / readiness status | **Not done** (ambiguous rules are flagged; no multi-reviewer statistics) |
| Findings with explanations, suggested fixes, comments, approvals, audit log | Done |
| Roles creator / manager / reviewer | Partial: demo role switch, not authentication |
| Visual consistency, accessibility, images/OCR | **Not done** |
| Integrations (Drive/Slack/CMS/Figma) | **Not done** |
| Planned stack (FastAPI, Celery, LangGraph, pgvector, RAG) | Deliberately replaced by Next.js + SQLite for a reliable MVP |
| User interviews (5–8) | **Not done** (none conducted; none invented) |

## 4. Three named improvements (15)
| Improvement | Where | Evidence |
|---|---|---|
| Evidence-grounded verification | `core/checker.ts`; finding stores `fact_id`, `fact_version`, `evidence_id`; "Evidence required" state | core.test; workflow.test (`evidence_reference`, IP68 needs_review); e2e |
| Claim-change impact tracking | `ledger.ts` `updateFact`, `impacts` table, queue + ledger + dashboard views | workflow.test showcase; e2e steps 7–9 |
| Human approval and audit trail | `content.ts` `decide`, `review_decisions`, `audit_events`, `/audit` | workflow.test audit test; e2e audit assertions |

## 5. Usability (10)
Sidebar navigation, empty states, loading/disabled states, inline errors, role-aware disabled buttons with explanations, search/filter in the queue, links from findings to facts/rules and from impacts to assets and facts, reset-demo button. **Not done:** formal usability testing; accessibility audit; mobile inspection beyond layout rules.

## Deployment
Not performed. What I verified: `npm run build` succeeds. What is needed from you:
1. Push to GitHub: `git remote add origin <url> && git push -u origin main` (check `git status` first; `.env*` and `.data/` are git-ignored).
2. Import the repo in Vercel (framework: Next.js, Node 24). Add `ANTHROPIC_API_KEY` if desired.
3. **Blocker for a real deployment:** on Vercel the SQLite file lives in `/tmp` and is lost on cold start, and instances do not share it. The seed recreates the demo on demand, but user data will not persist. A durable deployment requires porting `db/schema.sql` and `src/server/db.ts` to Supabase/Postgres (not done). For judging, running locally is the reliable option.
