-- «Вики-путь»: ежедневные задания, зафиксированные ревизии страниц и один путь на игрока/день.
CREATE TABLE wiki_path_challenges (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL UNIQUE,
  start_title TEXT NOT NULL CHECK (length(start_title) BETWEEN 1 AND 255),
  target_title TEXT NOT NULL CHECK (length(target_title) BETWEEN 1 AND 255),
  created_at INTEGER NOT NULL
);

CREATE TABLE wiki_path_page_revisions (
  page_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  allowed_links_json TEXT NOT NULL CHECK (json_valid(allowed_links_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (page_id, revision_id)
) WITHOUT ROWID;
CREATE TABLE wiki_path_page_refs (
  challenge_id TEXT NOT NULL REFERENCES wiki_path_challenges(id),
  normalized_title TEXT NOT NULL,
  page_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, normalized_title),
  FOREIGN KEY (page_id, revision_id) REFERENCES wiki_path_page_revisions(page_id, revision_id)
) WITHOUT ROWID;

CREATE TABLE wiki_path_challenge_targets (
  challenge_id TEXT PRIMARY KEY REFERENCES wiki_path_challenges(id),
  page_id INTEGER NOT NULL,
  canonical_title TEXT NOT NULL
);

CREATE TABLE wiki_path_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES wiki_path_challenges(id),
  date_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  current_page_id INTEGER NOT NULL,
  current_revision_id INTEGER NOT NULL,
  current_title TEXT NOT NULL,
  path_json TEXT NOT NULL CHECK (json_valid(path_json)),
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK ((status = 'in_progress' AND completed_at IS NULL) OR (status = 'completed' AND completed_at IS NOT NULL)),
  UNIQUE (player_id, date_key)
);
CREATE INDEX idx_wiki_path_board ON wiki_path_runs(date_key, status, clicks, completed_at);

-- Curated starter week. Titles are canonical Russian Wikipedia page titles.
INSERT INTO wiki_path_challenges (id, date_key, start_title, target_title, created_at) VALUES
  ('wiki-2026-10-21', '2026-10-21', 'Абай Кунанбаев', 'Альберт Эйнштейн', 1792540800000),
  ('wiki-2026-10-22', '2026-10-22', 'Байконур', 'Леонардо Ди Каприо', 1792540800000),
  ('wiki-2026-10-23', '2026-10-23', 'Шахматы', 'Тихий океан', 1792540800000),
  ('wiki-2026-10-24', '2026-10-24', 'Алматы', 'Гарри Поттер', 1792540800000),
  ('wiki-2026-10-25', '2026-10-25', 'Золотая Орда', 'Интернет', 1792540800000),
  ('wiki-2026-10-26', '2026-10-26', 'Домбра', 'Марс', 1792540800000),
  ('wiki-2026-10-27', '2026-10-27', 'Казахстан', 'Япония', 1792540800000);
