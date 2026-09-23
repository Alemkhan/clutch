CREATE TABLE IF NOT EXISTS match_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('geography', 'history', 'languages')),
  questions_json TEXT NOT NULL,
  rounds_json TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  opponent_run_id TEXT REFERENCES match_runs(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_match_runs_pool
  ON match_runs(category, status, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_runs_player
  ON match_runs(player_id, created_at DESC);
