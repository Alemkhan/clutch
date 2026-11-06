CREATE TABLE group_challenges (
 id TEXT PRIMARY KEY,
 creator_run_id TEXT NOT NULL UNIQUE REFERENCES match_runs(id),
 creator_player_id TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('general','geography','history','languages','kz_history')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 max_players INTEGER NOT NULL DEFAULT 20 CHECK(max_players BETWEEN 2 AND 20)
);
CREATE TABLE group_challenge_entries (
 challenge_id TEXT NOT NULL REFERENCES group_challenges(id),
 player_id TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES match_runs(id),
 joined_at INTEGER NOT NULL,
 PRIMARY KEY(challenge_id,player_id),
 UNIQUE(challenge_id,run_id)
);
CREATE INDEX group_challenge_entries_run ON group_challenge_entries(run_id);
