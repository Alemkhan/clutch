-- «Вики-путь» по языкам: у каждой Википедии свои статьи и ссылки, поэтому маршрут дня, снимки
-- страниц и таблица — отдельные для ru, en и kk. Номера страниц в разных Википедиях совпадают,
-- поэтому язык входит в ключ снимка. Существующие данные — русская Википедия.
--
-- Порядок важен для внешних ключей (забеги и цели ссылаются на маршрут дня): данные сначала во
-- временные таблицы, старые таблицы удаляются, новые создаются сразу под итоговыми именами и
-- заполняются — тогда отложенная проверка ключей видит, что все ссылки снова указывают на строки.
PRAGMA defer_foreign_keys = true;

CREATE TABLE wiki_tmp_challenges AS SELECT id, date_key, start_title, target_title, created_at FROM wiki_path_challenges;
CREATE TABLE wiki_tmp_revisions AS SELECT page_id, revision_id, title, allowed_links_json, created_at FROM wiki_path_page_revisions;
CREATE TABLE wiki_tmp_refs AS SELECT challenge_id, normalized_title, page_id, revision_id FROM wiki_path_page_refs;

DROP TABLE wiki_path_page_refs;
DROP TABLE wiki_path_page_revisions;
DROP TABLE wiki_path_challenges;

CREATE TABLE wiki_path_challenges (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ru' CHECK (lang IN ('ru', 'en', 'kk')),
  start_title TEXT NOT NULL CHECK (length(start_title) BETWEEN 1 AND 255),
  target_title TEXT NOT NULL CHECK (length(target_title) BETWEEN 1 AND 255),
  created_at INTEGER NOT NULL,
  UNIQUE (date_key, lang)
);
INSERT INTO wiki_path_challenges (id, date_key, lang, start_title, target_title, created_at)
  SELECT id, date_key, 'ru', start_title, target_title, created_at FROM wiki_tmp_challenges;

CREATE TABLE wiki_path_page_revisions (
  lang TEXT NOT NULL DEFAULT 'ru' CHECK (lang IN ('ru', 'en', 'kk')),
  page_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  allowed_links_json TEXT NOT NULL CHECK (json_valid(allowed_links_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (lang, page_id, revision_id)
) WITHOUT ROWID;
INSERT INTO wiki_path_page_revisions (lang, page_id, revision_id, title, allowed_links_json, created_at)
  SELECT 'ru', page_id, revision_id, title, allowed_links_json, created_at FROM wiki_tmp_revisions;

CREATE TABLE wiki_path_page_refs (
  challenge_id TEXT NOT NULL REFERENCES wiki_path_challenges(id),
  normalized_title TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ru',
  page_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, normalized_title),
  FOREIGN KEY (lang, page_id, revision_id) REFERENCES wiki_path_page_revisions(lang, page_id, revision_id)
) WITHOUT ROWID;
INSERT INTO wiki_path_page_refs (challenge_id, normalized_title, lang, page_id, revision_id)
  SELECT challenge_id, normalized_title, 'ru', page_id, revision_id FROM wiki_tmp_refs;

DROP TABLE wiki_tmp_refs;
DROP TABLE wiki_tmp_revisions;
DROP TABLE wiki_tmp_challenges;
