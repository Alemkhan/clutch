/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  CURRENT_SOLO_RUN_CONDITIONS,
  SOLO_ROUND_CAP,
  dailyBankSize,
  dailyQuestionSet,
  setPar,
  soloScore,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type CompleteSoloRunResponse,
  type StartSoloRunResponse,
  type Question,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config);
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
    ...(correct ? { skillDistance: 0 } : {}),
  }));
}

async function startRun(db: TestD1, label: string, path = '/api/solo-runs') {
  const response = await request(db, path, guest(label).authorization, {
    displayName: label,
    category: 'geography',
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
    CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id,
    configJson,
    set.questionSetId,
    options.reachedTarget,
  );
}

describe('solo run', () => {
  it('flags an exhausted day bank instead of silently repeating a set', async () => {
    const db = database();
    const size = dailyBankSize('geography');
    let first: StartSoloRunResponse | undefined;
    for (let step = 0; step < size; step++) {
      const run = await start(db, 'grinder');
      expect(run.bankExhausted).toBe(false);
      first ??= run;
    }
    const repeat = await start(db, 'grinder');
    expect(repeat.bankExhausted).toBe(true);
    expect(repeat.questions).toEqual(first!.questions);
  });

  it('reaches the target, is saved with par and score, and repeats canonically', async () => {
    const db = database();
    const run = await start(db, 'ann');
    expect(run.pace).toBeNull();
    expect(run.rulesVersion).toBe(SOLO);
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
      rules_version: SOLO,
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

  it('gives a pace from a finished solo run, and the pace cannot end the run', async () => {
    const db = database();
    insertRun(db, { id: 'pace-run', playerId: 'guest:other', rulesVersion: SOLO, reachedTarget: 1 });
    const run = await start(db, 'eve');
    expect(run.pace?.id).toBe('pace-run');
    expect(run.pace?.rounds).toHaveLength(4);

    // Темп добирает 100 на четвёртом круге, но забег игрока от этого не кончается.
    expect((await finish(db, 'eve', run.runId, roundInputs(fullQuestions(db, run.runId), 4, false))).status).toBe(400);
    expect(rowOf(db, run.runId)).toMatchObject({ status: 'in_progress' });
    const full = await finish(db, 'eve', run.runId, roundInputs(fullQuestions(db, run.runId), SOLO_ROUND_CAP, false));
    expect(full.status).toBe(200);
    expect(await full.json()).toMatchObject({ roundsPlayed: SOLO_ROUND_CAP, reachedTarget: false });
  });

  it('does not mix race records into the solo pool, or solo records into the race pool', async () => {
    const db = database();
    insertRun(db, {
      id: 'race-run',
      playerId: 'guest:other',
      rulesVersion: CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion,
      reachedTarget: null,
    });
    expect((await start(db, 'fay')).pace).toBeNull();

    const db2 = database();
    insertRun(db2, { id: 'solo-run', playerId: 'guest:other', rulesVersion: SOLO, reachedTarget: 1 });
    const race = await request(db2, '/api/async-matches', guest('gus').authorization, {
      displayName: 'gus', category: 'geography',
    });
    expect(race.status).toBe(201);
    expect((await race.json() as { opponentSource: string }).opponentSource).toBe('bot');
  });

  it('refuses another player, a race match id and unauthenticated calls', async () => {
    const db = database();
    const run = await start(db, 'hal');
    expect((await finish(db, 'mallory', run.runId, roundInputs(fullQuestions(db, run.runId), 4, true))).status).toBe(404);
    expect((await request(db, `/api/solo-runs/${run.runId}/answer`, '', {})).status).toBe(401);

    const race = await request(db, '/api/async-matches', guest('ivy').authorization, {
      displayName: 'ivy', category: 'geography',
    });
    const raceMatch = await race.json() as { matchId: string; questions: Question[] };
    expect((await finish(db, 'ivy', raceMatch.matchId, roundInputs(raceMatch.questions, 4, true))).status).toBe(409);
  });

  it('keeps the race mode working end to end', async () => {
    const db = database();
    const auth = guest('jon').authorization;
    const started = await request(db, '/api/async-matches', auth, { displayName: 'jon', category: 'geography' });
    expect(started.status).toBe(201);
    const match = await started.json() as { matchId: string; questions: Question[] };
    const done = await request(db, `/api/async-matches/${match.matchId}/complete`, auth, {
      rounds: roundInputs(match.questions, 4, true),
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ playerProgress: 100 });
  });
});
