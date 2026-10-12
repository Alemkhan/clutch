-- Серверный журнал ошибок игрока. Источник правды для «Отработки ошибок».
-- Аддитивно: новая таблица, существующие не меняются.
--
-- Строка пишется в момент, когда сервер засчитал круг соло-забега неверным (обычный, тренировка с ботом
-- или дружеская дуэль). Поэтому в журнале лежат только вопросы, правильный ответ на которые игрок уже
-- видел в ответе круга; тренировка не открывает ему ничего нового.
--
-- owed_count: сколько ошибок осталось «отработать». Неверный ответ в забеге +1, верный в тренировке -1.
-- На нуле строка не удаляется, а помечается resolved_at; новая ошибка снова открывает её (resolved_at NULL).
CREATE TABLE IF NOT EXISTS player_mistakes (
  player_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  owed_count INTEGER NOT NULL CHECK (owed_count >= 0),
  first_mistake_at INTEGER NOT NULL,
  last_mistake_at INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY (player_id, question_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_player_mistakes_open
  ON player_mistakes(player_id, resolved_at, last_mistake_at DESC);
