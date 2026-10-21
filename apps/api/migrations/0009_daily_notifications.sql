-- Добровольная ежедневная сводка новых режимов и журнал доставки без дублей.
ALTER TABLE player_notification_prefs
  ADD COLUMN daily_enabled INTEGER NOT NULL DEFAULT 0 CHECK (daily_enabled IN (0, 1));

CREATE TABLE daily_notification_deliveries (
  player_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'sent', 'blocked', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, date_key)
) WITHOUT ROWID;

CREATE INDEX idx_daily_notification_deliveries_day
  ON daily_notification_deliveries(date_key, status);
