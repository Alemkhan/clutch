CREATE TABLE IF NOT EXISTS last_stand_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  date_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'eliminated', 'cleared')),
  survived INTEGER NOT NULL DEFAULT 0,
  collisions INTEGER NOT NULL DEFAULT 0,
  eliminated_by TEXT CHECK (eliminated_by IS NULL OR eliminated_by IN ('timeout', 'exhausted')),
  opponents_json TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '[]',
  counts_for_board INTEGER NOT NULL DEFAULT 0 CHECK (counts_for_board IN (0, 1)),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_last_stand_pool
  ON last_stand_runs(date_key, counts_for_board, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_last_stand_player
  ON last_stand_runs(player_id, date_key, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_last_stand_one_ranked_per_day
  ON last_stand_runs(player_id, date_key) WHERE counts_for_board = 1;
