-- Категория «Общие знания» (general). CHECK на колонке category нельзя расширить через ALTER, поэтому
-- match_runs и rematch_invites пересобираются с теми же колонками, данными и индексами; отличие одно:
-- 'general' допустима. Применённые миграции не тронуты.
-- На match_runs ссылаются solo_run_rounds и rematch_invites, а отложенная проверка внешних ключей
-- пересобранную таблицу не засчитывает. Поэтому строки детей откладываются в *_backup, таблица
-- пересобирается без единой ссылающейся строки, и строки возвращаются на место.

CREATE TABLE match_runs_new (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('general', 'geography', 'history', 'languages')),
  questions_json TEXT NOT NULL,
  rounds_json TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  opponent_run_id TEXT REFERENCES match_runs_new(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  rules_version TEXT,
  mini_game_id TEXT,
  mini_game_config_json TEXT,
  opponent_json TEXT,
  ghost_eligible INTEGER NOT NULL DEFAULT 0 CHECK (ghost_eligible IN (0, 1)),
  question_set_id TEXT,
  reached_target INTEGER CHECK (reached_target IN (0, 1)),
  set_par REAL,
  solo_score REAL,
  solo_outcome TEXT CHECK (solo_outcome IN ('player', 'opponent', 'tie'))
);

INSERT INTO match_runs_new (
  id, player_id, display_name, category, questions_json, rounds_json, progress, correct_count, status,
  opponent_run_id, created_at, completed_at, rules_version, mini_game_id, mini_game_config_json,
  opponent_json, ghost_eligible, question_set_id, reached_target, set_par, solo_score, solo_outcome
)
SELECT
  id, player_id, display_name, category, questions_json, rounds_json, progress, correct_count, status,
  opponent_run_id, created_at, completed_at, rules_version, mini_game_id, mini_game_config_json,
  opponent_json, ghost_eligible, question_set_id, reached_target, set_par, solo_score, solo_outcome
FROM match_runs;

CREATE TABLE solo_run_rounds_backup AS SELECT * FROM solo_run_rounds;
CREATE TABLE rematch_invites_backup AS SELECT * FROM rematch_invites;
DELETE FROM solo_run_rounds;
DROP TABLE rematch_invites;

DROP TABLE match_runs;
ALTER TABLE match_runs_new RENAME TO match_runs;

CREATE INDEX idx_match_runs_pool
  ON match_runs(category, status, completed_at DESC);

CREATE INDEX idx_match_runs_player
  ON match_runs(player_id, created_at DESC);

CREATE INDEX idx_match_runs_eligible_pool
  ON match_runs(category, status, ghost_eligible, rules_version, mini_game_id, completed_at DESC);

CREATE INDEX idx_match_runs_question_set_pool
  ON match_runs(question_set_id, status, ghost_eligible, completed_at DESC);

CREATE INDEX idx_match_runs_solo_pool
  ON match_runs(question_set_id, rules_version, reached_target, completed_at DESC);

CREATE INDEX idx_match_runs_solo_board
  ON match_runs(category, completed_at, solo_score)
  WHERE reached_target = 1;

CREATE TABLE rematch_invites (
  id TEXT PRIMARY KEY,
  recipient_player_id TEXT,
  recipient_run_id TEXT REFERENCES match_runs(id),
  challenger_run_id TEXT NOT NULL REFERENCES match_runs(id),
  category TEXT NOT NULL CHECK (category IN ('general', 'geography', 'history', 'languages')),
  recipient_progress INTEGER NOT NULL,
  challenger_progress INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  notify_status TEXT NOT NULL DEFAULT 'pending' CHECK (notify_status IN ('pending', 'sent', 'failed')),
  consumed_at INTEGER,
  rematch_run_id TEXT,
  released_at INTEGER,
  UNIQUE (recipient_run_id, challenger_run_id)
);

INSERT INTO rematch_invites (
  id, recipient_player_id, recipient_run_id, challenger_run_id, category, recipient_progress,
  challenger_progress, created_at, expires_at, notify_status, consumed_at, rematch_run_id, released_at
)
SELECT
  id, recipient_player_id, recipient_run_id, challenger_run_id, category, recipient_progress,
  challenger_progress, created_at, expires_at, notify_status, consumed_at, rematch_run_id, released_at
FROM rematch_invites_backup;

CREATE INDEX idx_rematch_invites_recipient
  ON rematch_invites(recipient_player_id, created_at DESC);

CREATE INDEX idx_rematch_invites_expiry
  ON rematch_invites(expires_at)
  WHERE consumed_at IS NULL AND released_at IS NULL;

CREATE UNIQUE INDEX idx_rematch_invites_open_run
  ON rematch_invites(challenger_run_id)
  WHERE recipient_run_id IS NULL;

INSERT INTO solo_run_rounds SELECT * FROM solo_run_rounds_backup;

DROP TABLE solo_run_rounds_backup;
DROP TABLE rematch_invites_backup;
