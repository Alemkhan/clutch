-- Release of expired rematch invites. Additive: one nullable column and one partial index;
-- existing rows are not touched (released_at stays NULL until the scheduled pass sets it).

-- When the scheduled pass released an expired, unused invite. NULL = not released yet.
-- The challenger run was never excluded from the opponent pool (see findGhostInSets), so this
-- mark only records that the invite no longer holds it and keeps the pass idempotent.
ALTER TABLE rematch_invites ADD COLUMN released_at INTEGER;

-- Selection of expired, unused, unreleased invites by the cron pass.
CREATE INDEX IF NOT EXISTS idx_rematch_invites_expiry
  ON rematch_invites(expires_at)
  WHERE consumed_at IS NULL AND released_at IS NULL;
