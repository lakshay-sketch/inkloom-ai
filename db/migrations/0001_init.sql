-- Inkloom AI schema (PostgreSQL; migration 0001). Every domain table carries brand_id
-- and every service query filters on it. Updates never overwrite history:
-- fact_versions, asset_versions and rule_versions are append-only.

CREATE TABLE IF NOT EXISTS brands (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  tone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guidelines (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_filename TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guidelines_brand ON guidelines(brand_id);

CREATE TABLE IF NOT EXISTS evidence (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  title TEXT NOT NULL,
  reference TEXT NOT NULL,          -- document name / URL / internal ID
  excerpt TEXT NOT NULL DEFAULT '', -- supporting passage (optional)
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_brand ON evidence(brand_id);

CREATE TABLE IF NOT EXISTS facts (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  product TEXT NOT NULL,
  attribute TEXT NOT NULL,          -- e.g. "Battery life"
  kind TEXT NOT NULL CHECK (kind IN ('numeric','text')),
  value TEXT NOT NULL,              -- current approved value ("32" or "IP68")
  unit TEXT NOT NULL DEFAULT '',    -- canonical unit for numeric facts
  keywords TEXT NOT NULL DEFAULT '[]', -- JSON array, used to attribute claims
  pattern TEXT NOT NULL DEFAULT '', -- regex source for text facts
  evidence_id TEXT REFERENCES evidence(id),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_brand ON facts(brand_id);

CREATE TABLE IF NOT EXISTS fact_versions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  fact_id TEXT NOT NULL REFERENCES facts(id),
  version INTEGER NOT NULL,
  value TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  evidence_id TEXT REFERENCES evidence(id),
  reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  UNIQUE (fact_id, version)
);
CREATE INDEX IF NOT EXISTS idx_fact_versions_fact ON fact_versions(fact_id);

CREATE TABLE IF NOT EXISTS rules (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  guideline_id TEXT REFERENCES guidelines(id),
  statement TEXT NOT NULL,          -- human-readable testable rule
  kind TEXT NOT NULL CHECK (kind IN ('forbidden_term','superlative','preferred_term','style','ambiguous')),
  terms TEXT NOT NULL DEFAULT '[]', -- JSON array of terms / phrases
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('high','medium','low')),
  origin TEXT NOT NULL CHECK (origin IN ('manual','deterministic','llm','seed')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  ambiguity_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_brand ON rules(brand_id, status);

CREATE TABLE IF NOT EXISTS rule_versions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  rule_id TEXT NOT NULL REFERENCES rules(id),
  version INTEGER NOT NULL,
  statement TEXT NOT NULL,
  terms TEXT NOT NULL,
  status TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  UNIQUE (rule_id, version)
);

CREATE TABLE IF NOT EXISTS assets (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','flagged','under_review','approved','changes_requested','rejected','needs_rereview')),
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_brand ON assets(brand_id, status);

CREATE TABLE IF NOT EXISTS asset_versions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (asset_id, version)
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  asset_version INTEGER NOT NULL,
  llm_status TEXT NOT NULL,         -- 'not_configured' | 'ok' | 'failed: <reason>'
  summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_asset ON analysis_runs(asset_id);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,              -- e.g. F-3K9QX2
  brand_id TEXT NOT NULL REFERENCES brands(id),
  run_id TEXT NOT NULL REFERENCES analysis_runs(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  asset_version INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('claim','terminology','guideline')),
  severity TEXT NOT NULL CHECK (severity IN ('high','medium','low')),
  verdict TEXT NOT NULL CHECK (verdict IN ('supported','conflict','unsupported','needs_review')),
  text TEXT NOT NULL,               -- exact problematic text
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  fact_id TEXT REFERENCES facts(id),
  fact_version INTEGER,
  rule_id TEXT REFERENCES rules(id),
  evidence_id TEXT REFERENCES evidence(id),
  evidence_required INTEGER NOT NULL DEFAULT 0,
  suggestion TEXT,                  -- replacement for `text`, advisory only
  suggestion_source TEXT NOT NULL DEFAULT 'deterministic',
  confidence TEXT NOT NULL CHECK (confidence IN ('exact','pattern','low')),
  review_status TEXT NOT NULL DEFAULT 'open' CHECK (review_status IN ('open','accepted','edited','rejected')),
  resolved_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_asset ON findings(asset_id, asset_version);
CREATE INDEX IF NOT EXISTS idx_findings_brand ON findings(brand_id, review_status);

CREATE TABLE IF NOT EXISTS review_decisions (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  asset_version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','changes_requested','rejected')),
  comment TEXT NOT NULL DEFAULT '',
  reviewer TEXT NOT NULL,
  role TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_asset ON review_decisions(asset_id);

-- One row per (asset, fact change) pair where saved content still carries the old value.
CREATE TABLE IF NOT EXISTS impacts (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  fact_id TEXT NOT NULL REFERENCES facts(id),
  old_version INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  asset_version INTEGER NOT NULL,
  claim_text TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  prior_status TEXT NOT NULL,       -- asset status before the change (e.g. approved)
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_impacts_brand ON impacts(brand_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_impact ON impacts(fact_id, new_version, asset_id, claim_text);

CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER GENERATED ALWAYS AS IDENTITY, -- insertion order tiebreaker for equal timestamps
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_brand ON audit_events(brand_id, created_at);
