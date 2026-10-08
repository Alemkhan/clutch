ALTER TABLE match_runs ADD COLUMN question_set_id TEXT;

CREATE INDEX IF NOT EXISTS idx_match_runs_question_set_pool
  ON match_runs(question_set_id, status, ghost_eligible, completed_at DESC);
