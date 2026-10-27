# Testing

Everything here was actually run on 2026-10-27 on macOS, Node 24.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | no errors |
| `npm run lint` | no warnings or errors |
| `npm test` | **57 passed** (core, workflow/integration, extraction, mocked LLM) |
| `npm run test:e2e` | **3 passed** (Playwright/Chromium against the production build) |
| `npm run build` | succeeds |

## What the tests cover
- `tests/unit/core.test.ts`: normalised numeric matching, conflicts + corrected suggestion, unit cross-attribution, evidence-required, unsupported ≠ conflict, prohibited-phrase precedence, draft rules ignored, ambiguous rules not enforced, offsets, change-impact spellings and documented miss, rule proposal, evaluation consistency.
- `tests/unit/workflow.test.ts` (real SQLite in memory): seeded data, check → findings with evidence refs, approval gating, accept → new version with original preserved, role enforcement, **40 → 32 showcase** (history kept, previously *approved* assets flagged, social post not flagged, impact resolves only after recheck), no-op change, brand isolation, foreign evidence rejected, input validation, audit events, dashboard counts equal stored rows, double-submit guard, seeding race regression (verified to fail without the fix).
- `tests/unit/extract.test.ts`: txt/docx/pdf extraction from tiny synthetic fixtures; rejects bad extension, renamed files, binary, empty, oversize, corrupt PDF.
- `tests/unit/llm.test.ts`: **mocked SDK only**: off without key, valid rewrite, invented numbers dropped, API failure reported with key redacted and content + deterministic findings preserved, malformed output rejected, untrusted text wrapped in data tags.
- `tests/e2e/workflow.spec.ts`: reset demo → register fact with evidence → submit copy → conflict shown with evidence ref → creator cannot approve → accept suggestion → recheck → reviewer approves → manager changes battery 40→32 → asset appears as "Outdated: re-review" in queue and ledger → open, fix, recheck, impact resolved → audit shows actors; guideline proposal stays draft until approved and ambiguous rule is flagged; evaluation page runs.

## Evaluation dataset (Testing & Evaluation page)
33 short **synthetic** cases written by the developers together with the checker (`src/core/evaluation.ts`), run against a fixed fixture, not the live DB. Result of the last run: **28 of 33 cases matched exactly; micro precision 93% (27 TP, 2 FP), recall 90% (3 FN).**

| Label | TP | FP | FN | Precision | Recall |
|---|---|---|---|---|---|
| Supported claim | 5 | 0 | 0 | 100% | 100% |
| Conflict | 6 | 0 | 2 | 100% | 75% |
| Unsupported promo | 3 | 2 | 0 | 60% | 100% |
| Prohibited term | 3 | 0 | 0 | 100% | 100% |
| Guideline violation | 2 | 0 | 1 | 100% | 67% |
| Evidence missing | 2 | 0 | 0 | 100% | 100% |
| Needs human review | 3 | 0 | 0 | 100% | 100% |
| Outdated after change | 3 | 0 | 0 | 100% | 100% |

The 5 mismatches are deliberate known weaknesses kept in the set: number words ("Two days", "forty hours") are missed; benign "best way" and "100% recycled" are flagged as unsupported claims; "BUY NOW" is missed because the ALL-CAPS check needs 4+ letters. **Limitations:** tiny sample, authors = checker authors (optimistic), English only, deterministic path only. These numbers say nothing about real-world accuracy.

## Not tested / not run
- **Live Anthropic API calls** (no key available): the LLM path is only tested with a mock.
- Real-world PDFs/DOCX (only tiny synthetic fixtures), scanned PDFs (unsupported).
- Concurrency beyond the seed race; load; accessibility audit; cross-browser (Chromium only); mobile (layout is responsive but only a desktop viewport was inspected).
- Deployment to Vercel and Supabase: not done.

## Live Gemini UI test (opt-in, at most 2 API requests)

Never part of `npm test` or `npm run test:e2e`; the ordinary Playwright server runs with `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `LLM_PROVIDER` blanked. The live test (`playwright.live.config.ts`, `tests/e2e-live/`) makes one AI rewrite request and one AI rule-proposal request, enforced by `tests/e2e-live/fetch-guard.mjs` (one request per operation, no retries, Gemini host only). It uses synthetic content and a throwaway database (`.data/e2e-live.db`) and must run from an isolated copy without `.env.local`, because `next build` rewrites `.next`. Note that seeding the demo (first page load or "Reset demo") calls the LLM when one is configured, so the config pre-seeds with both providers off.

Set `LIVE_GEMINI=1` and pass `GEMINI_API_KEY` in the environment, then run `npx playwright test -c playwright.live.config.ts`.
