-- Схема Clutch целиком. Сжатая история миграций 0001–0017 (2026-10-13).
--
-- Почему сжали. Семнадцать шагов накопились за разработку, и три из них пересобирали таблицы
-- целиком только чтобы расширить CHECK: SQLite не умеет менять его через ALTER. На первом же
-- деплое это означало бы три пересборки таблиц без транзакции на пустой базе — риск без повода.
-- Исключение из правила «не переписывай применённую миграцию» сделано осознанно и ровно потому,
-- что применять было некуда: на remote не разворачивали ничего ни разу, а локальная база пуста.
-- Такая возможность есть только до первого деплоя; после него — снова только новые миграции.
--
-- Схема здесь дословно равна результату прежних 0001–0017: это проверено машинно сравнением
-- sqlite_master (таблицы, колонки, CHECK, индексы), а не на глаз. История шагов осталась в git.

-- Забеги. Одна таблица на все режимы, кроме Last Stand: режим различается rules_version
-- ('solo-to-100-v2' — зачётный соло, 'solo-practice-v1' — тренировка, 'solo-friend-v1' — дуэль
-- по ссылке; 'race-to-100-v3' остался у legacy-строк удалённого режима гонки).
CREATE TABLE match_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- 'general' добавлена, когда общие знания стали категорией по умолчанию (DEC-07).
  category TEXT NOT NULL CHECK (category IN ('general', 'geography', 'history', 'languages')),
  questions_json TEXT NOT NULL,
  rounds_json TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  -- Запись-темп, против которой шёл этот забег. Самоссылка: соперник — такой же забег.
  opponent_run_id TEXT REFERENCES match_runs(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  -- Снимок условий: по ним пул отбирает только совместимые записи.
  rules_version TEXT,
  mini_game_id TEXT,
  mini_game_config_json TEXT,
  opponent_json TEXT,
  ghost_eligible INTEGER NOT NULL DEFAULT 0 CHECK (ghost_eligible IN (0, 1)),
  question_set_id TEXT,
  reached_target INTEGER CHECK (reached_target IN (0, 1)),
  set_par REAL,
  solo_score REAL,
  -- Исход глазами владельца забега. NULL — соперника не было, забег ждёт его.
  solo_outcome TEXT CHECK (solo_outcome IN ('player', 'opponent', 'tie')),
  -- Матч — это пара (DEC-09). Запись забирает атомарный условный UPDATE: в D1 нет ни блокировок
  -- строк, ни SKIP LOCKED, поэтому ровно один одновременный запрос меняет строку. claimed_at
  -- нужен, чтобы брошенный претендент не запирал чужую запись навсегда.
  claimed_by TEXT,
  claimed_at INTEGER,
  -- Претендент замолчал, запись вернулась в подбор, пара разорвана. Нужен, чтобы вернувшемуся
  -- можно было честно сказать, куда делась полоса соперника.
  pace_released INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_match_runs_player ON match_runs(player_id, created_at DESC);
CREATE INDEX idx_match_runs_pool ON match_runs(category, status, completed_at DESC);
CREATE INDEX idx_match_runs_eligible_pool ON match_runs(category, status, ghost_eligible, rules_version, mini_game_id, completed_at DESC);
CREATE INDEX idx_match_runs_question_set_pool ON match_runs(question_set_id, status, ghost_eligible, completed_at DESC);
CREATE INDEX idx_match_runs_solo_pool ON match_runs(question_set_id, rules_version, reached_target, completed_at DESC);
-- Таблица результатов соло за сутки: только дошедшие до цели.
CREATE INDEX idx_match_runs_solo_board ON match_runs(category, completed_at, solo_score) WHERE reached_target = 1;
-- Свободные записи для подбора: ещё никем не занятые.
CREATE INDEX idx_match_runs_unclaimed ON match_runs(question_set_id, completed_at DESC) WHERE claimed_by IS NULL AND reached_target = 1;

-- Круги соло-забега, по одной строке на круг; пишутся по ходу игры, поэтому закрытая вкладка
-- забег не теряет. Двойной счёт отсекает PRIMARY KEY, а удар закрывает круг условным
-- UPDATE ... WHERE settled_at IS NULL: повторный запрос видит записанное и получает прежний ответ.
-- Верный ответ пишется сразу (settled_at NULL, progress_awarded NULL — ждём удар);
-- неверный закрывается в той же записи с нулевой наградой.
CREATE TABLE solo_run_rounds (
  run_id TEXT NOT NULL REFERENCES match_runs(id),
  round_index INTEGER NOT NULL CHECK (round_index >= 0),
  question_id TEXT NOT NULL,
  selected_answer TEXT NOT NULL,
  -- Присылает клиент. Рядом лежит окно, измеренное сервером.
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  -- Выводится сервером из active_elapsed_ms, клиентом не присылается.
  skill_distance REAL,
  skill_result TEXT CHECK (skill_result IN ('perfect', 'great', 'good', 'weak', 'miss')),
  progress_awarded REAL,
  progress_after REAL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  -- Момент удара, как его сообщил клиент: сырой ввод для поиска выбросов под лиги.
  active_elapsed_ms REAL,
  -- Окно ответа по часам сервера. Верхняя граница времени на вопрос, не его длительность.
  answer_window_ms REAL,
  PRIMARY KEY (run_id, round_index)
) WITHOUT ROWID;

-- Журнал ошибок игрока: источник правды для «Отработки ошибок». Строка пишется, когда сервер
-- засчитал круг неверным, поэтому в журнале только вопросы, ответ на которые игрок уже видел.
-- owed_count: сколько ошибок осталось отработать (неверный ответ +1, верный в тренировке −1).
CREATE TABLE player_mistakes (
  player_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  owed_count INTEGER NOT NULL CHECK (owed_count >= 0),
  first_mistake_at INTEGER NOT NULL,
  last_mistake_at INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY (player_id, question_id)
) WITHOUT ROWID;

CREATE INDEX idx_player_mistakes_open ON player_mistakes(player_id, resolved_at, last_mistake_at DESC);

-- Согласие на сообщения бота. Игрок БЕЗ строки считается согласным (модель opt-out, см.
-- apps/api/src/notifications/outbid.ts); строка с outbid_enabled = 0 — отписка.
CREATE TABLE player_notification_prefs (
  player_id TEXT PRIMARY KEY,
  outbid_enabled INTEGER NOT NULL DEFAULT 1 CHECK (outbid_enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

-- Приглашения. Два вида в одной таблице:
--   адресное на реванш — его создаёт нажатие того, кто обошёл запись (R17);
--   открытое «Позвать друга» — recipient_run_id IS NULL, адресатом становится погасивший.
-- Поэтому адресат и его запись могут быть пустыми. UNIQUE пары — защита от дубля на уровне базы,
-- а id служит неугадываемым payload для startapp (после «rm_»).
CREATE TABLE rematch_invites (
  id TEXT PRIMARY KEY,
  recipient_player_id TEXT,
  recipient_run_id TEXT REFERENCES match_runs(id),
  challenger_run_id TEXT NOT NULL REFERENCES match_runs(id),
  category TEXT NOT NULL CHECK (category IN ('general', 'geography', 'history', 'languages')),
  recipient_progress INTEGER NOT NULL,
  challenger_progress INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  notify_status TEXT NOT NULL DEFAULT 'pending' CHECK (notify_status IN ('pending', 'sent', 'failed')),
  consumed_at INTEGER,
  rematch_run_id TEXT,
  -- Плановый проход вернул просроченное приглашение в пул; метка делает проход идемпотентным.
  released_at INTEGER,
  UNIQUE (recipient_run_id, challenger_run_id)
);

CREATE INDEX idx_rematch_invites_recipient ON rematch_invites(recipient_player_id, created_at DESC);
CREATE INDEX idx_rematch_invites_expiry ON rematch_invites(expires_at) WHERE consumed_at IS NULL AND released_at IS NULL;
-- Одно открытое приглашение на забег: повторный вызов находит его, а не плодит новые. Тот же
-- индекс обслуживает проверку резерва в общем подборе.
CREATE UNIQUE INDEX idx_rematch_invites_open_run ON rematch_invites(challenger_run_id) WHERE recipient_run_id IS NULL;

-- Last Stand: отдельный режим и отдельная таблица результатов.
-- 'mined' — игрок назвал загаданное системой (DEC-08).
CREATE TABLE last_stand_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  date_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'eliminated', 'cleared')),
  survived INTEGER NOT NULL DEFAULT 0,
  collisions INTEGER NOT NULL DEFAULT 0,
  eliminated_by TEXT CHECK (eliminated_by IS NULL OR eliminated_by IN ('timeout', 'exhausted', 'mined')),
  opponents_json TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '[]',
  counts_for_board INTEGER NOT NULL DEFAULT 0 CHECK (counts_for_board IN (0, 1)),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_last_stand_player ON last_stand_runs(player_id, date_key, created_at DESC);
CREATE INDEX idx_last_stand_pool ON last_stand_runs(date_key, counts_for_board, completed_at DESC);
-- В зачёт идёт один забег игрока за сутки.
CREATE UNIQUE INDEX idx_last_stand_one_ranked_per_day ON last_stand_runs(player_id, date_key) WHERE counts_for_board = 1;
