/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveQuestionById, type StartSoloRunResponse } from '@clutch/shared';
import app from '../apps/api/src/index';
import { createTestD1, type TestD1 } from './helpers/testD1';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const databases: TestD1[] = [];
const FORBIDDEN_KEYS = ['correctOptionId', 'correctAnswers', 'explanation'];

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(): TestD1 {
  const result = createTestD1();
  databases.push(result);
  return result;
}

function guestAuthorization(label: string): string {
  const hex = createHash('sha256').update(label).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const subject = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: subject, iat: now - 1, exp: now + 3600 })).toString('base64url');
  const signed = `v1.${payload}`;
  return `Bearer ${signed}.${createHmac('sha256', sessionSecret).update(signed).digest('base64url')}`;
}

function call(db: TestD1, method: string, path: string, authorization: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, {
    DB: db.binding,
    API_RATE_LIMITER: { limit: async () => ({ success: true }) } as RateLimit,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  });
}

function expectNoAnswers(text: string): void {
  for (const key of FORBIDDEN_KEYS) expect(text).not.toContain(`"${key}"`);
}

/**
 * Отсутствия полей мало: ответ мог бы уехать в любом другом поле того же вопроса — в подписи,
 * в адресе картинки, в подкатегории. У вопроса с открытым вводом вариантов на экране нет,
 * поэтому в его собственной выдаче правильного ответа быть не должно нигде.
 *
 * Проверяется ИМЕННО собственная выдача вопроса, а не весь ответ целиком: набор уходит клиенту
 * разом, в двадцати вопросах стоит под шесть десятков названий стран среди вариантов, и верный
 * ответ открытого вопроса закономерно встречается неверным вариантом соседнего. Это свойство
 * формата, а не утечка (docs/AUDIT.md, A06).
 */
function expectNoOpenAnswerText(questions: StartSoloRunResponse['questions']): number {
  let checked = 0;
  for (const question of questions) {
    if (question.answerType !== 'open_answer') continue;
    const own = JSON.stringify(question).toLowerCase();
    const rebuilt = resolveQuestionById(question.id);
    expect(rebuilt, question.id).not.toBeNull();
    for (const answer of rebuilt!.correctAnswers ?? []) {
      if (answer.length < 4) continue; // «8», «Ом»: короткая строка случайно встречается в id и подписях
      expect(own, `${question.id}: «${answer}»`).not.toContain(answer.toLowerCase());
      checked += 1;
    }
  }
  return checked;
}

describe('no route hands out answers to unanswered questions', () => {
  // «Другие флаги» и «Языки» идут только вариантами; счётчик доказывает, что проверка
  // открытых ответов не обессмыслилась молча на остальных категориях.
  let openAnswersChecked = 0;

  it('the race-mode routes no longer exist', async () => {
    const db = database();
    const authorization = guestAuthorization('racer');
    const start = await call(db, 'POST', '/api/async-matches', authorization, { displayName: 'Игрок', category: 'geography' });
    expect(start.status).toBe(404);
    expectNoAnswers(await start.text());
    const complete = await call(db, 'POST', '/api/async-matches/any-id/complete', authorization, { rounds: [] });
    expect(complete.status).toBe(404);
    // Ни одной строки гонки не создано.
    expect((db.sqlite.prepare('SELECT COUNT(*) AS count FROM match_runs').get() as { count: number }).count).toBe(0);
  });

  it.each(['general', 'geography', 'history', 'languages'])(
    'starting a solo run in %s and reopening it exposes no answer or explanation',
    async (category) => {
      const db = database();
      const authorization = guestAuthorization(`solo-${category}`);
      const started = await call(db, 'POST', '/api/solo-runs', authorization, { displayName: 'Игрок', category });
      expect(started.status).toBe(201);
      const text = await started.text();
      expectNoAnswers(text);
      const run = JSON.parse(text) as StartSoloRunResponse;
      expect(run.questions.length).toBeGreaterThan(0);
      openAnswersChecked += expectNoOpenAnswerText(run.questions);

      const snapshot = await call(db, 'GET', `/api/solo-runs/${run.runId}`, authorization);
      expect(snapshot.status).toBe(200);
      const snapshotText = await snapshot.text();
      expectNoAnswers(snapshotText);
      expectNoOpenAnswerText((JSON.parse(snapshotText) as StartSoloRunResponse).questions);
    },
  );

  it('actually examined open-answer questions', () => {
    expect(openAnswersChecked).toBeGreaterThan(0);
  });
});
