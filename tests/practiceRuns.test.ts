/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  DAILY_RULES_VERSION,
  PRACTICE_LEVELS,
  PRACTICE_RULES_VERSION,
  dailyQuestionSet,
  dailyQuestionSetIds,
  evaluateSoloRun,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type CompleteSoloRunResponse,
  type MyRunsResponse,
  type Question,
  type SoloLeaderboardResponse,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { PRACTICE_BOT_PROFILES, createBotOpponent } from '../apps/api/src/solo/bots';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const SOLO = CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
const SET = dailyQuestionSet('geography', NOW, 0);
const databases: TestD1[] = [];
let pending: Promise<unknown>[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };
const executionCtx = {
  waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  passThroughOnException() {},
} as unknown as ExecutionContext;

beforeEach(() => {
  pending = [];
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  databases.push(result);
  return result;
}

function call(db: TestD1, path: string, authorization: string, body?: unknown) {
  return app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  }, executionCtx);
}

function guest(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(NOW / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`;
}

function inputs(questions: Question[], count: number, correct: boolean): AsyncMatchRoundInput[] {
  return questions.slice(0, count).map((question) => ({
    questionId: question.id,
    selectedAnswer: question.answerType === 'open_answer'
      ? (correct ? question.correctAnswers![0] : '__wrong__')
      : (correct
        ? question.correctOptionId
        : question.options.find((option) => option.id !== question.correctOptionId)!.id),
    responseTimeMs: 1000,
  }));
}

/** Завершённая соло-запись другого игрока на наборе 0; автор из Telegram, ему можно написать. */
function insertLiveRecord(db: TestD1, id: string, playerId: string) {
  let progress = 0;
  const rounds: AsyncMatchRound[] = Array.from({ length: 4 }, (_, index) => {
    progress += 25;
    return {
      questionId: SET.questions[index].id,
      correct: true,
      responseTimeMs: 1000,
      progressAwarded: 25,
      playerProgressAfter: progress,
    };
  });
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, ghost_eligible, question_set_id, reached_target, set_par, solo_score
    ) VALUES (?, ?, ?, 'geography', ?, ?, 100, 4, 'completed', ?, ?, ?, ?, ?, 1, ?, 1, 20, 0.2)
  `).run(
    id, playerId, id, JSON.stringify(SET.questions), JSON.stringify(rounds),
    NOW - 2000, NOW - 1000, SOLO, CURRENT_HAMMER_MINI_GAME.id, configJson, SET.questionSetId,
  );
}

const rowOf = (db: TestD1, id: string) =>
  db.sqlite.prepare('SELECT * FROM match_runs WHERE id = ?').get(id) as Record<string, unknown>;

async function startPractice(db: TestD1, authorization: string, botLevel = 'amateur') {
  const response = await call(db, '/api/solo-runs', authorization, { displayName: 'Игрок', category: 'geography', botLevel });
  expect(response.status).toBe(201);
  return await response.json() as StartSoloRunResponse;
}

async function finish(db: TestD1, authorization: string, run: StartSoloRunResponse, count: number, correct = true) {
  const response = await playRounds(
    (path, body) => call(db, path, authorization, body),
    run.runId,
    roundInputs(fullQuestions(db, run.runId), count, correct),
  );
  await Promise.all(pending);
  return response;
}

/**
 * Сломанная страховка: строка тренировки выглядит как полноценная запись соревнования
 * (набор, цель, оценка, право быть соперником), и вне соревнования её держит только версия правил.
 */
function disguiseAsCompetitive(db: TestD1, run: StartSoloRunResponse) {
  const ids = dailyQuestionSetIds('geography', NOW);
  // Набор тренировки свой (practice:...), поэтому подделываем строку под первый набор банка.
  const index = 0;
  db.sqlite.prepare(`
    UPDATE match_runs
    SET question_set_id = ?, reached_target = 1, ghost_eligible = 1, set_par = 20, solo_score = 0.2,
        completed_at = ?
    WHERE id = ?
  `).run(ids[index], NOW, run.runId);
  expect(rowOf(db, run.runId).rules_version).toBe(PRACTICE_RULES_VERSION);
}

describe('practice run against a bot', () => {
  const ann = guest('ann');
  const bob = guest('bob');

  it('takes the bot from the existing profile of the chosen level', async () => {
    const db = database();
    for (const level of PRACTICE_LEVELS) {
      const run = await startPractice(db, ann, level.id);
      expect(run.rulesVersion).toBe(PRACTICE_RULES_VERSION);
      expect(run.pace).toEqual(createBotOpponent(fullQuestions(db, run.runId), PRACTICE_BOT_PROFILES[level.id]));
      // Набор запоминается и у тренировки: вне соревнования её держит версия правил,
      // а не пустой question_set_id. Иначе увиденные вопросы вернулись бы в зачёте.
      expect(rowOf(db, run.runId)).toMatchObject({
        rules_version: PRACTICE_RULES_VERSION,
        opponent_run_id: null,
      });
      expect(rowOf(db, run.runId).question_set_id).not.toBeNull();
    }
    expect(new Set(Object.values(PRACTICE_BOT_PROFILES)).size).toBe(PRACTICE_LEVELS.length);
  });

  it('describes the strength of each level truthfully on sets of 18 and 20', () => {
    const sets = [
      dailyQuestionSet('geography', NOW, 0).questions,
      dailyQuestionSet('history', NOW, 0).questions,
    ];
    expect(sets.map((questions) => questions.length).sort()).toEqual([18, 20]);
    const rounds: number[] = [];
    for (const level of PRACTICE_LEVELS) {
      const played = sets.map((questions) => {
        const bot = createBotOpponent(questions, PRACTICE_BOT_PROFILES[level.id]);
        const final = evaluateSoloRun(questions.map((question) => question.id), bot.rounds);
        expect(final.reachedTarget).toBe(true);
        expect(level.caption).toBe(`100% за ${final.roundsPlayed} кругов`);
        return final.roundsPlayed;
      });
      expect(played[0]).toBe(played[1]);
      rounds.push(played[0]);
    }
    // от слабого к сильному: 17, 13, 9, 6 - ступени не меньше трёх кругов
    for (let i = 1; i < rounds.length; i += 1) expect(rounds[i - 1] - rounds[i]).toBeGreaterThanOrEqual(3);
  });

  it('rejects an unknown level and a level together with a rematch invite', async () => {
    const db = database();
    const bad = await call(db, '/api/solo-runs', ann, { displayName: 'И', category: 'geography', botLevel: 'god' });
    expect(bad.status).toBe(400);
    const both = await call(db, '/api/solo-runs', ann, {
      displayName: 'И', category: 'geography', botLevel: 'novice', rematchInviteId: `rm_${'a'.repeat(22)}`,
    });
    expect(both.status).toBe(400);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM match_runs').get()).toEqual({ n: 0 });
  });

  it('the bot cannot finish the run for the player', async () => {
    const db = database();
    const run = await startPractice(db, ann, 'master');
    const early = await finish(db, ann, run, 3, false);
    expect(early.status).toBe(400);
    expect(rowOf(db, run.runId).status).toBe('in_progress');
  });

  it('is completed without target, score or right to become a pace, and repeats canonically', async () => {
    const db = database();
    const run = await startPractice(db, ann);
    const response = await finish(db, ann, run, 4);
    expect(response.status).toBe(200);
    const result = await response.json() as CompleteSoloRunResponse;
    expect(result).toMatchObject({ progress: 100, reachedTarget: true, outcome: null });
    expect(rowOf(db, run.runId)).toMatchObject({
      status: 'completed', ghost_eligible: 0, reached_target: null, solo_score: null, set_par: null, solo_outcome: null,
    });
    const again = await finish(db, ann, run, 4);
    expect(await again.json()).toEqual(result);
  });

  it('is refused by the race completion route', async () => {
    const db = database();
    const run = await startPractice(db, ann);
    const response = await call(db, `/api/matches/${run.runId}/complete`, ann, { rounds: roundInputs(fullQuestions(db, run.runId), 4, true) });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rowOf(db, run.runId).status).toBe('in_progress');
  });

  it('does not use up the run of the day', async () => {
    const db = database();
    await finish(db, ann, await startPractice(db, ann), 4);
    const real = await call(db, '/api/solo-runs', ann, { displayName: 'Игрок', category: 'geography' });
    expect(real.status).toBe(201);
    const body = await real.json() as StartSoloRunResponse;
    expect(body.rulesVersion).toBe(DAILY_RULES_VERSION);
    expect(body.bankExhausted).toBe(false);
    expect(body.pace).toBeNull();
  });

  describe('stays out of the competition', () => {
    it('1. the pool of opponents', async () => {
      const db = database();
      const run = await startPractice(db, ann);
      expect((await finish(db, ann, run, 4)).status).toBe(200);
      disguiseAsCompetitive(db, run);
      const other = await call(db, '/api/solo-runs', bob, { displayName: 'Боб', category: 'geography', mode: 'duel' });
      const started = await other.json() as StartSoloRunResponse;
      expect(started.pace).toBeNull();
      expect(rowOf(db, started.runId).opponent_run_id).toBeNull();
    });

    it('2. the results table', async () => {
      const db = database();
      const run = await startPractice(db, ann);
      expect((await finish(db, ann, run, 4)).status).toBe(200);
      disguiseAsCompetitive(db, run);
      const solo = await call(db, '/api/solo-leaderboard?category=geography', bob);
      expect((await solo.json() as SoloLeaderboardResponse).entries).toEqual([]);
      // Таблица гонки удалена вместе с режимом: протекать тренировке больше некуда.
      expect((await call(db, '/api/leaderboard?category=geography', bob)).status).toBe(404);
      const mine = await call(db, '/api/my-runs', ann);
      expect((await mine.json() as MyRunsResponse).runs).toEqual([]);
    });

    it('3. rematch invites', async () => {
      const db = database();
      insertLiveRecord(db, 'live-run', 'telegram:42');
      const run = await startPractice(db, ann);
      // Даже если у тренировки окажется живая запись в соперниках, приглашения не появятся.
      db.sqlite.prepare('UPDATE match_runs SET opponent_run_id = ? WHERE id = ?').run('live-run', run.runId);
      const result = await (await finish(db, ann, run, 4)).json() as CompleteSoloRunResponse;
      expect(result.outcome).toBeNull();
      expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM rematch_invites').get()).toEqual({ n: 0 });
      const mine = await call(db, '/api/my-runs', guest('x'));
      expect((await mine.json() as MyRunsResponse).invites).toEqual([]);
    });

    it('4. notifications', async () => {
      const db = database();
      insertLiveRecord(db, 'live-run', 'telegram:42');
      const run = await startPractice(db, ann);
      db.sqlite.prepare('UPDATE match_runs SET opponent_run_id = ? WHERE id = ?').run('live-run', run.runId);
      expect((await finish(db, ann, run, 4)).status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
  describe('does not repeat a set the player already saw', () => {
    // Прежде тренировка брала набор из банка дня и помечала его сыгранным. Это позволяло
    // пройти день с ботами и сыграть зачёт уже зная вопросы, поэтому у неё теперь свой набор.
    it('takes a set of its own and leaves the day bank untouched', async () => {
      const db = database();
      const bank = dailyQuestionSetIds('geography', NOW);

      // Зачётный забег занимает первый набор банка.
      const first = await (await call(db, '/api/solo-runs', ann, { displayName: 'Игрок', category: 'geography' })).json() as StartSoloRunResponse;
      const firstRow = db.sqlite.prepare('SELECT question_set_id AS id FROM match_runs WHERE id = ?').get(first.runId) as { id: string };
      expect(firstRow.id).toBe(bank[0]);

      // Тренировка берёт набор вне банка.
      const practice = await startPractice(db, ann);
      const row = db.sqlite.prepare('SELECT question_set_id AS id FROM match_runs WHERE id = ?').get(practice.runId) as { id: string };
      expect(row.id.startsWith('practice:')).toBe(true);
      expect(bank).not.toContain(row.id);

      // И не расходует банк: у игрока остаётся ровно один зачётный забег, на первом наборе.
      const competitive = db.sqlite
        .prepare("SELECT question_set_id AS id FROM match_runs WHERE question_set_id NOT LIKE 'practice:%'")
        .all() as Array<{ id: string }>;
      expect(competitive).toHaveLength(1);
      expect(competitive[0].id).toBe(bank[0]);
    });
  });
});
