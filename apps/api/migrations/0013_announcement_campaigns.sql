CREATE TABLE announcement_campaigns (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE announcement_deliveries (
  campaign_id TEXT NOT NULL REFERENCES announcement_campaigns(id),
  player_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'sent', 'blocked', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, player_id)
) WITHOUT ROWID;

INSERT INTO announcement_campaigns (id, message, scheduled_at, created_at) VALUES (
  'group-challenges-launch-2026-11-06',
  '🏁 В Clutch появилась новая функция "Вызов друзьям"
Закончил забег? Нажми "Вызвать друзей", кинь ссылку в чат и соревнуйся с друзьями на одинаковом наборе вопросов.
Кто дойдёт до 100% с лучшим результатом?
Сегодняшние задания уже ждут внутри 👀',
  1793944800000,
  1793926800000
);
