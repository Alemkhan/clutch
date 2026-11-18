-- Кланы-эмодзи: каждое эмодзи — один клан, первый занявший — основатель, остальные вступают по
-- ссылке-приглашению. Игрок состоит ровно в одном клане и навсегда (player_id — ключ участника).
-- emoji_key — эмодзи без оттенка кожи и без FE0F (см. normalizeClanEmoji), emoji — как показывать.
CREATE TABLE clans (
  emoji_key TEXT PRIMARY KEY,
  emoji TEXT NOT NULL,
  -- Текущий основатель: переходит к самому активному, если основатель месяц не играл.
  founder_player_id TEXT NOT NULL,
  -- «Нулевой пациент»: кто занял эмодзи первым. Не меняется.
  original_founder_player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE clan_members (
  player_id TEXT PRIMARY KEY,
  emoji_key TEXT NOT NULL REFERENCES clans(emoji_key),
  -- Кто заразил: участник того же клана; NULL у основателя.
  invited_by TEXT,
  -- Личный код ссылки-приглашения (startapp=cl_<код>).
  invite_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  joined_at INTEGER NOT NULL
);

CREATE INDEX clan_members_clan ON clan_members(emoji_key, joined_at);
CREATE INDEX clan_members_invited_by ON clan_members(invited_by);
