-- Открытые приглашения «Позвать друга»: адресата нет, пока кто-то не откроет ссылку.
-- SQLite не умеет снимать NOT NULL с колонки, поэтому rematch_invites пересобирается с теми же
-- колонками, данными и индексами; отличие одно: recipient_player_id и recipient_run_id могут
-- быть пустыми. Срок, одноразовость (consumed_at) и отпускание (released_at) остаются в этой же
-- таблице. Открытое приглашение = recipient_run_id IS NULL; адресатом оно становится при погашении.
-- Ни одна таблица на rematch_invites не ссылается, строки копируются как есть.

CREATE TABLE rematch_invites_new (
  id TEXT PRIMARY KEY,
  recipient_player_id TEXT,
  recipient_run_id TEXT REFERENCES match_runs(id),
  challenger_run_id TEXT NOT NULL REFERENCES match_runs(id),
  category TEXT NOT NULL CHECK (category IN ('geography', 'history', 'languages')),
  recipient_progress INTEGER NOT NULL,
  challenger_progress INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  notify_status TEXT NOT NULL DEFAULT 'pending' CHECK (notify_status IN ('pending', 'sent', 'failed')),
  consumed_at INTEGER,
  rematch_run_id TEXT,
  released_at INTEGER,
  UNIQUE (recipient_run_id, challenger_run_id)
);

INSERT INTO rematch_invites_new (
  id, recipient_player_id, recipient_run_id, challenger_run_id, category, recipient_progress,
  challenger_progress, created_at, expires_at, notify_status, consumed_at, rematch_run_id, released_at
)
SELECT
  id, recipient_player_id, recipient_run_id, challenger_run_id, category, recipient_progress,
  challenger_progress, created_at, expires_at, notify_status, consumed_at, rematch_run_id, released_at
FROM rematch_invites;

DROP TABLE rematch_invites;
ALTER TABLE rematch_invites_new RENAME TO rematch_invites;

CREATE INDEX idx_rematch_invites_recipient
  ON rematch_invites(recipient_player_id, created_at DESC);

CREATE INDEX idx_rematch_invites_expiry
  ON rematch_invites(expires_at)
  WHERE consumed_at IS NULL AND released_at IS NULL;

-- Одно открытое приглашение на забег: повторный вызов находит его, а не плодит новые.
-- Тот же индекс обслуживает проверку резерва в общем подборе (challenger_run_id = match_runs.id).
CREATE UNIQUE INDEX idx_rematch_invites_open_run
  ON rematch_invites(challenger_run_id)
  WHERE recipient_run_id IS NULL;
