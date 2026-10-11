/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { afterEach, describe, expect, it } from 'vitest';
import { releaseExpiredRematchInvites } from '../apps/api/src/notifications/expiry';
import { createTestD1, type TestD1 } from './helpers/testD1';

const NOW = 2_000_000_000_000;
const databases: TestD1[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  databases.push(result);
  return result;
}

function insertRun(db: TestD1, id: string, playerId: string) {
  db.sqlite.prepare(`
    INSERT INTO match_runs (id, player_id, display_name, category, questions_json, rounds_json,
      progress, correct_count, status, created_at)
    VALUES (?, ?, 'Игрок', 'geography', '[]', '[]', 0, 0, 'completed', 1)
  `).run(id, playerId);
}

function insertInvite(db: TestD1, id: string, expiresAt: number, consumedAt: number | null = null) {
  insertRun(db, `r-${id}`, `recipient-${id}`);
  insertRun(db, `c-${id}`, `challenger-${id}`);
  db.sqlite.prepare(`
    INSERT INTO rematch_invites (id, recipient_player_id, recipient_run_id, challenger_run_id,
      category, recipient_progress, challenger_progress, created_at, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, 'geography', 50, 80, 1, ?, ?)
  `).run(id, `recipient-${id}`, `r-${id}`, `c-${id}`, expiresAt, consumedAt);
}

function releasedAt(db: TestD1, id: string): number | null {
  const row = db.sqlite.prepare('SELECT released_at FROM rematch_invites WHERE id = ?').get(id) as
    { released_at: number | null };
  return row.released_at;
}

describe('releaseExpiredRematchInvites', () => {
  it('releases an expired unused invite', async () => {
    const db = database();
    insertInvite(db, 'expired', NOW - 1);
    insertInvite(db, 'exactly-now', NOW);

    const summary = await releaseExpiredRematchInvites(db.binding, NOW);

    expect(summary).toEqual({ released: 2, more: false });
    expect(releasedAt(db, 'expired')).toBe(NOW);
    expect(releasedAt(db, 'exactly-now')).toBe(NOW);
  });

  it('leaves a consumed invite alone even when it has expired', async () => {
    const db = database();
    insertInvite(db, 'consumed', NOW - 1000, NOW - 5000);

    const summary = await releaseExpiredRematchInvites(db.binding, NOW);

    expect(summary.released).toBe(0);
    expect(releasedAt(db, 'consumed')).toBeNull();
  });

  it('leaves an invite that has not expired yet', async () => {
    const db = database();
    insertInvite(db, 'live', NOW + 1);

    const summary = await releaseExpiredRematchInvites(db.binding, NOW);

    expect(summary.released).toBe(0);
    expect(releasedAt(db, 'live')).toBeNull();
  });

  it('is idempotent: a repeat pass changes nothing, even at a later time', async () => {
    const db = database();
    insertInvite(db, 'expired', NOW - 1);

    await releaseExpiredRematchInvites(db.binding, NOW);
    const again = await releaseExpiredRematchInvites(db.binding, NOW + 60_000);

    expect(again).toEqual({ released: 0, more: false });
    expect(releasedAt(db, 'expired')).toBe(NOW);
  });

  it('takes at most one batch per pass and finishes the rest on the next one', async () => {
    const db = database();
    for (const id of ['a', 'b', 'c']) insertInvite(db, id, NOW - 1);

    const first = await releaseExpiredRematchInvites(db.binding, NOW, 2);
    const second = await releaseExpiredRematchInvites(db.binding, NOW, 2);

    expect(first).toEqual({ released: 2, more: true });
    expect(second).toEqual({ released: 1, more: false });
  });

  it('does not alter the challenger run', async () => {
    const db = database();
    insertInvite(db, 'expired', NOW - 1);
    const before = db.sqlite.prepare('SELECT * FROM match_runs WHERE id = ?').get('c-expired');

    await releaseExpiredRematchInvites(db.binding, NOW);

    expect(db.sqlite.prepare('SELECT * FROM match_runs WHERE id = ?').get('c-expired')).toEqual(before);
  });
});
