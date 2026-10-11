-- Соло-забеги живут в match_runs с собственной rules_version ('solo-to-100-v1').
-- Аддитивно: старые строки получают NULL и в соло-пул не попадают.
ALTER TABLE match_runs ADD COLUMN reached_target INTEGER CHECK (reached_target IN (0, 1));
ALTER TABLE match_runs ADD COLUMN set_par REAL;
ALTER TABLE match_runs ADD COLUMN solo_score REAL;

CREATE INDEX IF NOT EXISTS idx_match_runs_solo_pool
  ON match_runs(question_set_id, rules_version, reached_target, completed_at DESC);
