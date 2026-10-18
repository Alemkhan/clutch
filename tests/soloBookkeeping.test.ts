/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

// Три сбоя, замеченные владельцем на живой игре 2026-10-13:
// исход не доходил до владельца записи, приглашение на реванш создавалось даже у победившей
// записи, а тренировка выдавала и расходовала наборы зачётного дня.

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_HAMMER_MINI_GAME,
  dailyQuestionSet,
  dailyQuestionSetIds,
  setPar,
  soloScore,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type Question,
  type StartSoloRunResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { notifySoloResult } from '../apps/api/src/notifications/outbid';
import { createTestD1, type TestD1 } from './helpers/testD1';
import { fullQuestions, playRounds, roundInputs } from './helpers/soloPlay';

const sessionSecret = 'test-session-signing-secret-at-least-32-characters';
const configJson = JSON.stringify(CURRENT_HAMMER_MINI_GAME.config);
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const databases: TestD1[] = [];
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
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

function envOf(db: TestD1) {
  return {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: sessionSecret,
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  };
}

function request(db: TestD1, path: string, authorization: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify(body),
  }, envOf(db));
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

/** Чужая завершённая запись на наборе дня: именно её получит следующий игрок соперником. */
function insertRecord(db: TestD1, id: string, playerId: string, displayName: string): void {
  const set = dailyQuestionSet('geography', NOW, 0);
  const par = setPar(set.questions);
  let progress = 0;
  // A deliberately beatable but valid record. Derive its score from the current set instead
  // of freezing the old par: beta cuts can change the mix and therefore question pricing.
  const rewards = [18, 18, 18, 18, 18, 12];
  const rounds: AsyncMatchRound[] = rewards.map((progressAwarded, index) => {
    progress = Math.min(100, progress + progressAwarded);
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
      mini_game_config_json, ghost_eligible, question_set_id, reached_target, set_par, solo_score
    ) VALUES (?, ?, ?, 'geography', ?, ?, 100, ?, 'completed', ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
  `).run(
    id,
    playerId,
    displayName,
    JSON.stringify(set.questions),
    JSON.stringify(rounds),
    rounds.length,
    NOW - 2000,
    NOW - 1000,
    'solo-to-100-v2',
    CURRENT_HAMMER_MINI_GAME.id,
    configJson,
    set.questionSetId,
    par,
    soloScore(rounds.length, par),
  );
}

/** Работа после ответа идёт без executionCtx, поэтому её результата ждём опросом. */
async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50 && !check(); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
  expect(check()).toBe(true);
}

function outcomeOf(db: TestD1, id: string): string | null {
  const row = db.sqlite.prepare('SELECT solo_outcome FROM match_runs WHERE id = ?').get(id) as { solo_outcome: string | null } | undefined;
  return row?.solo_outcome ?? null;
}

const soloEvent = {
  recipientRun: { id: 'record-run', playerId: 'telegram:42', category: 'geography' as const },
  challengerRunId: 'challenger-run',
  challengerName: 'Друг',
  recipientProgress: 100,
  challengerProgress: 100,
};

describe('итог доходит до владельца записи', () => {
  it('ставит исход и его записи, а не только финишировавшему забегу', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'guest:11111111-1111-4111-8111-111111111111', 'Алем');

    const player = guest('challenger');
    const started = await request(db, '/api/solo-runs', player.authorization, {
      displayName: 'Друг', category: 'geography', mode: 'duel',
    });
    expect(started.status).toBe(201);
    const run = await started.json() as StartSoloRunResponse;
    // Соперником должна прийти именно чужая запись, иначе проверка ни о чём.
    expect(run.pace?.id).toBe('record-run');

    const questions = fullQuestions(db, run.runId);
    const rounds: AsyncMatchRoundInput[] = roundInputs(questions, questions.length, true);
    const finished = await playRounds(
      (path, body) => request(db, path, player.authorization, body),
      run.runId,
      rounds,
    );
    expect(finished.status).toBe(200);

    // Раньше здесь навсегда оставался null, и в «Моих партиях» висело «Ждём соперника».
    await waitFor(() => outcomeOf(db, 'record-run') !== null);
    expect(outcomeOf(db, 'record-run')).toBe('opponent');
  });
});

describe('приглашение на реванш', () => {
  function invites(db: TestD1): unknown[] {
    return db.sqlite.prepare('SELECT * FROM rematch_invites').all() as unknown[];
  }

  it('не создаётся, когда запись устояла', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'telegram:42', 'Алем');
    await notifySoloResult(envOf(db) as never, { ...soloEvent, outcome: 'record_won' });
    expect(invites(db)).toHaveLength(0);
    // Известие всё равно уходит: владелец узнаёт исход.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(payload.text).toContain('устояла');
    // Кнопка только одна — отписка; звать на реванш победителя не за чем.
    expect(payload.reply_markup.inline_keyboard).toHaveLength(1);
  });

  it('не создаётся при ничьей', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'telegram:42', 'Алем');
    await notifySoloResult(envOf(db) as never, { ...soloEvent, outcome: 'tie' });
    expect(invites(db)).toHaveLength(0);
  });

  it('не создаётся и когда запись обошли: известие не вызов', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'telegram:42', 'Алем');
    insertRecord(db, 'challenger-run', 'guest:11111111-1111-4111-8111-111111111111', 'Друг');
    await notifySoloResult(envOf(db) as never, { ...soloEvent, outcome: 'record_lost' });
    // Раньше приглашение создавалось здесь, и у владельца записи оно выглядело как вызов,
    // которого соперник не посылал. Теперь его создаёт только нажатие соперника (DEC-09).
    expect(invites(db)).toHaveLength(0);
    const payload = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(payload.text).toBe('Друг обошёл вашу запись.');
    expect(payload.reply_markup.inline_keyboard).toHaveLength(1);
  });
});

describe('тренировка не трогает наборы зачётного дня', () => {
  it('выдаёт свой набор и не помечает дневной сыгранным', async () => {
    const db = database();
    const player = guest('trainee');
    const bank = dailyQuestionSetIds('geography', NOW);

    const practice = await request(db, '/api/solo-runs', player.authorization, {
      displayName: 'Игрок', category: 'geography', mode: 'duel', botLevel: 'novice',
    });
    expect(practice.status).toBe(201);
    const practiceRun = await practice.json() as StartSoloRunResponse;
    const practiceSetId = (db.sqlite
      .prepare('SELECT question_set_id FROM match_runs WHERE id = ?')
      .get(practiceRun.runId) as { question_set_id: string }).question_set_id;

    // Набор тренировки не из банка дня: подбор зачётного забега о нём не знает.
    expect(practiceSetId.startsWith('practice:')).toBe(true);
    expect(bank).not.toContain(practiceSetId);

    // Поэтому забег дня получает свой набор дня, как будто тренировки не было.
    const ranked = await request(db, '/api/solo-runs', player.authorization, {
      displayName: 'Игрок', category: 'geography', mode: 'daily',
    });
    expect(ranked.status).toBe(201);
    const rankedRun = await ranked.json() as StartSoloRunResponse;
    const rankedSetId = (db.sqlite
      .prepare('SELECT question_set_id FROM match_runs WHERE id = ?')
      .get(rankedRun.runId) as { question_set_id: string }).question_set_id;
    expect(rankedSetId).toBe(bank[0]);
    expect(rankedRun.bankExhausted).toBe(false);
  });

  it('повторная тренировка не выедает банк дня', async () => {
    const db = database();
    const player = guest('trainee-2');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(db, '/api/solo-runs', player.authorization, {
        displayName: 'Игрок', category: 'geography', mode: 'duel', botLevel: 'novice',
      });
      expect(response.status).toBe(201);
    }
    const played = db.sqlite
      .prepare("SELECT COUNT(*) AS count FROM match_runs WHERE question_set_id NOT LIKE 'practice:%'")
      .get() as { count: number };
    expect(played.count).toBe(0);
  });
});

export type { Question };

describe('повторный старт не теряет соперника', () => {
  it('возвращает незаконченный забег вместо нового', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'guest:11111111-1111-4111-8111-111111111111', 'Алем');
    const player = guest('restarter');
    const bank = dailyQuestionSetIds('geography', NOW);

    const first = await request(db, '/api/solo-runs', player.authorization, {
      displayName: 'Друг', category: 'geography', mode: 'duel',
    });
    expect(first.status).toBe(201);
    const firstRun = await first.json() as StartSoloRunResponse;
    expect(firstRun.pace?.id).toBe('record-run');

    // Игрок закрыл приложение и зашёл снова, ничего не доиграв.
    const second = await request(db, '/api/solo-runs', player.authorization, {
      displayName: 'Друг', category: 'geography', mode: 'duel',
    });
    expect(second.status).toBe(201);
    const secondRun = await second.json() as StartSoloRunResponse;

    // Тот же забег и тот же соперник, а не следующий набор дня без соперника.
    expect(secondRun.runId).toBe(firstRun.runId);
    expect(secondRun.pace?.id).toBe('record-run');
    const rows = db.sqlite
      .prepare("SELECT question_set_id AS id FROM match_runs WHERE player_id = ?")
      .all(player.playerId) as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(bank[0]);
  });
});

describe('матч — это пара', () => {
  it('запись достаётся одному: второй игрок остаётся без соперника', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'guest:11111111-1111-4111-8111-111111111111', 'Алем');

    const first = await request(db, '/api/solo-runs', guest('claimer-1').authorization, {
      displayName: 'Первый', category: 'geography', mode: 'duel',
    });
    const firstRun = await first.json() as StartSoloRunResponse;
    expect(firstRun.pace?.id).toBe('record-run');

    // Второй стартует на том же наборе дня, но запись уже занята.
    const second = await request(db, '/api/solo-runs', guest('claimer-2').authorization, {
      displayName: 'Второй', category: 'geography', mode: 'duel',
    });
    const secondRun = await second.json() as StartSoloRunResponse;
    expect(secondRun.pace).toBeNull();

    const claim = db.sqlite.prepare('SELECT claimed_by FROM match_runs WHERE id = ?').get('record-run') as { claimed_by: string | null };
    expect(claim.claimed_by).toBe(firstRun.runId);
  });

  it('претендент не становится записью для следующего', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'guest:11111111-1111-4111-8111-111111111111', 'Алем');

    const challenger = guest('challenger-x');
    const started = await request(db, '/api/solo-runs', challenger.authorization, {
      displayName: 'Претендент', category: 'geography', mode: 'duel',
    });
    const run = await started.json() as StartSoloRunResponse;
    expect(run.pace?.id).toBe('record-run');
    const questions = fullQuestions(db, run.runId);
    expect((await playRounds(
      (path, body) => request(db, path, challenger.authorization, body),
      run.runId,
      roundInputs(questions, questions.length, true),
    )).status).toBe(200);

    // Его забег дошёл до цели, но он уже сыграл матч: третьему он не достанется.
    const third = await request(db, '/api/solo-runs', guest('third').authorization, {
      displayName: 'Третий', category: 'geography', mode: 'duel',
    });
    expect((await third.json() as StartSoloRunResponse).pace).toBeNull();
  });

  it('владелец записи видит, кто её сыграл', async () => {
    const db = database();
    const owner = guest('owner');
    const ownerStart = await request(db, '/api/solo-runs', owner.authorization, {
      displayName: 'Алем', category: 'geography', mode: 'duel',
    });
    const ownerRun = await ownerStart.json() as StartSoloRunResponse;
    expect(ownerRun.pace).toBeNull();
    const ownerQuestions = fullQuestions(db, ownerRun.runId);
    expect((await playRounds(
      (path, body) => request(db, path, owner.authorization, body),
      ownerRun.runId,
      roundInputs(ownerQuestions, ownerQuestions.length, true),
    )).status).toBe(200);

    const rival = guest('rival');
    const rivalStart = await request(db, '/api/solo-runs', rival.authorization, {
      displayName: 'Друг', category: 'geography', mode: 'duel',
    });
    const rivalRun = await rivalStart.json() as StartSoloRunResponse;
    expect(rivalRun.pace?.id).toBe(ownerRun.runId);
    const rivalQuestions = fullQuestions(db, rivalRun.runId);
    expect((await playRounds(
      (path, body) => request(db, path, rival.authorization, body),
      rivalRun.runId,
      roundInputs(rivalQuestions, rivalQuestions.length, true),
    )).status).toBe(200);

    await waitFor(() => outcomeOf(db, ownerRun.runId) !== null);
    const mine = await app.request('/api/my-runs', { headers: { authorization: owner.authorization } }, envOf(db));
    expect(mine.status).toBe(200);
    const runs = (await mine.json() as { runs: Array<{ runId: string; opponent: { displayName: string } | null; outcome: string | null }> }).runs;
    const row = runs.find((entry) => entry.runId === ownerRun.runId)!;
    // Раньше здесь было «Победа» без имени: своя строка не знала, кто её сыграл.
    expect(row.opponent?.displayName).toBe('Друг');
    expect(row.outcome).not.toBeNull();
  });
});

describe('запись ждёт молчащего претендента, а не висит часами', () => {
  function claimOf(db: TestD1, id: string) {
    return db.sqlite.prepare('SELECT claimed_by, claimed_at FROM match_runs WHERE id = ?').get(id) as { claimed_by: string | null; claimed_at: number | null };
  }

  it('держит запись, пока претендент отвечает, и отпускает, когда он замолчал', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'guest:11111111-1111-4111-8111-111111111111', 'Алем');
    const player = guest('quitter');
    const started = await request(db, '/api/solo-runs', player.authorization, {
      displayName: 'Претендент', category: 'geography', mode: 'duel',
    });
    const run = await started.json() as StartSoloRunResponse;
    expect(run.pace?.id).toBe('record-run');
    expect(claimOf(db, 'record-run').claimed_by).toBe(run.runId);

    // Отвечает: запись за ним, сколько бы он ни играл.
    const questions = fullQuestions(db, run.runId);
    await playRounds(
      (path, body) => request(db, path, player.authorization, body),
      run.runId,
      roundInputs(questions, 2, true),
    );
    const other = await request(db, '/api/solo-runs', guest('other').authorization, {
      displayName: 'Другой', category: 'geography', mode: 'duel',
    });
    expect((await other.json() as StartSoloRunResponse).pace).toBeNull();

    // Замолчал: круги уходят в прошлое дальше окна ожидания.
    const longAgo = NOW - 10 * 60 * 1000;
    db.sqlite.prepare('UPDATE solo_run_rounds SET created_at = ?, settled_at = ? WHERE run_id = ?')
      .run(longAgo, longAgo, run.runId);
    db.sqlite.prepare('UPDATE match_runs SET claimed_at = ? WHERE id = ?').run(longAgo, 'record-run');

    const late = await request(db, '/api/solo-runs', guest('late').authorization, {
      displayName: 'Поздний', category: 'geography', mode: 'duel',
    });
    const lateRun = await late.json() as StartSoloRunResponse;
    expect(lateRun.pace?.id).toBe('record-run');
    expect(claimOf(db, 'record-run').claimed_by).toBe(lateRun.runId);

    // Пара порвана: вернувшийся играет один и знает об этом.
    const resumed = await app.request(`/api/solo-runs/${run.runId}`, { headers: { authorization: player.authorization } }, envOf(db));
    const snapshot = await resumed.json() as { pace: unknown; paceReleased?: boolean };
    expect(snapshot.pace).toBeNull();
    expect(snapshot.paceReleased).toBe(true);
  });

  it('завершённый матч запись не отпускает', async () => {
    const db = database();
    insertRecord(db, 'record-run', 'guest:11111111-1111-4111-8111-111111111111', 'Алем');
    const player = guest('finisher');
    const run = await (await request(db, '/api/solo-runs', player.authorization, {
      displayName: 'Претендент', category: 'geography', mode: 'duel',
    })).json() as StartSoloRunResponse;
    const questions = fullQuestions(db, run.runId);
    expect((await playRounds(
      (path, body) => request(db, path, player.authorization, body),
      run.runId,
      roundInputs(questions, questions.length, true),
    )).status).toBe(200);

    // Даже когда круги давно в прошлом: матч состоялся, запись занята навсегда.
    const longAgo = NOW - 10 * 60 * 1000;
    db.sqlite.prepare('UPDATE solo_run_rounds SET created_at = ?, settled_at = ? WHERE run_id = ?').run(longAgo, longAgo, run.runId);
    db.sqlite.prepare('UPDATE match_runs SET claimed_at = ? WHERE id = ?').run(longAgo, 'record-run');
    const late = await request(db, '/api/solo-runs', guest('late-2').authorization, {
      displayName: 'Поздний', category: 'geography', mode: 'duel',
    });
    expect((await late.json() as StartSoloRunResponse).pace).toBeNull();
  });
});
