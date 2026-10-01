/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { afterEach, describe, expect, it } from 'vitest';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';

const databases: TestD1[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

class AllowRateLimiter implements RateLimit {
  async limit(): Promise<RateLimitOutcome> {
    return { success: true };
  }
}

function database(): TestD1 {
  const result = createTestD1(true);
  databases.push(result);
  return result;
}

function env(db: TestD1) {
  return {
    DB: db.binding,
    API_RATE_LIMITER: new AllowRateLimiter(),
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: 'test-session-signing-secret-at-least-32-characters',
    ENVIRONMENT: 'test',
  };
}

function insertRun(db: TestD1, run: {
  id: string;
  playerId: string;
  displayName: string;
  category?: 'geography' | 'history' | 'languages';
  progress: number;
  correctCount: number;
  status?: 'in_progress' | 'completed';
  completedAt: number | null;
}): void {
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, progress,
      correct_count, status, created_at, completed_at
    ) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 1, ?)
  `).run(
    run.id,
    run.playerId,
    run.displayName,
    run.category ?? 'geography',
    run.progress,
    run.correctCount,
    run.status ?? 'completed',
    run.completedAt,
  );
}

async function leaderboard(db: TestD1, category = 'geography') {
  const response = await app.request(`/api/leaderboard?category=${category}`, {}, env(db));
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    category: string;
    entries: Array<{
      displayName: string;
      progress: number;
      correctCount: number;
      completedAt: number | null;
    }>;
  }>;
}

describe('leaderboard best-run selection', () => {
  it('defaults to geography and rejects an unknown category', async () => {
    const db = database();
    insertRun(db, {
      id: 'default-geo', playerId: 'default-player', displayName: 'Default Geo',
      progress: 10, correctCount: 1, completedAt: 100,
    });

    const defaultResponse = await app.request('/api/leaderboard', {}, env(db));
    expect(defaultResponse.status).toBe(200);
    expect(await defaultResponse.json()).toEqual({
      category: 'geography',
      entries: [{
        displayName: 'Default Geo', progress: 10, correctCount: 1, completedAt: 100,
      }],
    });

    const invalidResponse = await app.request('/api/leaderboard?category=unknown', {}, env(db));
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({ error: 'Invalid category.' });
  });

  it('returns one coherent best run per player even after a rename', async () => {
    const db = database();
    insertRun(db, {
      id: 'player-a-old', playerId: 'player-a', displayName: 'Старое имя',
      progress: 90, correctCount: 4, completedAt: 100,
    });
    insertRun(db, {
      id: 'player-a-new', playerId: 'player-a', displayName: 'Новое имя',
      progress: 80, correctCount: 9, completedAt: 200,
    });

    const body = await leaderboard(db);

    expect(body.entries).toEqual([{
      displayName: 'Старое имя',
      progress: 90,
      correctCount: 4,
      completedAt: 100,
    }]);
  });

  it('uses correct count, completion time, and id as deterministic tie-breakers', async () => {
    const db = database();
    insertRun(db, {
      id: 'correct-low', playerId: 'correct-tie', displayName: 'Correct low',
      progress: 80, correctCount: 7, completedAt: 50,
    });
    insertRun(db, {
      id: 'correct-high', playerId: 'correct-tie', displayName: 'Correct high',
      progress: 80, correctCount: 8, completedAt: 100,
    });
    insertRun(db, {
      id: 'time-late', playerId: 'time-tie', displayName: 'Time late',
      progress: 70, correctCount: 6, completedAt: 200,
    });
    insertRun(db, {
      id: 'time-early', playerId: 'time-tie', displayName: 'Time early',
      progress: 70, correctCount: 6, completedAt: 100,
    });
    insertRun(db, {
      id: 'z-id', playerId: 'id-tie', displayName: 'Later id',
      progress: 60, correctCount: 5, completedAt: 100,
    });
    insertRun(db, {
      id: 'a-id', playerId: 'id-tie', displayName: 'Earlier id',
      progress: 60, correctCount: 5, completedAt: 100,
    });

    const body = await leaderboard(db);

    expect(body.entries.map((entry) => entry.displayName)).toEqual([
      'Correct high',
      'Time early',
      'Earlier id',
    ]);
  });

  it('uses the same deterministic order between different players', async () => {
    const db = database();
    insertRun(db, {
      id: 'correct-eight', playerId: 'player-1', displayName: 'Correct eight',
      progress: 80, correctCount: 8, completedAt: 10,
    });
    insertRun(db, {
      id: 'late-nine', playerId: 'player-2', displayName: 'Late nine',
      progress: 80, correctCount: 9, completedAt: 20,
    });
    insertRun(db, {
      id: 'early-nine', playerId: 'player-3', displayName: 'Early nine',
      progress: 80, correctCount: 9, completedAt: 10,
    });
    insertRun(db, {
      id: 'z-last-id', playerId: 'player-4', displayName: 'Last id',
      progress: 80, correctCount: 9, completedAt: 10,
    });
    insertRun(db, {
      id: 'a-first-id', playerId: 'player-5', displayName: 'First id',
      progress: 80, correctCount: 9, completedAt: 10,
    });

    const body = await leaderboard(db);

    expect(body.entries.map((entry) => entry.displayName)).toEqual([
      'First id',
      'Early nine',
      'Last id',
      'Late nine',
      'Correct eight',
    ]);
  });

  it('puts a missing completion timestamp behind an otherwise equal real timestamp', async () => {
    const db = database();
    insertRun(db, {
      id: 'missing-time', playerId: 'nullable-time', displayName: 'Missing time',
      progress: 50, correctCount: 4, completedAt: null,
    });
    insertRun(db, {
      id: 'known-time', playerId: 'nullable-time', displayName: 'Known time',
      progress: 50, correctCount: 4, completedAt: 500,
    });

    const body = await leaderboard(db);

    expect(body.entries).toEqual([{
      displayName: 'Known time', progress: 50, correctCount: 4, completedAt: 500,
    }]);
  });

  it('separates categories and excludes incomplete runs', async () => {
    const db = database();
    insertRun(db, {
      id: 'geo', playerId: 'same-player', displayName: 'Geo',
      progress: 40, correctCount: 3, completedAt: 100,
    });
    insertRun(db, {
      id: 'history', playerId: 'same-player', displayName: 'History', category: 'history',
      progress: 90, correctCount: 8, completedAt: 200,
    });
    insertRun(db, {
      id: 'unfinished', playerId: 'unfinished', displayName: 'Unfinished',
      progress: 100, correctCount: 10, status: 'in_progress', completedAt: null,
    });

    expect((await leaderboard(db)).entries.map((entry) => entry.displayName)).toEqual(['Geo']);
    expect((await leaderboard(db, 'history')).entries.map((entry) => entry.displayName))
      .toEqual(['History']);
  });

  it('returns only the globally best 50 player runs', async () => {
    const db = database();
    for (let index = 0; index < 55; index += 1) {
      insertRun(db, {
        id: `run-${String(index).padStart(2, '0')}`,
        playerId: `player-${index}`,
        displayName: `Player ${index}`,
        progress: index,
        correctCount: index % 10,
        completedAt: 1_000 + index,
      });
    }

    const body = await leaderboard(db);

    expect(body.entries).toHaveLength(50);
    expect(body.entries[0]?.displayName).toBe('Player 54');
    expect(body.entries.at(-1)?.displayName).toBe('Player 5');
  });
});
