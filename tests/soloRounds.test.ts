/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SOLO_ROUND_CAP,
  type AsyncMatchRoundInput,
  type Question,
  type SoloRoundResponse,
  type SoloRunSnapshot,
  type StartSoloRunResponse,
  type TrainingCheckResponse,
  type TrainingQuestionsResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { listTrainableMistakes, payBackMistake, recordMistake } from '../apps/api/src/matches/mistakesRepository';
import { fullQuestions, roundInputs } from './helpers/soloPlay';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
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

const environment = (db: TestD1) => ({
  DB: db.binding,
  API_RATE_LIMITER: allowRateLimiter,
  TELEGRAM_BOT_TOKEN: 'test',
  SESSION_SIGNING_SECRET: sessionSecret,
  ENVIRONMENT: 'test',
  TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
});

function call(db: TestD1, label: string, path: string, body?: unknown) {
  return app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: guest(label) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, environment(db));
}

async function start(db: TestD1, label: string): Promise<StartSoloRunResponse> {
  const response = await call(db, label, '/api/solo-runs', { displayName: label, category: 'geography' });
  expect(response.status).toBe(201);
  return await response.json() as StartSoloRunResponse;
}

const answer = (db: TestD1, label: string, runId: string, roundIndex: number, input: AsyncMatchRoundInput) =>
  call(db, label, `/api/solo-runs/${runId}/answer`, {
    roundIndex,
    questionId: input.questionId,
    selectedAnswer: input.selectedAnswer,
    responseTimeMs: input.responseTimeMs,
  });

const hammer = (db: TestD1, label: string, runId: string, roundIndex: number, questionId: string, skillDistance: number) =>
  call(db, label, `/api/solo-runs/${runId}/hammer`, { roundIndex, questionId, skillDistance });

const roundCount = (db: TestD1, runId: string) =>
  (db.sqlite.prepare('SELECT COUNT(*) AS n FROM solo_run_rounds WHERE run_id = ?').get(runId) as { n: number }).n;

const runRow = (db: TestD1, runId: string) =>
  db.sqlite.prepare('SELECT status, progress, correct_count FROM match_runs WHERE id = ?').get(runId) as
    { status: string; progress: number; correct_count: number };

/** Полный круг: верный ответ и удар в центр. */
async function perfectRound(db: TestD1, label: string, runId: string, index: number, input: AsyncMatchRoundInput) {
  await answer(db, label, runId, index, input);
  return await (await hammer(db, label, runId, index, input.questionId, 0)).json() as SoloRoundResponse;
}

describe('answers never reach the browser before the round is played', () => {
  it('the start response carries no correct answers or explanations', async () => {
    const db = database();
    const run = await start(db, 'ann');
    expect(run.questions.length).toBeGreaterThan(0);
    const text = JSON.stringify(run);
    expect(text).not.toContain('correctOptionId');
    expect(text).not.toContain('correctAnswers');
    expect(text).not.toContain('explanation');
    // Сервер при этом ответы хранит и проверяет по ним.
    expect(fullQuestions(db, run.runId)[0].correctOptionId).toBeDefined();
  });

  it('the practice start response is clean too', async () => {
    const db = database();
    const response = await call(db, 'ann', '/api/solo-runs', { displayName: 'Ann', category: 'geography', botLevel: 'novice' });
    expect(response.status).toBe(201);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain('correctOptionId');
    expect(text).not.toContain('correctAnswers');
    expect(text).not.toContain('explanation');
  });

  it('the resume snapshot is clean as well', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const snapshot = await call(db, 'ann', `/api/solo-runs/${run.runId}`);
    const text = JSON.stringify(await snapshot.json());
    expect(text).not.toContain('correctOptionId');
    expect(text).not.toContain('correctAnswers');
    expect(text).not.toContain('explanation');
  });

  it('reveals the right answer only in the reply to a played round', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const questions = fullQuestions(db, run.runId);
    const [wrong] = roundInputs(questions, 1, false);
    const response = await answer(db, 'ann', run.runId, 0, wrong);
    expect(response.status).toBe(200);
    const verdict = await response.json() as SoloRoundResponse;
    expect(verdict).toMatchObject({
      correct: false,
      awaitingHammer: false,
      progressAwarded: 0,
      progress: 0,
      roundsPlayed: 1,
      status: 'in_progress',
      correctOptionId: questions[0].correctOptionId,
    });
    expect(verdict.explanation).toBe(questions[0].explanation);
  });
});

describe('a round is counted once', () => {
  it('a repeated answer returns the stored verdict and does not add a round', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const questions = fullQuestions(db, run.runId);
    const [right] = roundInputs(questions, 1, true);
    const first = await (await answer(db, 'ann', run.runId, 0, right)).json() as SoloRoundResponse;
    expect(first).toMatchObject({ correct: true, awaitingHammer: true, progress: 0 });
    // Второй запрос с другим ответом ничего не меняет: засчитан первый.
    const [wrong] = roundInputs(questions, 1, false);
    const again = await (await answer(db, 'ann', run.runId, 0, wrong)).json() as SoloRoundResponse;
    expect(again).toEqual(first);
    expect(roundCount(db, run.runId)).toBe(1);
  });

  it('a repeated hammer does not double the progress, even with another distance', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const [right] = roundInputs(fullQuestions(db, run.runId), 1, true);
    await answer(db, 'ann', run.runId, 0, right);
    const first = await (await hammer(db, 'ann', run.runId, 0, right.questionId, 0)).json() as SoloRoundResponse;
    expect(first).toMatchObject({ awaitingHammer: false, skillResult: 'perfect', progressAwarded: 25, progress: 25 });
    const again = await (await hammer(db, 'ann', run.runId, 0, right.questionId, 0)).json() as SoloRoundResponse;
    const worse = await (await hammer(db, 'ann', run.runId, 0, right.questionId, 0.9)).json() as SoloRoundResponse;
    expect(again).toEqual(first);
    expect(worse).toEqual(first);
    expect(runRow(db, run.runId).status).toBe('in_progress');
  });

  it('the database refuses a second row for the same round', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const [right] = roundInputs(fullQuestions(db, run.runId), 1, true);
    await answer(db, 'ann', run.runId, 0, right);
    expect(() => db.sqlite.prepare(`
      INSERT INTO solo_run_rounds (run_id, round_index, question_id, selected_answer, response_time_ms, correct, created_at)
      VALUES (?, 0, 'x', 'a', 1, 1, 1)
    `).run(run.runId)).toThrow(/UNIQUE|PRIMARY/i);
  });

  it('concurrent copies of the same answer and hammer are counted once', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const [right] = roundInputs(fullQuestions(db, run.runId), 1, true);
    const answers = await Promise.all([0, 1, 2].map(() => answer(db, 'ann', run.runId, 0, right)));
    expect(answers.map((response) => response.status)).toEqual([200, 200, 200]);
    const hammers = await Promise.all([0, 1, 2].map(() => hammer(db, 'ann', run.runId, 0, right.questionId, 0)));
    const bodies = await Promise.all(hammers.map((response) => response.json() as Promise<SoloRoundResponse>));
    expect(new Set(bodies.map((body) => body.progress))).toEqual(new Set([25]));
    expect(roundCount(db, run.runId)).toBe(1);
  });

  it('rounds must arrive in order and a hammer needs a correct answer first', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const inputs = roundInputs(fullQuestions(db, run.runId), 3, true);
    expect((await answer(db, 'ann', run.runId, 1, inputs[1])).status).toBe(409);
    expect((await hammer(db, 'ann', run.runId, 0, inputs[0].questionId, 0)).status).toBe(409);
    // Неверный ответ не даёт удара.
    const [wrong] = roundInputs(fullQuestions(db, run.runId), 1, false);
    await answer(db, 'ann', run.runId, 0, wrong);
    expect((await hammer(db, 'ann', run.runId, 0, wrong.questionId, 0)).status).toBe(409);
    // Следующий вопрос нельзя пропустить: подменённый id отклоняется.
    expect((await answer(db, 'ann', run.runId, 1, inputs[2])).status).toBe(400);
    expect(roundCount(db, run.runId)).toBe(1);
  });

  it('rejects a skill distance outside 0..1 and foreign players', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const [right] = roundInputs(fullQuestions(db, run.runId), 1, true);
    expect((await answer(db, 'mallory', run.runId, 0, right)).status).toBe(404);
    await answer(db, 'ann', run.runId, 0, right);
    expect((await hammer(db, 'ann', run.runId, 0, right.questionId, 1.5)).status).toBe(400);
    expect((await hammer(db, 'mallory', run.runId, 0, right.questionId, 0)).status).toBe(404);
  });
});

describe('the server closes the run', () => {
  it('closes at the target on the fourth perfect round and saves the result with the round', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const inputs = roundInputs(fullQuestions(db, run.runId), 5, true);
    let last: SoloRoundResponse | undefined;
    for (let index = 0; index < 4; index += 1) {
      last = await perfectRound(db, 'ann', run.runId, index, inputs[index]);
      expect(last.status).toBe(index === 3 ? 'completed' : 'in_progress');
    }
    expect(last).toMatchObject({ progress: 100, reachedTarget: true, roundsPlayed: 4 });
    expect(last!.result).toMatchObject({ progress: 100, reachedTarget: true, roundsPlayed: 4, correctCount: 4 });
    expect(runRow(db, run.runId)).toMatchObject({ status: 'completed', progress: 100, correct_count: 4 });
    // Дальше забег не идёт.
    expect((await answer(db, 'ann', run.runId, 4, inputs[4])).status).toBe(409);
  });

  it('closes at the round cap with wrong answers', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const inputs = roundInputs(fullQuestions(db, run.runId), SOLO_ROUND_CAP, false);
    let last: SoloRoundResponse | undefined;
    for (let index = 0; index < SOLO_ROUND_CAP; index += 1) {
      last = await (await answer(db, 'ann', run.runId, index, inputs[index])).json() as SoloRoundResponse;
    }
    expect(last).toMatchObject({ status: 'completed', reachedTarget: false, roundsPlayed: SOLO_ROUND_CAP });
    expect(last!.result).toMatchObject({ progress: 0, reachedTarget: false });
    expect(runRow(db, run.runId).status).toBe('completed');
  });

  it('a retry of the closing round returns the same result without closing twice', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const inputs = roundInputs(fullQuestions(db, run.runId), 4, true);
    let last: SoloRoundResponse | undefined;
    for (let index = 0; index < 4; index += 1) last = await perfectRound(db, 'ann', run.runId, index, inputs[index]);
    const retry = await (await hammer(db, 'ann', run.runId, 3, inputs[3].questionId, 0)).json() as SoloRoundResponse;
    expect(retry).toEqual(last);
    expect(roundCount(db, run.runId)).toBe(4);
  });
});

describe('a run interrupted after several rounds continues from the same place', () => {
  it('returns the played rounds and lets the player carry on to the end', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const inputs = roundInputs(fullQuestions(db, run.runId), 4, true);
    // Два полных круга и закрытая вкладка.
    for (let index = 0; index < 2; index += 1) await perfectRound(db, 'ann', run.runId, index, inputs[index]);

    const response = await call(db, 'ann', `/api/solo-runs/${run.runId}`);
    expect(response.status).toBe(200);
    const snapshot = await response.json() as SoloRunSnapshot;
    expect(snapshot).toMatchObject({ runId: run.runId, status: 'in_progress', result: null, category: 'geography' });
    expect(snapshot.questions).toEqual(run.questions);
    expect(snapshot.rounds).toHaveLength(2);
    expect(snapshot.rounds[0]).toMatchObject({
      questionId: inputs[0].questionId, correct: true, skillResult: 'perfect', progressAwarded: 25,
    });

    let done: SoloRoundResponse | undefined;
    for (let index = 2; index < 4; index += 1) done = await perfectRound(db, 'ann', run.runId, index, inputs[index]);
    expect(done!.result).toMatchObject({ progress: 100, roundsPlayed: 4 });
    const finished = await (await call(db, 'ann', `/api/solo-runs/${run.runId}`)).json() as SoloRunSnapshot;
    expect(finished.status).toBe('completed');
    expect(finished.result).toMatchObject({ progress: 100, roundsPlayed: 4, reachedTarget: true });
    expect(finished.rounds).toHaveLength(4);
  });

  it('counts a correct answer left without a hammer as a miss, so the strike cannot be redone', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const [right] = roundInputs(fullQuestions(db, run.runId), 1, true);
    await answer(db, 'ann', run.runId, 0, right);
    const snapshot = await (await call(db, 'ann', `/api/solo-runs/${run.runId}`)).json() as SoloRunSnapshot;
    expect(snapshot.rounds).toEqual([
      { questionId: right.questionId, correct: true, skillResult: 'miss', progressAwarded: 0, responseTimeMs: 1000 },
    ]);
    // Поздний удар уже ничего не меняет.
    const late = await (await hammer(db, 'ann', run.runId, 0, right.questionId, 0)).json() as SoloRoundResponse;
    expect(late).toMatchObject({ skillResult: 'miss', progressAwarded: 0, progress: 0 });
  });

  it('refuses another player and a race match', async () => {
    const db = database();
    const run = await start(db, 'ann');
    expect((await call(db, 'mallory', `/api/solo-runs/${run.runId}`)).status).toBe(404);
    const race = await call(db, 'ann', '/api/async-matches', { displayName: 'ann', category: 'geography' });
    const match = await race.json() as { matchId: string };
    expect((await call(db, 'ann', `/api/solo-runs/${match.matchId}`)).status).toBe(409);
  });
});

describe('mistake training on the server', () => {
  const openMistakes = (db: TestD1, label: string) => call(db, label, '/api/training/mistakes');
  const trainingCheck = (db: TestD1, label: string, questionId: string, answerText: string) =>
    call(db, label, '/api/training/check', { questionId, answer: answerText });
  const trainingQuestions = (db: TestD1, label: string, ids: string[]) =>
    call(db, label, '/api/training/questions', { ids });

  /** Текст верного ответа: так проверяется вопрос с вариантами; для открытого вопроса это сам ответ. */
  const rightText = (question: Question): string => question.answerType === 'open_answer'
    ? question.correctAnswers![0]
    : question.options.find((option) => option.id === question.correctOptionId)!.text;

  async function playWrong(db: TestD1, label: string, runId: string, count: number) {
    const inputs = roundInputs(fullQuestions(db, runId), count, false);
    for (let index = 0; index < inputs.length; index += 1) {
      expect((await answer(db, label, runId, index, inputs[index])).status).toBe(200);
    }
    return inputs;
  }

  it('does not hand out the answer to a question taken from a fresh run, on either route', async () => {
    const db = database();
    const run = await start(db, 'ann');
    for (const { id } of run.questions) {
      const check = await trainingCheck(db, 'ann', id, 'zzz');
      expect(check.status).toBe(404);
      expect(JSON.stringify(await check.json())).not.toMatch(/correct|explanation/);
      const listed = await trainingQuestions(db, 'ann', [id]);
      expect(listed.status).toBe(404);
      expect(JSON.stringify(await listed.json())).not.toMatch(/correct|explanation|options/);
    }
  });

  it('does not serve a question that is only in the active run, even if it is in the journal', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const questions = fullQuestions(db, run.runId);
    await playWrong(db, 'ann', run.runId, 1);
    // Игрок ошибся в этих вопросах раньше (журнал заполнен напрямую), но в этом забеге они ещё не сыграны.
    const insert = db.sqlite.prepare(
      'INSERT OR IGNORE INTO player_mistakes (player_id, question_id, owed_count, first_mistake_at, last_mistake_at) '
      + 'SELECT player_id, ?, 1, 1, 1 FROM match_runs WHERE id = ?',
    );
    for (const question of questions) insert.run(question.id, run.runId);

    const listed = await (await openMistakes(db, 'ann')).json() as { count: number; ids: string[] };
    expect(listed.ids).toEqual([questions[0].id]);
    expect((await trainingCheck(db, 'ann', questions[1].id, rightText(questions[1]))).status).toBe(404);
    expect((await trainingQuestions(db, 'ann', [questions[1].id])).status).toBe(404);
    // Сыгранный круг сервер уже показал, он доступен.
    expect((await trainingCheck(db, 'ann', questions[0].id, rightText(questions[0]))).status).toBe(200);
  });

  it('refuses unknown ids, ids never failed, and ids failed by someone else in exactly the same way', async () => {
    const db = database();
    const bobRun = await start(db, 'bob');
    await playWrong(db, 'bob', bobRun.runId, 1);
    const bobsId = fullQuestions(db, bobRun.runId)[0].id;
    expect(((await (await openMistakes(db, 'bob')).json()) as { ids: string[] }).ids).toEqual([bobsId]);

    const refusals: Array<[number, string]> = [];
    for (const id of ['nope_xx', 'capital_bf', bobsId]) {
      const check = await trainingCheck(db, 'ann', id, 'a');
      const listed = await trainingQuestions(db, 'ann', [id]);
      refusals.push([check.status, await check.text()], [listed.status, await listed.text()]);
    }
    expect(refusals.every(([status]) => status === 404)).toBe(true);
    expect(new Set(refusals.map(([, body]) => body)).size).toBe(1);
  });

  it('writes a wrong answer in a solo run to the player journal, once, and not a correct one', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const questions = fullQuestions(db, run.runId);
    const [wrong] = roundInputs(questions, 1, false);
    await answer(db, 'ann', run.runId, 0, wrong);
    await answer(db, 'ann', run.runId, 0, wrong);
    const [right] = roundInputs(questions.slice(1), 1, true);
    await perfectRound(db, 'ann', run.runId, 1, right);

    const rows = db.sqlite.prepare('SELECT question_id, owed_count, resolved_at FROM player_mistakes').all();
    expect(rows).toEqual([{ question_id: questions[0].id, owed_count: 1, resolved_at: null }]);
    expect(await (await openMistakes(db, 'ann')).json()).toEqual({ count: 1, ids: [questions[0].id] });
    expect(await (await openMistakes(db, 'bob')).json()).toEqual({ count: 0, ids: [] });
  });

  it('records mistakes from practice runs against a bot too', async () => {
    const db = database();
    const response = await call(db, 'ann', '/api/solo-runs', { displayName: 'Ann', category: 'geography', botLevel: 'novice' });
    const run = await response.json() as StartSoloRunResponse;
    await playWrong(db, 'ann', run.runId, 1);
    expect(((await (await openMistakes(db, 'ann')).json()) as { count: number }).count).toBe(1);
  });

  it('trains accumulated mistakes from start to finish and resolves them', async () => {
    const db = database();
    const run = await start(db, 'ann');
    const questions = fullQuestions(db, run.runId);
    await playWrong(db, 'ann', run.runId, 2);
    const { count, ids } = await (await openMistakes(db, 'ann')).json() as { count: number; ids: string[] };
    expect(count).toBe(2);
    expect(new Set(ids)).toEqual(new Set([questions[0].id, questions[1].id]));

    const served = await (await trainingQuestions(db, 'ann', ids)).json() as TrainingQuestionsResponse;
    expect(served.questions.map((question) => question.id)).toEqual(ids);
    const text = JSON.stringify(served);
    expect(text).not.toContain('correctOptionId');
    expect(text).not.toContain('correctAnswers');
    expect(text).not.toContain('explanation');

    for (const [position, id] of ids.entries()) {
      const question = questions.find((candidate) => candidate.id === id)!;
      const wrongAnswer = question.answerType === 'open_answer'
        ? '__wrong__'
        : question.options.find((option) => option.id !== question.correctOptionId)!.text;
      const miss = await (await trainingCheck(db, 'ann', id, wrongAnswer)).json() as TrainingCheckResponse;
      expect(miss.correct).toBe(false);
      expect(miss.correctText ?? miss.correctAnswers).toBeDefined();
      // Неверный ответ долг не гасит: осталось столько же, сколько было до этого вопроса.
      expect(((await (await openMistakes(db, 'ann')).json()) as { count: number }).count).toBe(ids.length - position);
      const hit = await (await trainingCheck(db, 'ann', id, rightText(question))).json() as TrainingCheckResponse;
      expect(hit.correct).toBe(true);
      expect(hit.explanation.length).toBeGreaterThan(0);
    }
    expect(await (await openMistakes(db, 'ann')).json()).toEqual({ count: 0, ids: [] });
    // Решённые ошибки помечены, а не удалены, и снова недоступны.
    const resolved = db.sqlite.prepare('SELECT COUNT(*) AS n FROM player_mistakes WHERE resolved_at IS NOT NULL').get() as { n: number };
    expect(resolved.n).toBe(2);
    expect((await trainingCheck(db, 'ann', ids[0], 'x')).status).toBe(404);
  });

  it('reopens a resolved mistake when the same question is failed again', async () => {
    const db = database();
    await recordMistake(db.binding, 'p1', 'capital_bf', 1);
    await payBackMistake(db.binding, 'p1', 'capital_bf', 2);
    expect(await listTrainableMistakes(db.binding, 'p1')).toEqual([]);
    await recordMistake(db.binding, 'p1', 'capital_bf', 3);
    expect(db.sqlite.prepare('SELECT owed_count, resolved_at FROM player_mistakes').get())
      .toEqual({ owed_count: 1, resolved_at: null });
    expect(await listTrainableMistakes(db.binding, 'p1')).toEqual(['capital_bf']);
  });

  it('validates input and authentication', async () => {
    const db = database();
    expect((await call(db, 'ann', '/api/training/questions', { ids: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 21 }, (_, index) => `capital_${index}`);
    expect((await call(db, 'ann', '/api/training/questions', { ids: tooMany })).status).toBe(400);
    expect((await call(db, 'ann', '/api/training/questions', { ids: [1] })).status).toBe(400);
    expect((await call(db, 'ann', '/api/training/check', { questionId: 'capital_bf' })).status).toBe(400);
    for (const path of ['/api/training/questions', '/api/training/check']) {
      const anonymous = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['capital_bf'], questionId: 'capital_bf', answer: 'x' }),
      }, environment(db));
      expect(anonymous.status).toBe(401);
    }
    expect((await app.request('/api/training/mistakes', {}, environment(db))).status).toBe(401);
  });
});
