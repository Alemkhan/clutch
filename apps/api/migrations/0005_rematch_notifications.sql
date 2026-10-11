-- Outbid notifications and one-time rematch invites. Additive: no existing table is altered
-- and no row is written by the migration itself.

-- Per-player consent. A player WITHOUT a row is treated as enabled (opt-out model, see
-- apps/api/src/notifications/outbid.ts); a row with outbid_enabled = 0 is an unsubscribe.
CREATE TABLE IF NOT EXISTS player_notification_prefs (
  player_id TEXT PRIMARY KEY,
  outbid_enabled INTEGER NOT NULL DEFAULT 1 CHECK (outbid_enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

-- One row per "challenger run beat recipient run" event. The UNIQUE pair is the database-level
-- guard against duplicate messages; the id is the unguessable startapp payload (after "rm_").
CREATE TABLE IF NOT EXISTS rematch_invites (
  id TEXT PRIMARY KEY,
  recipient_player_id TEXT NOT NULL,
  recipient_run_id TEXT NOT NULL REFERENCES match_runs(id),
  challenger_run_id TEXT NOT NULL REFERENCES match_runs(id),
  category TEXT NOT NULL CHECK (category IN ('geography', 'history', 'languages')),
  recipient_progress INTEGER NOT NULL,
  challenger_progress INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  notify_status TEXT NOT NULL DEFAULT 'pending' CHECK (notify_status IN ('pending', 'sent', 'failed')),
  consumed_at INTEGER,
  rematch_run_id TEXT,
  UNIQUE (recipient_run_id, challenger_run_id)
);

CREATE INDEX IF NOT EXISTS idx_rematch_invites_recipient
  ON rematch_invites(recipient_player_id, created_at DESC);
