-- Репорты о проблемах с вопросом и минимальная продуктовая аналитика (PLAYTEST_03, beta-cut R22,
-- п. 5; AUDIT A11). Обе таблицы пишут только проверенную identity: player_id приходит из
-- resolveRequestIdentity, raw initData и токены в базу не попадают. Длины свободного текста
-- капятся в маршрутах (apps/api/src/routes/telemetry.ts), а не обрезаются молча.

-- Жалоба на вопрос с экрана разбора. verdict — вердикт сервера, при котором игрок пожаловался
-- (0 — ответ был неверным, 1 — верным); run_id пуст у отработки ошибок, где забега нет.
CREATE TABLE question_reports (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  run_id TEXT,
  category TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('solo', 'training')),
  kind TEXT NOT NULL CHECK (kind IN ('wrong_answer', 'answer_not_accepted', 'other')),
  verdict INTEGER NOT NULL CHECK (verdict IN (0, 1)),
  player_answer TEXT,
  comment TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_question_reports_question ON question_reports(question_id, created_at DESC);
CREATE INDEX idx_question_reports_player ON question_reports(player_id, created_at DESC);

-- Клиентские события: имена из общего allowlist (packages/shared/src/telemetry.ts), payload —
-- плоский JSON не длиннее 512 символов. Автоинкремент: строки только добавляются, id хранит порядок.
CREATE TABLE analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  event TEXT NOT NULL,
  run_id TEXT,
  question_id TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_analytics_events_event ON analytics_events(event, created_at DESC);
CREATE INDEX idx_analytics_events_player ON analytics_events(player_id);
