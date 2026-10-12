-- Last Stand: причина выбывания 'mined' (игрок назвал загаданное системой). CHECK на колонке нельзя
-- расширить через ALTER, поэтому last_stand_runs пересобирается с теми же колонками, данными и тремя
-- индексами; отличие одно: 'mined' допустима. На эту таблицу никто не ссылается. Применённые
-- миграции не тронуты.

CREATE TABLE last_stand_runs_new (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  date_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'eliminated', 'cleared')),
  survived INTEGER NOT NULL DEFAULT 0,
  collisions INTEGER NOT NULL DEFAULT 0,
  eliminated_by TEXT CHECK (eliminated_by IS NULL OR eliminated_by IN ('timeout', 'exhausted', 'mined')),
  opponents_json TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '[]',
  counts_for_board INTEGER NOT NULL DEFAULT 0 CHECK (counts_for_board IN (0, 1)),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

INSERT INTO last_stand_runs_new (
  id, player_id, display_name, date_key, status, survived, collisions, eliminated_by,
  opponents_json, answers_json, counts_for_board, created_at, completed_at
)
SELECT
  id, player_id, display_name, date_key, status, survived, collisions, eliminated_by,
  opponents_json, answers_json, counts_for_board, created_at, completed_at
FROM last_stand_runs;

DROP TABLE last_stand_runs;
ALTER TABLE last_stand_runs_new RENAME TO last_stand_runs;

CREATE INDEX idx_last_stand_pool
  ON last_stand_runs(date_key, counts_for_board, completed_at DESC);

CREATE INDEX idx_last_stand_player
  ON last_stand_runs(player_id, date_key, created_at DESC);

CREATE UNIQUE INDEX idx_last_stand_one_ranked_per_day
  ON last_stand_runs(player_id, date_key) WHERE counts_for_board = 1;
