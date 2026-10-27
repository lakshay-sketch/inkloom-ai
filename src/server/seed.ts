import { ready, run, tx } from "./db";
import { DEMO_USERS, audit } from "./auth";
import { addGuideline, createBrand, createFact, decideRule, listBrands, proposeRules, type Brand } from "./knowledge";
import { createAsset, decide, runCheck, submitForReview } from "./content";

export const DEMO_GUIDELINE = `NovaTech Brand Voice (FICTIONAL demo guideline)

Tone: professional, confident and approachable. Sound premium but approachable.
Never use the phrases "guaranteed best" or "100% risk-free".
Always prefer the words "reliable" and "thoughtfully designed".
Avoid exaggerated superlatives and unsupported guarantees.
No ALL-CAPS words or repeated exclamation marks.`;

export const SAMPLE_BAD_AD = `NovaPhone X: guaranteed best phone ever!!! Up to 48 hours of battery life, a 100% risk-free purchase and a 3-year warranty. IP68 water resistance, long-lasting and rugged.`;

const TABLES = ["audit_events", "impacts", "review_decisions", "findings", "analysis_runs", "asset_versions", "assets", "rule_versions", "rules", "guidelines", "fact_versions", "facts", "evidence", "brands"];

export async function wipeAll() {
  await ready();
  await tx(async () => { for (const t of TABLES) await run(`DELETE FROM ${t}`); });
}

/** Serialises seeding/reset across serverless instances: the lock is held until the surrounding transaction ends. */
const lockSeed = () => run("SELECT pg_advisory_xact_lock(7391002)");

/** Builds the fictional NovaTech brand using the SAME services the UI uses, so every record is real and audited. Never calls the LLM (seeding must be free, fast and deterministic). */
export async function seedDemo(): Promise<Brand> {
  const mgr = DEMO_USERS.manager, rev = DEMO_USERS.reviewer, cre = DEMO_USERS.creator;
  const brand = await createBrand("NovaTech (fictional demo brand)", "Professional, confident and approachable", true);
  const b = brand.id;
  await audit(b, mgr, "demo.seeded", "brand", b, "Fictional sample data loaded");

  await createFact(b, mgr, {
    product: "NovaPhone X", attribute: "Battery life", kind: "numeric", value: "40", unit: "hours", keywords: ["battery", "charge", "playback"],
    evidence: { title: "NovaPhone X Technical Specification Sheet rev A (fictional)", reference: "DOC-NOVA-SPEC-001", excerpt: "Battery: 40 hours rated mixed use (internal test NT-BAT-12)." },
    reason: "Initial registration from spec sheet rev A",
  });
  await createFact(b, mgr, {
    product: "NovaPhone X", attribute: "Warranty", kind: "numeric", value: "2", unit: "years", keywords: ["warranty", "covered", "cover"],
    evidence: { title: "NovaTech Warranty Policy 2026 (fictional)", reference: "DOC-NOVA-WARR-014", excerpt: "Standard limited warranty: 2 years from date of purchase." },
  });
  // Deliberately NO evidence: demonstrates "Evidence required".
  await createFact(b, mgr, {
    product: "NovaPhone X", attribute: "Water resistance", kind: "text", value: "IP68", pattern: "\\bIP\\s?\\d{2}\\b", keywords: ["water", "resistan", "splash"],
    reason: "Marketing brief only; lab certificate not yet received",
  });

  const g = await addGuideline(b, mgr, { title: "NovaTech Brand Voice (fictional)", body: DEMO_GUIDELINE });
  const proposed = await proposeRules(b, mgr, g.id, { llm: false });
  // Approve the unambiguous proposals; leave the ambiguous tone rule as a DRAFT for the calibration demo.
  for (const r of proposed.rules) if (r.kind !== "ambiguous") await decideRule(b, mgr, r.id, "approved");

  const ad = await createAsset(b, cre, { title: "NovaPhone X launch ad", body: "Meet NovaPhone X. Up to 40 hours of battery life, a 2-year warranty and a thoughtfully designed body. Reliable from day one." });
  await runCheck(b, cre, ad.id, { llm: false });
  await decide(b, rev, ad.id, { decision: "approved", comment: "Seeded demo approval: both claims match registered facts with evidence." });

  const hero = await createAsset(b, cre, { title: "Landing page hero", body: "NovaPhone X: reliable power that lasts. Enjoy 40-hour battery life on a single charge." });
  await runCheck(b, cre, hero.id, { llm: false });
  await submitForReview(b, cre, hero.id);

  const social = await createAsset(b, cre, { title: "Social post draft", body: "Water resistant to IP68 with a 2 year warranty. Thoughtfully designed." });
  await runCheck(b, cre, social.id, { llm: false });

  return brand;
}

let seeding: Promise<Brand> | null = null;

/** Wipes and reseeds in ONE transaction (readers never see a half-built brand). Concurrent callers wait for the same run. */
export async function resetDemo(): Promise<Brand> {
  if (seeding) await seeding.catch(() => undefined);
  await ready();
  seeding = tx(async () => {
    await lockSeed();
    for (const t of TABLES) await run(`DELETE FROM ${t}`);
    return seedDemo();
  }).finally(() => { seeding = null; });
  return seeding;
}

/** Loads the first brand; seeds the fictional demo brand on first use (once, even across instances). Always waits for an in-flight seed. */
export async function currentBrand(): Promise<Brand> {
  if (seeding) return seeding;
  const existing = (await listBrands())[0];
  if (existing) return existing;
  seeding = tx(async () => {
    await lockSeed();
    const again = (await listBrands())[0]; // another instance may have seeded while we waited for the lock
    return again ?? seedDemo();
  }).finally(() => { seeding = null; });
  return seeding;
}
