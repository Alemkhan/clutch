-- Круги соло-забега сохраняются по мере игры. Одна строка = один круг забега.
-- Аддитивно: новая таблица, существующие таблицы не меняются.
--
-- Защита от двойного счёта на уровне базы: PRIMARY KEY (run_id, round_index) не даёт записать
-- один и тот же круг дважды, а удар закрывает круг условным UPDATE ... WHERE settled_at IS NULL.
-- Повторная отправка (обрыв связи, второй запрос) видит уже записанное и получает прежний ответ.
--
-- Верный ответ пишется сразу (settled_at NULL, progress_awarded NULL — ждём удар);
-- неверный закрывается в той же записи с нулевой наградой.
-- skill_distance присылает клиент: удар измеряется на устройстве, граница доверия не меняется.
CREATE TABLE IF NOT EXISTS solo_run_rounds (
  run_id TEXT NOT NULL REFERENCES match_runs(id),
  round_index INTEGER NOT NULL CHECK (round_index >= 0),
  question_id TEXT NOT NULL,
  selected_answer TEXT NOT NULL,
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  skill_distance REAL,
  skill_result TEXT CHECK (skill_result IN ('perfect', 'great', 'good', 'weak', 'miss')),
  progress_awarded REAL,
  progress_after REAL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  PRIMARY KEY (run_id, round_index)
) WITHOUT ROWID;
