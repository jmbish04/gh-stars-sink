-- D1 Migration: 0000_initial
-- Description: Sets up the initial schema for the gh-stars application.
-- Version: 1
-- Created: 2025-08-14

PRAGMA foreign_keys=ON;

-- =========================
-- CANONICAL REPOS
-- =========================
CREATE TABLE repos (
  id                INTEGER PRIMARY KEY,                  -- GitHub numeric repo ID (rowid)
  owner_login       TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  full_name         TEXT    NOT NULL,                     -- e.g., "owner/name"
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
  topics_json       TEXT,                                 -- JSON array string from GitHub
  license_key       TEXT,
  license_name      TEXT,
  readme_sha        TEXT,                                 -- to detect README changes
  last_synced_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  raw_data_json     TEXT                                  -- raw GitHub payload (optional)
);

-- Case-insensitive uniqueness for repo names
CREATE UNIQUE INDEX ux_repos_full_name_nocase
  ON repos (lower(full_name));

-- Helpful indexes
CREATE INDEX idx_repos_owner     ON repos(owner_login);
CREATE INDEX idx_repos_lang      ON repos(language);
CREATE INDEX idx_repos_pushed    ON repos(pushed_at_gh DESC);
CREATE INDEX idx_repos_updated   ON repos(updated_at_gh DESC);
CREATE INDEX idx_repos_readme_sha ON repos(readme_sha);
CREATE INDEX idx_repos_license   ON repos(license_key);
CREATE INDEX idx_repos_active    ON repos(updated_at_gh DESC) WHERE archived = 0 AND disabled = 0;

-- Enforce JSON validity for topics_json
CREATE TRIGGER tr_repos_topics_json_ins
BEFORE INSERT ON repos
WHEN NEW.topics_json IS NOT NULL AND json_valid(NEW.topics_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'topics_json must be valid JSON');
END;

CREATE TRIGGER tr_repos_topics_json_upd
BEFORE UPDATE OF topics_json ON repos
WHEN NEW.topics_json IS NOT NULL AND json_valid(NEW.topics_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'topics_json must be valid JSON');
END;

-- Keep last_synced_at fresh
CREATE TRIGGER tr_repos_touch_last_synced
AFTER UPDATE ON repos
BEGIN
  UPDATE repos
     SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = NEW.id;
END;

-- =========================
-- STAR HISTORY (snapshot of latest star)
-- =========================
CREATE TABLE stars (
  repo_id     INTEGER PRIMARY KEY,
  starred_at  TEXT    NOT NULL,                            -- ISO 8601
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX idx_stars_starred_at ON stars(starred_at DESC);

-- =========================
-- EMBEDDINGS
-- =========================
CREATE TABLE embeddings (
  id           TEXT PRIMARY KEY,                           -- "${repo_id}:${source}:${chunk_idx}"
  repo_id      INTEGER NOT NULL,
  source       TEXT    NOT NULL CHECK (source IN ('readme','desc','topics','about')),
  chunk_idx    INTEGER NOT NULL,
  text         TEXT    NOT NULL,                           -- original chunk text
  dim          INTEGER NOT NULL,                           -- model dimension
  text_hash    TEXT    NOT NULL,                           -- sha256(text) for dedupe
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_embeddings_repo_src_chunk
  ON embeddings(repo_id, source, chunk_idx);

CREATE INDEX idx_embeddings_text_hash ON embeddings(text_hash);
CREATE INDEX idx_embeddings_repo      ON embeddings(repo_id);

-- =========================
-- AI SUMMARY
-- =========================
CREATE TABLE repo_ai (
  repo_id        INTEGER PRIMARY KEY,
  ai_description TEXT,
  last_indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

-- =========================
-- FULL-TEXT SEARCH
-- =========================
CREATE VIRTUAL TABLE repo_fts USING fts5(
  full_name,
  description,
  topics,
  ai_description,
  content='',
  tokenize='porter'
);

-- FTS triggers
CREATE TRIGGER tr_repos_ai_ins AFTER INSERT ON repo_ai BEGIN
  INSERT INTO repo_fts(rowid, full_name, description, topics, ai_description)
  SELECT NEW.repo_id,
         (SELECT full_name FROM repos WHERE id = NEW.repo_id),
         (SELECT description FROM repos WHERE id = NEW.repo_id),
         (SELECT topics_json FROM repos WHERE id = NEW.repo_id),
         NEW.ai_description;
END;

CREATE TRIGGER tr_repos_ai_upd AFTER UPDATE ON repo_ai BEGIN
  UPDATE repo_fts
     SET full_name      = (SELECT full_name FROM repos WHERE id = NEW.repo_id),
         description    = (SELECT description FROM repos WHERE id = NEW.repo_id),
         topics         = (SELECT topics_json FROM repos WHERE id = NEW.repo_id),
         ai_description = NEW.ai_description
   WHERE rowid = NEW.repo_id;
END;

CREATE TRIGGER tr_repos_ai_del AFTER DELETE ON repo_ai BEGIN
  DELETE FROM repo_fts WHERE rowid = OLD.repo_id;
END;

CREATE TRIGGER tr_repos_to_fts_upd AFTER UPDATE OF full_name, description, topics_json ON repos
BEGIN
  UPDATE repo_fts
     SET full_name   = NEW.full_name,
         description = NEW.description,
         topics      = NEW.topics_json
  WHERE rowid = NEW.id;
END;

CREATE TRIGGER tr_repos_to_fts_ins AFTER INSERT ON repos
BEGIN
  INSERT OR IGNORE INTO repo_fts(rowid, full_name, description, topics, ai_description)
  VALUES (NEW.id, NEW.full_name, NEW.description, NEW.topics_json,
          (SELECT ai_description FROM repo_ai WHERE repo_id = NEW.id));
END;

CREATE TRIGGER tr_repos_to_fts_del AFTER DELETE ON repos
BEGIN
  DELETE FROM repo_fts WHERE rowid = OLD.id;
END;

-- =========================
-- SYNC JOBS
-- =========================
CREATE TABLE sync_jobs (
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

CREATE TRIGGER tr_sync_jobs_duration
AFTER UPDATE OF completed_at ON sync_jobs
WHEN NEW.completed_at IS NOT NULL
BEGIN
  UPDATE sync_jobs
     SET duration_seconds = (julianday(NEW.completed_at) - julianday(NEW.started_at)) * 86400.0
   WHERE id = NEW.id;
END;

CREATE INDEX idx_sync_jobs_started ON sync_jobs(started_at DESC);
CREATE INDEX idx_sync_jobs_status  ON sync_jobs(status);

-- =========================
-- AI TAGGING
-- =========================
CREATE TABLE ai_tags (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_name  TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE repo_ai_tags (
  repo_id INTEGER NOT NULL,
  tag_id  INTEGER NOT NULL,
  PRIMARY KEY (repo_id, tag_id),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)  REFERENCES ai_tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_repo_ai_tags_repo ON repo_ai_tags(repo_id);
CREATE INDEX idx_repo_ai_tags_tag  ON repo_ai_tags(tag_id);
