/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  dailyQuestionSet,
  type AsyncMatchRound,
  type MyRunsResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
// Время задано явно: ни одна проверка не зависит от реальных часов.
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const HOUR = 3_600_000;
// Версия правил удалённого режима: такие строки в списке не показываются.
const LEGACY = 'race-to-100-v3';
const SOLO = CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
const databases: TestD1[] = [];

const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  databases.push(result);
  return result;
}

function guest(label: string): { authorization: string; playerId: string } {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const seconds = Math.floor(NOW / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: seconds - 1, exp: seconds + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return {
    authorization: `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`,
    playerId: `guest:${subject}`,
  };
}

const bindings = (db: TestD1) => ({
  DB: db.binding,
  API_RATE_LIMITER: allowRateLimiter,
  TELEGRAM_BOT_TOKEN: 'test',
  SESSION_SIGNING_SECRET: sessionSecret,
  ENVIRONMENT: 'test',
  TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
});

function fetchRuns(db: TestD1, label: string, query = '') {
  return app.request(`/api/my-runs${query}`, {
    headers: { authorization: guest(label).authorization },
  }, bindings(db));
}

/** Завершённая партия: четыре круга по 25; соперник (если есть) даёт по 10. */
function insertRun(db: TestD1, options: {
  id: string;
  label: string;
  completedAt: number;
  /** Строка удалённого режима гонки: в списке её быть не должно. */
  legacy?: boolean;
  solo?: boolean;
  opponent?: 'player' | 'bot' | null;
  /** Чью запись играл этот забег; по умолчанию 'ghost-source' при opponent: 'player'. */
  opponentRunId?: string;
  /** Сколько кругов в забеге (по 25%); по умолчанию четыре. */
  rounds?: number;
}) {
  const set = dailyQuestionSet('geography', NOW, 0);
  const count = options.rounds ?? 4;
  const rounds: AsyncMatchRound[] = Array.from({ length: count }, (_, index) => index).map((index) => ({
    questionId: set.questions[index].id,
    correct: true,
    responseTimeMs: 1000,
    progressAwarded: 25,
    playerProgressAfter: 25 * (index + 1),
  }));
  const opponent = options.opponent ? JSON.stringify({
    id: 'opp',
    displayName: 'Соперник',
    rounds: set.questions.slice(0, 10).map((question) => ({
      questionId: question.id,
      correct: true,
      responseTimeMs: 1000,
      skillScore: 0,
      progressAwarded: 10,
    })),
  }) : null;
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, opponent_json, opponent_run_id, ghost_eligible, question_set_id,
      reached_target, set_par, solo_score
    ) VALUES (?, ?, ?, 'geography', ?, ?, 100, 4, 'completed', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    options.id,
    guest(options.label).playerId,
    options.label,
    JSON.stringify(set.questions),
    JSON.stringify(rounds),
    options.completedAt - 1000,
    options.completedAt,
    options.legacy ? LEGACY : SOLO,
    CURRENT_HAMMER_MINI_GAME.id,
    configJson,
    opponent,
    options.opponentRunId ?? (options.opponent === 'player' ? 'ghost-source' : null),
    set.questionSetId,
    1,
    5,
    0.8,
  );
}

function insertInvite(db: TestD1, options: {
  id: string;
  recipientLabel: string;
  challengerRunId: string;
  recipientRunId: string;
  expiresAt: number;
  consumedAt?: number | null;
}) {
  db.sqlite.prepare(`
    INSERT INTO rematch_invites (
      id, recipient_player_id, recipient_run_id, challenger_run_id, category,
      recipient_progress, challenger_progress, created_at, expires_at, consumed_at
    ) VALUES (?, ?, ?, ?, 'geography', 60, 100, ?, ?, ?)
  `).run(
    options.id,
    guest(options.recipientLabel).playerId,
    options.recipientRunId,
    options.challengerRunId,
    NOW - HOUR,
    options.expiresAt,
    options.consumedAt ?? null,
  );
}

describe('GET /api/my-runs', () => {
  it('requires authentication', async () => {
    const db = database();
    const response = await app.request('/api/my-runs', {}, bindings(db));
    expect(response.status).toBe(401);
  });

  it('returns only the caller runs, newest first, with par, score and opponent', async () => {
    const db = database();
    insertRun(db, { id: 'ghost-source', label: 'zed', completedAt: NOW - 9 * HOUR });
    insertRun(db, { id: 'race-old', label: 'ann', completedAt: NOW - 3 * HOUR, opponent: 'player', legacy: true });
    insertRun(db, { id: 'player-old', label: 'ann', completedAt: NOW - 3 * HOUR, opponent: 'player' });
    insertRun(db, { id: 'solo-new', label: 'ann', completedAt: NOW - HOUR, solo: true });
    insertRun(db, { id: 'bot-mid', label: 'ann', completedAt: NOW - 2 * HOUR, opponent: 'bot' });
    insertRun(db, { id: 'bob-run', label: 'bob', completedAt: NOW - HOUR });
    // Незавершённая партия в список не попадает.
    db.sqlite.prepare(
      "INSERT INTO match_runs (id, player_id, display_name, category, questions_json, created_at) VALUES ('unfinished', ?, 'ann', 'geography', '[]', ?)",
    ).run(guest('ann').playerId, NOW);

    const body = await (await fetchRuns(db, 'ann')).json() as MyRunsResponse;
    expect(body.runs.map((run) => run.runId)).toEqual(['solo-new', 'bot-mid', 'player-old']);
    expect(body.runs[0]).toMatchObject({
      roundsPlayed: 4, progress: 100, reachedTarget: true,
      setPar: 5, soloScore: 0.8, opponent: null, outcome: null, completedAt: NOW - HOUR,
    });
    expect(body.runs[1]).toMatchObject({
      reachedTarget: true, setPar: 5, soloScore: 0.8,
      opponent: { kind: 'bot', displayName: 'Соперник' }, outcome: null,
    });
    expect(body.runs[2].opponent?.kind).toBe('player');

    const other = await (await fetchRuns(db, 'bob')).json() as MyRunsResponse;
    expect(other.runs.map((run) => run.runId)).toEqual(['bob-run']);
  });

  it('pages with a cursor without gaps or repeats', async () => {
    const db = database();
    for (let index = 0; index < 5; index++) {
      insertRun(db, { id: `run-${index}`, label: 'ann', completedAt: NOW - index * HOUR });
    }
    // Одинаковое время завершения не должно ломать порядок страниц.
    insertRun(db, { id: 'run-0b', label: 'ann', completedAt: NOW - 4 * HOUR });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const query: string = `?limit=2${cursor ? `&before=${cursor}` : ''}`;
      const body = await (await fetchRuns(db, 'ann', query)).json() as MyRunsResponse;
      seen.push(...body.runs.map((run) => run.runId));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(['run-0', 'run-1', 'run-2', 'run-3', 'run-4', 'run-0b']);
    expect((await fetchRuns(db, 'ann', '?limit=0')).status).toBe(400);
    expect((await fetchRuns(db, 'ann', '?before=junk')).status).toBe(400);
  });
});

describe('GET /api/my-runs opponent rounds', () => {
  it('gives the rounds of the record I played, of the one who played mine, and null without a rival', async () => {
    const db = database();
    insertRun(db, { id: 'ghost-source', label: 'zed', completedAt: NOW - 9 * HOUR, rounds: 6 });
    insertRun(db, { id: 'ann-beat', label: 'ann', completedAt: NOW - 3 * HOUR, opponent: 'player', rounds: 5 });
    insertRun(db, { id: 'ann-bot', label: 'ann', completedAt: NOW - 2 * HOUR, opponent: 'bot' });
    insertRun(db, { id: 'ann-alone', label: 'ann', completedAt: NOW - HOUR, solo: true });
    // Боб сыграл запись Анны: у неё в своей строке соперника нет, круги берутся с его стороны.
    insertRun(db, { id: 'bob-vs-ann', label: 'bob', completedAt: NOW - 30 * 60_000, opponent: 'player', opponentRunId: 'ann-alone', rounds: 3 });

    const ann = await (await fetchRuns(db, 'ann')).json() as MyRunsResponse;
    const byId = Object.fromEntries(ann.runs.map((run) => [run.runId, run]));
    expect(byId['ann-beat']).toMatchObject({ roundsPlayed: 5, opponentRoundsPlayed: 6 });
    expect(byId['ann-bot'].opponentRoundsPlayed).toBeNull();
    expect(byId['ann-alone']).toMatchObject({ roundsPlayed: 4, opponent: { displayName: 'bob' }, opponentRoundsPlayed: 3 });

    const zed = await (await fetchRuns(db, 'zed')).json() as MyRunsResponse;
    expect(zed.runs[0]).toMatchObject({ runId: 'ghost-source', opponentRoundsPlayed: 5 });
  });

  it('gives both sides rounds in a rematch invite', async () => {
    const db = database();
    insertRun(db, { id: 'bob-win', label: 'bob', completedAt: NOW - 2 * HOUR, rounds: 7 });
    insertRun(db, { id: 'ann-loss', label: 'ann', completedAt: NOW - 3 * HOUR, rounds: 9 });
    insertInvite(db, { id: 'live', recipientLabel: 'ann', challengerRunId: 'bob-win', recipientRunId: 'ann-loss', expiresAt: NOW + HOUR });
    const ann = await (await fetchRuns(db, 'ann')).json() as MyRunsResponse;
    expect(ann.invites[0]).toMatchObject({ challengerRoundsPlayed: 7, recipientRoundsPlayed: 9 });
  });
});

describe('GET /api/my-runs invites', () => {
  it('lists only active invites addressed to the caller', async () => {
    const db = database();
    insertRun(db, { id: 'bob-win', label: 'bob', completedAt: NOW - 2 * HOUR });
    insertRun(db, { id: 'ann-loss', label: 'ann', completedAt: NOW - 3 * HOUR });
    insertRun(db, { id: 'ann-loss2', label: 'ann', completedAt: NOW - 4 * HOUR });
    insertRun(db, { id: 'ann-loss3', label: 'ann', completedAt: NOW - 5 * HOUR });
    insertInvite(db, { id: 'live', recipientLabel: 'ann', challengerRunId: 'bob-win', recipientRunId: 'ann-loss', expiresAt: NOW + HOUR });
    // expires_at == NOW уже считается истёкшим, как и в consumeInvite.
    insertInvite(db, { id: 'expired', recipientLabel: 'ann', challengerRunId: 'bob-win', recipientRunId: 'ann-loss2', expiresAt: NOW });
    insertInvite(db, { id: 'spent', recipientLabel: 'ann', challengerRunId: 'bob-win', recipientRunId: 'ann-loss3', expiresAt: NOW + HOUR, consumedAt: NOW - 1000 });

    const ann = await (await fetchRuns(db, 'ann')).json() as MyRunsResponse;
    expect(ann.invites).toEqual([{
      inviteId: 'live', category: 'geography', challengerName: 'bob',
      challengerProgress: 100, yourProgress: 60, challengerRoundsPlayed: 4, recipientRoundsPlayed: 4,
      expiresAt: NOW + HOUR,
    }]);

    const bob = await (await fetchRuns(db, 'bob')).json() as MyRunsResponse;
    expect(bob.invites).toEqual([]);
  });
});
