-- Настройки игрока: язык (сообщения бота, разбор) и гео-зона (пул местных вопросов).
-- region_source: 'auto' — по стране подключения, 'manual' — игрок выбрал в профиле.
CREATE TABLE player_settings (
  player_id TEXT PRIMARY KEY,
  locale TEXT NOT NULL CHECK (locale IN ('ru', 'en', 'kk')),
  region TEXT NOT NULL CHECK (region IN ('kz', 'cis', 'world')),
  region_source TEXT NOT NULL DEFAULT 'auto' CHECK (region_source IN ('auto', 'manual')),
  updated_at INTEGER NOT NULL
);
