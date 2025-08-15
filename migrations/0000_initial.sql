-- D1 Migration: 0000_initial
-- Description: Sets up the initial schema for the gh-stars application.
-- Version: 1
-- Created: 2025-08-14

-- =========================
-- CANONICAL REPOS
-- =========================
CREATE TABLE IF NOT EXISTS repos (
  id                INTEGER PRIMARY KEY,                  -- GitHub numeric repo ID (rowid)
  owner_login       TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  full_name         TEXT    NOT NULL UNIQUE,              -- e.g., "owner/name"
  html_url          TEXT    NOT NULL,
  description       TEXT,
  language          TEXT,
  stargazers_count  INTEGER NOT NULL DEFAULT 0,
  forks_count       INTEGER NOT NULL DEFAULT 0,
  watchers_count    INTEGER NOT NULL DEFAULT 0,
  open_issues_count INTEGER NOT NULL DEFAULT 0,
  created_at_gh     TEXT    NOT NULL,                     -- ISO 8601 from GitHub
  updated_at_gh     TEXT    NOT NULL,
  pushed_at_gh      TEXT,
  is_fork           INTEGER NOT NULL DEFAULT 0 CHECK (is_fork IN (0,1)),
  is_private        INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0,1)),
  archived          INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  disabled          INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
  default_branch    TEXT,
  topics_json       TEXT,                                  -- JSON array string from GitHub
  license_key       TEXT,
  license_name      TEXT,
  readme_sha        TEXT,                                  -- to detect README changes
  last_synced_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  raw_data_json     TEXT                                   -- raw GitHub payload (optional)
);

CREATE INDEX IF NOT EXISTS idx_repos_owner ON repos(owner_login);
CREATE INDEX IF NOT EXISTS idx_repos_lang ON repos(language);
CREATE INDEX IF NOT EXISTS idx_repos_pushed ON repos(pushed_at_gh DESC);
CREATE INDEX IF NOT EXISTS idx_repos_updated ON repos(updated_at_gh DESC);

-- =========================
-- YOUR STAR HISTORY (single-user sink)
-- =========================
CREATE TABLE IF NOT EXISTS stars (
  repo_id     INTEGER NOT NULL,
  starred_at  TEXT    NOT NULL,                            -- ISO 8601
  PRIMARY KEY (repo_id),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stars_starred_at ON stars(starred_at DESC);

-- =========================
-- EMBEDDINGS (DO NOT store vectors in repos)
-- =========================
CREATE TABLE IF NOT EXISTS embeddings (
  id           TEXT PRIMARY KEY,                           -- e.g., "${repo_id}:${source}:${chunk_idx}"
  repo_id      INTEGER NOT NULL,
  source       TEXT    NOT NULL CHECK (source IN ('readme','desc','topics','about')),
  chunk_idx    INTEGER NOT NULL,
  text         TEXT    NOT NULL,                           -- original chunk text
  dim          INTEGER NOT NULL,                           -- model dimension
  text_hash    TEXT    NOT NULL,                           -- sha256(text) for dedupe
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_repo_src_chunk
  ON embeddings(repo_id, source, chunk_idx);

CREATE INDEX IF NOT EXISTS idx_embeddings_text_hash ON embeddings(text_hash);

-- =========================
-- AI SUMMARY / DESCRIPTION (OPTIONAL small field; keep lightweight)
-- =========================
CREATE TABLE IF NOT EXISTS repo_ai (
  repo_id       INTEGER PRIMARY KEY,
  ai_description TEXT,                                     -- concise summary
  last_indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

-- =========================
-- FULL-TEXT SEARCH (Lexical)
-- =========================
-- Keep large text out of repos; index the fields you want to query lexically.
CREATE VIRTUAL TABLE IF NOT EXISTS repo_fts USING fts5(
  full_name,                                               -- "owner/name"
  description,
  topics,
  ai_description,
  content='',
  tokenize='porter'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS tr_repos_ai_ins AFTER INSERT ON repo_ai BEGIN
  INSERT INTO repo_fts(rowid, full_name, description, topics, ai_description)
  SELECT NEW.repo_id,
         (SELECT full_name FROM repos WHERE id = NEW.repo_id),
         (SELECT description FROM repos WHERE id = NEW.repo_id),
         (SELECT topics_json FROM repos WHERE id = NEW.repo_id),
         NEW.ai_description;
END;

CREATE TRIGGER IF NOT EXISTS tr_repos_ai_upd AFTER UPDATE ON repo_ai BEGIN
  UPDATE repo_fts
     SET full_name     = (SELECT full_name FROM repos WHERE id = NEW.repo_id),
         description   = (SELECT description FROM repos WHERE id = NEW.repo_id),
         topics        = (SELECT topics_json FROM repos WHERE id = NEW.repo_id),
         ai_description= NEW.ai_description
   WHERE rowid = NEW.repo_id;
END;

CREATE TRIGGER IF NOT EXISTS tr_repos_ai_del AFTER DELETE ON repo_ai BEGIN
  DELETE FROM repo_fts WHERE rowid = OLD.repo_id;
END;

-- Also sync FTS when base repo fields change (description/topics/full_name)
CREATE TRIGGER IF NOT EXISTS tr_repos_to_fts_upd AFTER UPDATE OF full_name, description, topics_json ON repos
BEGIN
  UPDATE repo_fts
    SET full_name   = NEW.full_name,
        description = NEW.description,
        topics      = NEW.topics_json
  WHERE rowid = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tr_repos_to_fts_ins AFTER INSERT ON repos
BEGIN
  INSERT OR IGNORE INTO repo_fts(rowid, full_name, description, topics, ai_description)
  VALUES (NEW.id, NEW.full_name, NEW.description, NEW.topics_json,
          (SELECT ai_description FROM repo_ai WHERE repo_id = NEW.id));
END;

-- =========================
-- SYNC JOBS (with checks + computed duration)
-- =========================
CREATE TABLE IF NOT EXISTS sync_jobs (
  id               TEXT PRIMARY KEY,                       -- uuid
  triggered_by     TEXT,
  status           TEXT NOT NULL CHECK (status IN ('started','completed','error')),
  started_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at     TEXT,
  duration_seconds REAL,
  repos_processed  INTEGER NOT NULL DEFAULT 0,
  vectors_upserted INTEGER NOT NULL DEFAULT 0,
  error            TEXT
);

-- Compute duration when completed_at is set/updated
CREATE TRIGGER IF NOT EXISTS tr_sync_jobs_duration
AFTER UPDATE OF completed_at ON sync_jobs
WHEN NEW.completed_at IS NOT NULL
BEGIN
  UPDATE sync_jobs
     SET duration_seconds = (julianday(NEW.completed_at) - julianday(NEW.started_at)) * 86400.0
   WHERE id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_sync_jobs_started ON sync_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);

-- =========================
-- AI TAGGING (your tables kept, pointing at canonical repos)
-- =========================
CREATE TABLE IF NOT EXISTS ai_tags (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_name  TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS repo_ai_tags (
  repo_id INTEGER NOT NULL,
  tag_id  INTEGER NOT NULL,
  PRIMARY KEY (repo_id, tag_id),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)  REFERENCES ai_tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repo_ai_tags_repo ON repo_ai_tags(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_ai_tags_tag  ON repo_ai_tags(tag_id);
