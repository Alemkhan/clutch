-- Исход соло-забега против темпа. Аддитивно: одна nullable колонка и один частичный индекс.
-- NULL — соперника не было (забег ждёт его) либо забег старше миграции; ничья хранится как 'tie'.
-- Значения глазами владельца забега, как MyRunOutcome: победа, поражение, ничья.
ALTER TABLE match_runs ADD COLUMN solo_outcome TEXT CHECK (solo_outcome IN ('player', 'opponent', 'tie'));

-- Таблица результатов соло за сутки: только дошедшие до цели, по категории и времени.
CREATE INDEX IF NOT EXISTS idx_match_runs_solo_board
  ON match_runs(category, completed_at, solo_score)
  WHERE reached_target = 1;
