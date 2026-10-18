/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  DAILY_RULES_VERSION,
  FREE_RULES_VERSION,
  SOLO_ROUND_CAP,
  dailyQuestionSet,
  seenQuestionKey,
  setPar,
  soloScore,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type CompleteSoloRunResponse,
  type SoloRunSnapshot,
  type StartSoloRunResponse,
  type Question,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';
import { recordMistake } from '../apps/api/src/training/mistakesRepository';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
// Время задано явно: набор дня зависит от даты, реальные часы не используются.
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
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

function request(db: TestD1, path: string, authorization: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify(body),
  }, {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  });
}

function guest(label: string): { authorization: string; playerId: string } {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(NOW / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return {
    authorization: `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`,
    playerId: `guest:${subject}`,
  };
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

async function startRun(db: TestD1, label: string, path = '/api/solo-runs', mode?: string) {
  const response = await request(db, path, guest(label).authorization, {
    displayName: label,
    category: 'geography',
    ...(mode ? { mode } : {}),
  });
  return response;
}

async function start(db: TestD1, label: string): Promise<StartSoloRunResponse> {
  const response = await startRun(db, label);
  expect(response.status).toBe(201);
  return await response.json() as StartSoloRunResponse;
}

function finish(db: TestD1, label: string, runId: string, rounds: AsyncMatchRoundInput[]) {
  return playRounds((path, body) => request(db, path, guest(label).authorization, body), runId, rounds);
}

function rowOf(db: TestD1, id: string) {
  return db.sqlite.prepare(
    'SELECT status, progress, reached_target, set_par, solo_score, rules_version, ghost_eligible FROM match_runs WHERE id = ?',
  ).get(id) as Record<string, unknown>;
}

/** Чужой завершённый забег на наборе дня с заданной версией правил и целью. */
function insertRun(db: TestD1, options: {
  id: string;
  playerId: string;
  rulesVersion: string;
  reachedTarget: number | null;
  setIndex?: number;
}) {
  const set = dailyQuestionSet('geography', NOW, options.setIndex ?? 0);
  const awards = [25, 25, 25, 25];
  let progress = 0;
  const rounds: AsyncMatchRound[] = awards.map((progressAwarded, index) => {
    progress += progressAwarded;
    return {
      questionId: set.questions[index].id,
      correct: true,
      responseTimeMs: 1000,
      progressAwarded,
      playerProgressAfter: progress,
    };
  });
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, created_at, completed_at, rules_version, mini_game_id,
      mini_game_config_json, ghost_eligible, question_set_id, reached_target
    ) VALUES (?, ?, ?, 'geography', ?, ?, 100, 4, 'completed', ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    options.id,
    options.playerId,
    options.id,
    JSON.stringify(set.questions),
    JSON.stringify(rounds),
    NOW - 2000,
    NOW - 1000,
    options.rulesVersion,
    CURRENT_HAMMER_MINI_GAME.id,
    configJson,
    set.questionSetId,
    options.reachedTarget,
  );
}

describe('solo run', () => {
  it('gives the run of the day once: the same set for everyone, a second start is refused', async () => {
    const db = database();
    const run = await start(db, 'grinder');
    expect(run.rulesVersion).toBe(DAILY_RULES_VERSION);
    expect(run.questions.map((q) => q.id)).toEqual(dailyQuestionSet('geography', NOW, 0).questions.map((q) => q.id));
    expect((await start(db, 'other')).questions).toEqual(run.questions);
    expect((await finish(db, 'grinder', run.runId, inputs(fullQuestions(db, run.runId), 4, true))).status).toBe(200);
    const again = await startRun(db, 'grinder');
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ reason: 'daily_played' });
  });

  it('free play never repeats a question the player has already seen while fresh ones remain', async () => {
    const db = database();
    const seen = new Set<string>();
    for (let step = 0; step < 6; step++) {
      const run = await (await startRun(db, 'grinder', '/api/solo-runs', 'free')).json() as StartSoloRunResponse;
      expect(run.rulesVersion).toBe(FREE_RULES_VERSION);
      expect(run.pace).toBeNull();
      const played = fullQuestions(db, run.runId).slice(0, 4);
      for (const question of played) {
        expect(seen.has(seenQuestionKey(question.id))).toBe(false);
        seen.add(seenQuestionKey(question.id));
      }
      expect((await finish(db, 'grinder', run.runId, inputs(fullQuestions(db, run.runId), 4, true))).status).toBe(200);
    }
  });

  it('reaches the target, is saved with par and score, and repeats canonically', async () => {
    const db = database();
    const run = await start(db, 'ann');
    expect(run.pace).toBeNull();
    expect(run.rulesVersion).toBe(DAILY_RULES_VERSION);
    expect(run.roundCap).toBe(SOLO_ROUND_CAP);

    // Четыре точных удара по 25: цель достигнута на четвёртом круге.
    const response = await finish(db, 'ann', run.runId, roundInputs(fullQuestions(db, run.runId), 4, true));
    expect(response.status).toBe(200);
    const result = await response.json() as CompleteSoloRunResponse;
    expect(result).toMatchObject({ progress: 100, roundsPlayed: 4, reachedTarget: true, correctCount: 4 });
    expect(result.par).toBe(setPar(fullQuestions(db, run.runId)));
    expect(result.score).toBe(soloScore(4, result.par));
    expect(rowOf(db, run.runId)).toMatchObject({
      status: 'completed',
      progress: 100,
      reached_target: 1,
      set_par: result.par,
      solo_score: result.score,
      rules_version: DAILY_RULES_VERSION,
    });

    const again = await finish(db, 'ann', run.runId, roundInputs(fullQuestions(db, run.runId), 4, true));
    expect(await again.json()).toEqual(result);
  });

  it('stops at the round cap, is saved without the target and is never offered as a pace', async () => {
    const db = database();
    const run = await start(db, 'bob');
    expect(run.questions.length).toBeGreaterThanOrEqual(SOLO_ROUND_CAP);
    const response = await finish(db, 'bob', run.runId, roundInputs(fullQuestions(db, run.runId), SOLO_ROUND_CAP, false));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      progress: 0, roundsPlayed: SOLO_ROUND_CAP, reachedTarget: false,
    });
    expect(rowOf(db, run.runId)).toMatchObject({ status: 'completed', reached_target: 0, ghost_eligible: 0 });

    // Другие игроки его соперником не получают: ни на этом наборе, ни на другом.
    const other = await start(db, 'carol');
    expect(other.pace).toBeNull();
  });

  it('keeps the run open when the prefix does not finish it', async () => {
    const db = database();
    const run = await start(db, 'dan');
    expect((await finish(db, 'dan', run.runId, roundInputs(fullQuestions(db, run.runId), 4, false))).status).toBe(400);
    expect(rowOf(db, run.runId)).toMatchObject({ status: 'in_progress' });
  });

  it('a duel ends on the round the record reached the target: the challenger has already lost', async () => {
    const db = database();
    insertRun(db, { id: 'pace-run', playerId: 'guest:other', rulesVersion: SOLO, reachedTarget: 1 });
    const run = await (await startRun(db, 'eve', '/api/solo-runs', 'duel')).json() as StartSoloRunResponse;
    expect(run.pace?.id).toBe('pace-run');
    expect(run.pace?.rounds).toHaveLength(4);
    expect(run.roundCap).toBe(4);

    // Запись добрала 100 на четвёртом круге: после четвёртого круга партия кончена, исход — поражение.
    const done = await finish(db, 'eve', run.runId, roundInputs(fullQuestions(db, run.runId), 4, false));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ roundsPlayed: 4, reachedTarget: false });
    expect(rowOf(db, run.runId)).toMatchObject({ status: 'completed' });
  });

  it('does not mix legacy race records into the solo pool', async () => {
    const db = database();
    insertRun(db, {
      id: 'race-run',
      playerId: 'guest:other',
      rulesVersion: 'race-to-100-v3',
      reachedTarget: null,
    });
    expect(((await (await startRun(db, 'fay', '/api/solo-runs', 'duel')).json()) as StartSoloRunResponse).pace).toBeNull();
  });

  it('refuses another player, a race match id and unauthenticated calls', async () => {
    const db = database();
    const run = await start(db, 'hal');
    expect((await finish(db, 'mallory', run.runId, roundInputs(fullQuestions(db, run.runId), 4, true))).status).toBe(404);
    expect((await request(db, `/api/solo-runs/${run.runId}/answer`, '', {})).status).toBe(401);

    // Старая запись режима гонки соло-маршрутами не принимается.
    insertRun(db, { id: 'race-run', playerId: guest('ivy').playerId, rulesVersion: 'race-to-100-v3', reachedTarget: null });
    expect((await finish(db, 'ivy', 'race-run', roundInputs(fullQuestions(db, run.runId), 4, true))).status).toBe(409);
  });
});

describe('a second start while a run is unfinished', () => {
  it('resumes it as a snapshot with the played rounds, shaped like the GET snapshot', async () => {
    const db = database();
    const first = await start(db, 'ann');
    const played = await finish(db, 'ann', first.runId, roundInputs(fullQuestions(db, first.runId), 3, true));
    expect(played.status).toBe(400);

    const again = await startRun(db, 'ann');
    expect(again.status).toBe(201);
    const resumed = await again.json() as SoloRunSnapshot & { resumed?: true };
    expect(resumed.resumed).toBe(true);
    expect(resumed.runId).toBe(first.runId);
    expect(resumed.rounds).toHaveLength(3);
    expect(resumed.rounds.map((round) => round.questionId)).toEqual(first.questions.slice(0, 3).map((question) => question.id));
    expect(resumed).toMatchObject({ status: 'in_progress', category: 'geography', result: null });

    const got = await app.request(`/api/solo-runs/${first.runId}`, {
      headers: { authorization: guest('ann').authorization },
    }, {
      DB: db.binding, API_RATE_LIMITER: allowRateLimiter, TELEGRAM_BOT_TOKEN: 'test',
      SESSION_SIGNING_SECRET: sessionSecret, ENVIRONMENT: 'test',
    });
    const { resumed: _flag, ...startShape } = resumed;
    expect(await got.json()).toEqual(startShape);
    const runs = db.sqlite.prepare("SELECT COUNT(*) AS n FROM match_runs WHERE player_id = ?").get(guest('ann').playerId) as { n: number };
    expect(runs.n).toBe(1);
  });

  it('keeps a plain new start free of the resume flag', async () => {
    const db = database();
    const run = await start(db, 'bob') as StartSoloRunResponse & { rounds?: unknown };
    expect(run.resumed).toBeUndefined();
    expect(run.rounds).toBeUndefined();
  });
});

describe('general category', () => {
  const startGeneral = (db: TestD1, label: string) => request(db, '/api/solo-runs', guest(label).authorization, {
    displayName: label,
    category: 'general',
  });

  it('starts a solo run in general with the general set, and keeps the category', async () => {
    const db = database();
    const response = await startGeneral(db, 'ann');
    expect(response.status).toBe(201);
    const run = await response.json() as StartSoloRunResponse;
    expect(run.questions.length).toBeGreaterThan(0);
    const row = db.sqlite.prepare('SELECT category FROM match_runs WHERE id = ?').get(run.runId) as { category: string };
    expect(row.category).toBe('general');
    expect(fullQuestions(db, run.runId).some((question) => question.id.startsWith('gp:'))).toBe(true);
  });

  it('serves a pack question (gp:) in mistake training', async () => {
    const db = database();
    const run = await (await startGeneral(db, 'bob')).json() as StartSoloRunResponse;
    const packId = fullQuestions(db, run.runId).find((question) => question.id.startsWith('gp:'))!.id;
    // Ошибка записана игроку без активного забега, так что вопрос не заблокирован.
    await recordMistake(db.binding, guest('ann').playerId, packId, NOW);
    const listed = await app.request('/api/training/mistakes', { headers: { authorization: guest('ann').authorization } }, {
      DB: db.binding,
      API_RATE_LIMITER: allowRateLimiter,
      TELEGRAM_BOT_TOKEN: 'test',
      SESSION_SIGNING_SECRET: sessionSecret,
      ENVIRONMENT: 'test',
      TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
    });
    expect(((await listed.json()) as { ids: string[] }).ids).toEqual([packId]);
    const questions = await request(db, '/api/training/questions', guest('ann').authorization, { ids: [packId] });
    expect(questions.status).toBe(200);
    expect(JSON.stringify(await questions.json())).toContain(packId);
  });
});
