-- «На глазок» (R24a): один вопрос-прикидка в сутки для всех, ответ — число. Он разрешает только
-- ничью матча: при равенстве побеждает тот, чья прикидка ближе. Контент не сидируется — вопросы
-- заливаются отдельным шагом после сверки владельцем. Бото-забегов в рейтинговом соло нет, поэтому
-- колонки для множителя бота здесь нет: бот живёт только в тренировке, и её исход не хранится.

-- Вопрос дня. answer хранится только на сервере и не уходит клиенту до собственного ответа игрока.
-- unit — единица измерения для подписи к полю ввода (может быть пустой строкой). source_url и
-- as_of_date обязательны: без источника и даты среза число проверить нельзя. active_date — сутки
-- игры по dailyKey() (граница сдвинута на +5 ч), UNIQUE даёт «один вопрос на день».
-- explanation_json — разбор (R24d), показывается только после собственного ответа игрока. Формат:
-- {"steps":[{"label":"…","value":1400,"unit":"полей","sourceUrl":"https://…","sourceTitle":"…","asOf?":"2026"}],
--  "summary":"≈ 1 400 полей × 2 000 деталей"}; шагов 1..8, правила и лимиты длины — в
-- packages/shared/src/tiebreaker.ts (parseTiebreakerExplanation). CHECK ловит только битый JSON.
CREATE TABLE tiebreaker_questions (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  unit TEXT NOT NULL,
  answer REAL NOT NULL CHECK (answer > 0),
  source_url TEXT NOT NULL CHECK (length(source_url) > 0),
  as_of_date TEXT NOT NULL,
  active_date TEXT NOT NULL UNIQUE,
  explanation_json TEXT NOT NULL CHECK (json_valid(explanation_json)),
  created_at INTEGER NOT NULL
);

-- Ответ игрока: один на вопрос (повторный ответ невозможен, подправить прикидку после вскрытия
-- нельзя). player_id приходит из проверенной identity. date_key дублирует active_date вопроса,
-- чтобы резолюция ничьей находила ответ игрока за сутки без join. guess — число игрока;
-- multiplier = max(guess/answer, answer/guess), округлён до 4 знаков (packages/shared/src/tiebreaker.ts)
-- и хранится готовым: сравнение идёт по сохранённому значению, а не по пересчитанному с float-шумом.
-- Меньше — лучше, 1 — точное попадание.
CREATE TABLE tiebreaker_answers (
  player_id TEXT NOT NULL,
  question_id TEXT NOT NULL REFERENCES tiebreaker_questions(id),
  date_key TEXT NOT NULL,
  guess REAL NOT NULL CHECK (guess > 0),
  multiplier REAL NOT NULL CHECK (multiplier >= 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, question_id)
);

-- Распределение ответов дня и перцентиль читают все ответы одного вопроса.
CREATE INDEX idx_tiebreaker_answers_question ON tiebreaker_answers(question_id);
-- Резолюция ничьей ищет ответ игрока за сутки забега.
CREATE INDEX idx_tiebreaker_answers_player_day ON tiebreaker_answers(player_id, date_key);
