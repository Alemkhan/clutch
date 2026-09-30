ALTER TABLE match_runs ADD COLUMN rules_version TEXT;
ALTER TABLE match_runs ADD COLUMN mini_game_id TEXT;
ALTER TABLE match_runs ADD COLUMN mini_game_config_json TEXT;
ALTER TABLE match_runs ADD COLUMN opponent_json TEXT;
ALTER TABLE match_runs ADD COLUMN ghost_eligible INTEGER NOT NULL DEFAULT 0
  CHECK (ghost_eligible IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_match_runs_eligible_pool
  ON match_runs(category, status, ghost_eligible, rules_version, mini_game_id, completed_at DESC);
