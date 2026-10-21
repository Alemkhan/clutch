-- Compatibility for local databases that applied the pre-commit form of 0007.
-- Production creates the metadata tables in 0007. The temporary legacy tables below
-- make the copy statements valid on both fresh and upgraded databases.
CREATE TABLE IF NOT EXISTS wiki_path_page_revisions (
  page_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  allowed_links_json TEXT NOT NULL CHECK (json_valid(allowed_links_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (page_id, revision_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS wiki_path_page_refs (
  challenge_id TEXT NOT NULL REFERENCES wiki_path_challenges(id),
  normalized_title TEXT NOT NULL,
  page_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, normalized_title),
  FOREIGN KEY (page_id, revision_id) REFERENCES wiki_path_page_revisions(page_id, revision_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS wiki_path_page_snapshots (
  page_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  allowed_links_json TEXT NOT NULL CHECK (json_valid(allowed_links_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (page_id, revision_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS wiki_path_page_aliases (
  challenge_id TEXT NOT NULL REFERENCES wiki_path_challenges(id),
  normalized_title TEXT NOT NULL,
  page_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, normalized_title),
  FOREIGN KEY (page_id, revision_id) REFERENCES wiki_path_page_snapshots(page_id, revision_id)
) WITHOUT ROWID;

INSERT OR IGNORE INTO wiki_path_page_revisions
  (page_id, revision_id, title, allowed_links_json, created_at)
SELECT page_id, revision_id, title, allowed_links_json, created_at
FROM wiki_path_page_snapshots;

INSERT OR IGNORE INTO wiki_path_page_refs
  (challenge_id, normalized_title, page_id, revision_id)
SELECT challenge_id, normalized_title, page_id, revision_id
FROM wiki_path_page_aliases;

DROP TABLE wiki_path_page_aliases;
DROP TABLE wiki_path_page_snapshots;
