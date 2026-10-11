import { describe, expect, it } from 'vitest';
import {
  CURRENT_ASYNC_MATCH_CONDITIONS,
  createMatchRulesState,
  type Opponent,
  type Question,
  type StartAsyncMatchResponse,
} from '@clutch/shared';
import {
  applyClientRound,
  configForServerConditions,
  normalizeOnlineMatch,
  normalizeScriptedOpponent,
  scoreSkillDistance,
  validateMiniGameConfig,
} from './clientMatchRules';
import { createSampleOpponent } from './sampleData';

function questions(count: number): Question[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `question-${index + 1}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'geography',
    difficulty: 'Easy',
    prompt: `Question ${index + 1}`,
    options: [
      { id: 'correct', text: 'Correct' },
      { id: 'wrong', text: 'Wrong' },
    ],
    correctOptionId: 'correct',
    explanation: '',
    status: 'approved',
    createdAt: '2026-01-01',
  }));
}

function opponentFor(matchQuestions: Question[], awards: number[]): Opponent {
  return {
    id: 'opponent',
    displayName: 'Opponent',
    rounds: awards.map((progressAwarded, index) => ({
      questionId: matchQuestions[index].id,
      correct: progressAwarded > 0,
      responseTimeMs: 1000,
      skillScore: progressAwarded / 25,
      progressAwarded,
    })),
  };
}

function onlineMatch(matchQuestions: Question[], opponent: Opponent): StartAsyncMatchResponse {
  return {
    matchId: 'match-1',
    questions: matchQuestions,
    opponent,
    opponentSource: 'player',
    conditions: CURRENT_ASYNC_MATCH_CONDITIONS,
    bankExhausted: false,
  };
}

function play(
  matchQuestions: Question[],
  opponent: Opponent,
  playerAwards: number[],
) {
  return playerAwards.reduce(
    (state, award, index) => applyClientRound(state, matchQuestions, index, award, opponent),
    createMatchRulesState(),
  );
}

describe('scripted opponent normalization', () => {
  it('maps the local 10-round script to real ids and truncates at round 8', () => {
    const matchQuestions = questions(10);
    const opponent = createSampleOpponent(matchQuestions);
    expect(opponent.rounds).toHaveLength(8);
    expect(opponent.rounds.map((round) => round.questionId)).toEqual(
      matchQuestions.slice(0, 8).map((question) => question.id),
    );
  });

  it('rejects a short nonterminal transcript', () => {
    const matchQuestions = questions(3);
    expect(() => normalizeScriptedOpponent(
      opponentFor(matchQuestions, [25, 25]),
      matchQuestions,
    )).toThrow(/too short/i);
  });

  it('rejects malformed question and round input', () => {
    const matchQuestions = questions(2);
    matchQuestions[0].options = [];
    expect(() => normalizeScriptedOpponent(
      opponentFor(matchQuestions, [25, 25]),
      matchQuestions,
    )).toThrow(/correct option/i);

    const validQuestions = questions(2);
    const invalidOpponent = opponentFor(validQuestions, [25, 25]);
    invalidOpponent.rounds[0].progressAwarded = Number.NaN;
    expect(() => normalizeScriptedOpponent(invalidOpponent, validQuestions)).toThrow(/invalid round/i);
  });
});

describe('online match conditions and transcript validation', () => {
  it('accepts the current conditions and returns their config', () => {
    expect(configForServerConditions(CURRENT_ASYNC_MATCH_CONDITIONS)).toEqual(
      CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
    );
  });

  it('rejects unsupported rules, ids, and invalid configs', () => {
    expect(() => configForServerConditions({
      ...CURRENT_ASYNC_MATCH_CONDITIONS,
      rulesVersion: 'race-to-100-v3',
    })).toThrow(/not supported/i);
    expect(() => validateMiniGameConfig({
      markerSpeed: 0.8,
      targetWidth: 0.2,
      perfectWidth: 0.15,
      pressure: CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config.pressure,
    })).toThrow(/not supported/i);
    expect(() => validateMiniGameConfig({
      markerSpeed: 0.8,
      targetWidth: 0.85,
      perfectWidth: 0.06,
      pressure: CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config.pressure,
    })).toThrow(/not supported/i);
    expect(() => validateMiniGameConfig({
      ...CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
      pressure: {
        ...CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config.pressure,
        stageMultipliers: [1, 0.9, 0.8, 0.6],
      },
    })).toThrow(/not supported/i);
  });

  it('rejects a wrong question id and strict tails after 100', () => {
    const matchQuestions = questions(5);
    const wrongId = opponentFor(matchQuestions, [25, 25, 25, 25]);
    wrongId.rounds[0].questionId = 'wrong-id';
    expect(() => normalizeOnlineMatch(onlineMatch(matchQuestions, wrongId))).toThrow(/expected question/i);

    const tail = opponentFor(matchQuestions, [25, 25, 25, 25, 0]);
    expect(() => normalizeOnlineMatch(onlineMatch(matchQuestions, tail))).toThrow(/continues after/i);
  });

  it('rejects invalid sources and unsupported player awards', () => {
    const matchQuestions = questions(1);
    const match = onlineMatch(matchQuestions, opponentFor(matchQuestions, [0]));
    (match as { opponentSource: string }).opponentSource = 'unknown';
    expect(() => normalizeOnlineMatch(match)).toThrow(/invalid/i);
    expect(() => applyClientRound(
      createMatchRulesState(),
      matchQuestions,
      0,
      100,
      opponentFor(matchQuestions, [0]),
    )).toThrow(/not supported/i);
  });

  it('derives the reward from distance using server scoring', () => {
    expect(scoreSkillDistance(0.1)).toEqual({ result: 'perfect', progressAwarded: 25 });
    expect(scoreSkillDistance(0.9)).toEqual({ result: 'miss', progressAwarded: 0 });
    expect(() => scoreSkillDistance(Number.NaN)).toThrow(/invalid/i);
  });
});

describe('client round integration', () => {
  it('completes on the last question for a below-100 full set', () => {
    const matchQuestions = questions(3);
    const state = play(matchQuestions, opponentFor(matchQuestions, [5, 5, 5]), [0, 0, 0]);
    expect(state).toMatchObject({ status: 'completed', roundsPlayed: 3, outcome: 'opponent' });
  });

  it('ends with an early opponent win', () => {
    const matchQuestions = questions(10);
    const state = play(matchQuestions, opponentFor(matchQuestions, [25, 25, 25, 25]), [0, 0, 0, 0]);
    expect(state).toMatchObject({
      status: 'completed', roundsPlayed: 4, opponentProgress: 100, outcome: 'opponent',
    });
  });

  it('ends with an own early win', () => {
    const matchQuestions = questions(10);
    const state = play(
      matchQuestions,
      opponentFor(matchQuestions, Array(10).fill(0)),
      [25, 25, 25, 25],
    );
    expect(state).toMatchObject({
      status: 'completed', roundsPlayed: 4, playerProgress: 100, outcome: 'player',
    });
  });

  it('keeps simultaneous 100 as a tie', () => {
    const matchQuestions = questions(10);
    const state = play(
      matchQuestions,
      opponentFor(matchQuestions, [25, 25, 25, 25]),
      [25, 25, 25, 25],
    );
    expect(state).toMatchObject({
      status: 'completed', roundsPlayed: 4, playerProgress: 100,
      opponentProgress: 100, outcome: 'tie',
    });
  });
});

describe('short recorded opponent', () => {
  it('accepts a short online player transcript below 100 and keeps its progress frozen', () => {
    const matchQuestions = questions(10);
    const short = opponentFor(matchQuestions, [25, 0, 5, 0, 0, 5]); // stopped at question 6
    const normalized = normalizeOnlineMatch(onlineMatch(matchQuestions, short));
    expect(normalized.opponent.rounds).toHaveLength(6);

    const state = play(matchQuestions, normalized.opponent, Array(10).fill(0));
    expect(state).toMatchObject({
      status: 'completed', roundsPlayed: 10, opponentProgress: 35, playerProgress: 0, outcome: 'opponent',
    });
  });

  it('lets the player pass a frozen opponent and win by reaching 100', () => {
    const matchQuestions = questions(10);
    const short = opponentFor(matchQuestions, [25, 0, 5]);
    const state = play(matchQuestions, short, [25, 25, 25, 25]);
    expect(state).toMatchObject({ status: 'completed', roundsPlayed: 4, opponentProgress: 30, outcome: 'player' });
  });

  it('still rejects a short transcript below the pool threshold or from a bot', () => {
    const matchQuestions = questions(10);
    expect(() => normalizeOnlineMatch(onlineMatch(matchQuestions, opponentFor(matchQuestions, [25, 25]))))
      .toThrow(/too short/i);
    const bot = onlineMatch(matchQuestions, opponentFor(matchQuestions, [25, 0, 5, 0]));
    bot.opponentSource = 'bot';
    expect(() => normalizeOnlineMatch(bot)).toThrow(/too short/i);
  });
});
