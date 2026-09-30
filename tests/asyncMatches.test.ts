/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  generateMatch,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type Opponent,
  type Question,
  type StartAsyncMatchResponse,
} from '@clutch/shared';
import app from '../apps/api/src/index';
import { applyR1bMigration, createTestD1, type TestD1 } from './helpers/testD1';

const databases: TestD1[] = [];
const configJson = JSON.stringify(CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config);

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

function database(current = true): TestD1 {
  const result = createTestD1(current);
  databases.push(result);
  return result;
}

function env(db: TestD1) {
  return { DB: db.binding, TELEGRAM_BOT_TOKEN: 'test', ENVIRONMENT: 'test' };
}

async function start(db: TestD1, playerId = 'player-1'): Promise<StartAsyncMatchResponse> {
  const response = await app.request('/api/async-matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, displayName: playerId, category: 'geography' }),
  }, env(db));
  expect(response.status).toBe(201);
  return response.json() as Promise<StartAsyncMatchResponse>;
}

async function complete(db: TestD1, matchId: string, rounds: AsyncMatchRoundInput[]) {
  return app.request(`/api/async-matches/${matchId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rounds }),
  }, env(db));
}

function selectedAnswer(question: Question, correct: boolean): string {
  if (question.answerType === 'open_answer') {
    return correct ? question.correctAnswers![0] : '__definitely_wrong__';
  }
  if (correct) return question.correctOptionId;
  return question.options.find((option) => option.id !== question.correctOptionId)?.id
    ?? '__definitely_wrong__';
}

function inputs(questions: Question[], count: number, correct: boolean, skillDistance?: number) {
  return questions.slice(0, count).map((question) => ({
    questionId: question.id,
    selectedAnswer: selectedAnswer(question, correct),
    responseTimeMs: 1000,
    ...(skillDistance === undefined ? {} : { skillDistance }),
  }));
}

function opponent(questions: Question[], awards: number[]): Opponent {
  return {
    id: 'snapshot',
    displayName: 'Snapshot',
    rounds: awards.map((progressAwarded, index) => ({
      questionId: questions[index].id,
      correct: progressAwarded > 0,
      responseTimeMs: 1000,
      skillScore: progressAwarded / 25,
      progressAwarded,
    })),
  };
}

function insertRun(db: TestD1, options: {
  id: string;
  playerId?: string;
  questions: Question[];
  snapshot?: Opponent | null;
  rounds?: AsyncMatchRound[] | null;
  status?: 'in_progress' | 'completed';
  eligible?: number;
  rulesVersion?: string | null;
  miniGameId?: string | null;
  config?: string | null;
  completedAt?: number | null;
  opponentRunId?: string | null;
}) {
  db.sqlite.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, rounds_json, progress,
      correct_count, status, opponent_run_id, created_at, completed_at, rules_version,
      mini_game_id, mini_game_config_json, opponent_json, ghost_eligible
    ) VALUES (?, ?, ?, 'geography', ?, ?, 0, 0, ?, ?, 1, ?, ?, ?, ?, ?, ?)
  `).run(
    options.id,
    options.playerId ?? options.id,
    options.playerId ?? options.id,
    JSON.stringify(options.questions),
    options.rounds ? JSON.stringify(options.rounds) : null,
    options.status ?? 'in_progress',
    options.opponentRunId ?? null,
    options.completedAt ?? null,
    options.rulesVersion === undefined
      ? CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion
      : options.rulesVersion,
    options.miniGameId === undefined
      ? CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id
      : options.miniGameId,
    options.config === undefined ? configJson : options.config,
    options.snapshot === undefined ? null : JSON.stringify(options.snapshot),
    options.eligible ?? 0,
  );
}

function storedRounds(questions: Question[], awards: number[]): AsyncMatchRound[] {
  let progress = 0;
  return awards.map((progressAwarded, index) => {
    progress = Math.min(100, progress + progressAwarded);
    return {
      questionId: questions[index].id,
      correct: progressAwarded > 0,
      responseTimeMs: 1000,
      progressAwarded,
      playerProgressAfter: progress,
    };
  });
}

describe('R1b migration', () => {
  it('preserves legacy rows with null conditions and makes them ineligible', () => {
    const db = database(false);
    db.sqlite.prepare(`
      INSERT INTO match_runs (id, player_id, display_name, category, questions_json, created_at)
      VALUES ('legacy', 'legacy', 'Legacy', 'geography', '[]', 1)
    `).run();
    applyR1bMigration(db.sqlite);

    const row = db.sqlite.prepare(`
      SELECT rules_version, mini_game_id, mini_game_config_json, opponent_json, ghost_eligible
      FROM match_runs WHERE id = 'legacy'
    `).get() as Record<string, unknown>;
    expect(row).toEqual({
      rules_version: null,
      mini_game_id: null,
      mini_game_config_json: null,
      opponent_json: null,
      ghost_eligible: 0,
    });
  });
});

describe('async match routes with persisted rules', () => {
  it('stores a trimmed bot snapshot and returns current conditions', async () => {
    const db = database();
    const created = await start(db);
    expect(created.conditions).toEqual(CURRENT_ASYNC_MATCH_CONDITIONS);
    expect(created.opponentSource).toBe('bot');
    expect(created.opponent.rounds).toHaveLength(8);
    expect(created.opponent.rounds.at(-1)?.questionId).toBe(created.questions[7].id);

    const row = db.sqlite.prepare(`
      SELECT rules_version, mini_game_id, mini_game_config_json, opponent_json
      FROM match_runs WHERE id = ?
    `).get(created.matchId) as Record<string, unknown>;
    expect(row.rules_version).toBe(CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion);
    expect(row.mini_game_config_json).toBe(configJson);
    expect(JSON.parse(row.opponent_json as string)).toEqual(created.opponent);
  });

  it('makes an own early win eligible and reuses its exact quiz as a ghost', async () => {
    const db = database();
    const first = await start(db, 'winner');
    const response = await complete(db, first.matchId, inputs(first.questions, 4, true, 0));
    expect(response.status).toBe(200);
    expect((db.sqlite.prepare('SELECT ghost_eligible FROM match_runs WHERE id = ?')
      .get(first.matchId) as { ghost_eligible: number }).ghost_eligible).toBe(1);

    const second = await start(db, 'challenger');
    expect(second.opponentSource).toBe('player');
    expect(second.questions).toEqual(first.questions);
    expect(second.conditions).toEqual(first.conditions);
    expect(second.opponent.id).toBe(first.matchId);
  });

  it('saves an early loss but excludes it from the opponent pool', async () => {
    const db = database();
    const first = await start(db, 'loser');
    const response = await complete(db, first.matchId, inputs(first.questions, 8, false));
    expect(response.status).toBe(200);
    const row = db.sqlite.prepare('SELECT status, ghost_eligible FROM match_runs WHERE id = ?')
      .get(first.matchId) as { status: string; ghost_eligible: number };
    expect(row).toEqual({ status: 'completed', ghost_eligible: 0 });
    expect((await start(db, 'next')).opponentSource).toBe('bot');
  });

  it('rejects a nonterminal prefix without writing completion fields', async () => {
    const db = database();
    const created = await start(db);
    const response = await complete(db, created.matchId, inputs(created.questions, 1, false));
    expect(response.status).toBe(400);
    const row = db.sqlite.prepare('SELECT status, rounds_json, completed_at FROM match_runs WHERE id = ?')
      .get(created.matchId) as Record<string, unknown>;
    expect(row).toEqual({ status: 'in_progress', rounds_json: null, completed_at: null });
  });

  it('rejects wrong order and rounds after the terminal round', async () => {
    const db = database();
    const first = await start(db, 'wrong-order');
    const wrongOrder = inputs(first.questions, 4, true, 0);
    wrongOrder[1].questionId = first.questions[2].id;
    expect((await complete(db, first.matchId, wrongOrder)).status).toBe(400);

    const second = await start(db, 'extra');
    expect((await complete(db, second.matchId, inputs(second.questions, 5, true, 0))).status).toBe(400);
  });

  it('accepts a full below-100 loss and marks it eligible', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, { id: 'full', questions, snapshot: opponent(questions, Array(10).fill(5)) });
    const response = await complete(db, 'full', inputs(questions, 10, false));
    expect(response.status).toBe(200);
    const row = db.sqlite.prepare('SELECT ghost_eligible FROM match_runs WHERE id = ?')
      .get('full') as { ghost_eligible: number };
    expect(row.ghost_eligible).toBe(1);
  });

  it('accepts simultaneous 100 and keeps the run eligible', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, { id: 'tie', questions, snapshot: opponent(questions, [25, 25, 25, 25]) });
    const response = await complete(db, 'tie', inputs(questions, 4, true, 0));
    expect(response.status).toBe(200);
    const body = await response.json() as { playerProgress: number };
    expect(body.playerProgress).toBe(100);
    const row = db.sqlite.prepare('SELECT ghost_eligible FROM match_runs WHERE id = ?')
      .get('tie') as { ghost_eligible: number };
    expect(row.ghost_eligible).toBe(1);
  });

  it.each([
    ['legacy', null, null, null],
    ['unknown-version', 'race-to-100-v2', CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id, configJson],
    ['unknown-config', CURRENT_ASYNC_MATCH_CONDITIONS.rulesVersion,
      CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.id, '{"markerSpeed":1}'],
  ])('returns 409 for unfinished %s conditions', async (id, rulesVersion, miniGameId, config) => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, {
      id,
      questions,
      snapshot: opponent(questions, Array(10).fill(0)),
      rulesVersion,
      miniGameId,
      config,
    });
    expect((await complete(db, id, inputs(questions, 10, false))).status).toBe(409);
  });

  it('returns stored results for an already-completed legacy run', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    const rounds = storedRounds(questions, [25, 25, 25, 25]);
    insertRun(db, {
      id: 'legacy-completed', questions, rounds, status: 'completed', eligible: 0,
      rulesVersion: null, miniGameId: null, config: null,
    });
    const response = await complete(db, 'legacy-completed', inputs(questions, 1, false));
    expect(response.status).toBe(200);
    expect((await response.json() as { rounds: AsyncMatchRound[] }).rounds).toEqual(rounds);
  });

  it('filters incompatible ghosts on unused and repeat selection paths', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    const rounds = storedRounds(questions, Array(10).fill(5));
    insertRun(db, { id: 'compatible', playerId: 'ghost', questions, rounds, status: 'completed', eligible: 1, completedAt: 1 });
    insertRun(db, {
      id: 'incompatible', playerId: 'newer-ghost', questions, rounds, status: 'completed',
      eligible: 1, completedAt: 2, rulesVersion: 'race-to-100-v2',
    });
    insertRun(db, {
      id: 'wrong-game', playerId: 'wrong-game-player', questions, rounds, status: 'completed',
      eligible: 1, completedAt: 3, miniGameId: 'future_game',
    });
    insertRun(db, {
      id: 'wrong-config', playerId: 'wrong-config-player', questions, rounds, status: 'completed',
      eligible: 1, completedAt: 4, config: '{"markerSpeed":1}',
    });
    const unused = await start(db, 'chooser');
    expect(unused.opponent.id).toBe('compatible');
    const repeat = await start(db, 'chooser');
    expect(repeat.opponent.id).toBe('compatible');
  });

  it('uses the stored snapshot even after the source ghost is edited', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    const rounds = storedRounds(questions, [25, 25, 25, 25]);
    insertRun(db, { id: 'source', playerId: 'source-player', questions, rounds, status: 'completed', eligible: 1, completedAt: 1 });
    const created = await start(db, 'challenger');
    db.sqlite.prepare("UPDATE match_runs SET rounds_json = 'not json' WHERE id = 'source'").run();
    expect((await complete(db, created.matchId, inputs(created.questions, 4, false))).status).toBe(200);
  });

  it('skips malformed and short flagged ghosts', async () => {
    const db = database();
    const questions = generateMatch(10, 0.3, 'geography');
    insertRun(db, {
      id: 'short', playerId: 'short-player', questions,
      rounds: storedRounds(questions, [25]), status: 'completed', eligible: 1, completedAt: 2,
    });
    const malformedQuestions = questions.map((question, index) => (
      index === 0 ? { ...question, options: [null] } : question
    )) as unknown as Question[];
    insertRun(db, {
      id: 'malformed', playerId: 'malformed-player', questions: malformedQuestions,
      rounds: storedRounds(malformedQuestions, [25, 25, 25, 25]),
      status: 'completed', eligible: 1, completedAt: 3,
    });
    insertRun(db, {
      id: 'bad-round', playerId: 'bad-round-player', questions,
      rounds: [{
        questionId: questions[0].id,
        correct: true,
        responseTimeMs: 1000,
        progressAwarded: 100,
        playerProgressAfter: 99,
      }],
      status: 'completed', eligible: 1, completedAt: 4,
    });
    expect((await start(db, 'chooser')).opponentSource).toBe('bot');
  });

  it('returns the first stored response on repeated completion', async () => {
    const db = database();
    const created = await start(db);
    const rounds = inputs(created.questions, 4, true, 0);
    const first = await complete(db, created.matchId, rounds);
    const second = await complete(db, created.matchId, inputs(created.questions, 1, false));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it('returns one canonical result for concurrent completion requests', async () => {
    const db = database();
    const created = await start(db);
    const [winningResponse, losingResponse] = await Promise.all([
      complete(db, created.matchId, inputs(created.questions, 4, true, 0)),
      complete(db, created.matchId, inputs(created.questions, 8, false)),
    ]);

    expect(winningResponse.status).toBe(200);
    expect(losingResponse.status).toBe(200);
    expect(await losingResponse.json()).toEqual(await winningResponse.json());
  });
});
