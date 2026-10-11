import { describe, expect, it } from 'vitest';
import { CURRENT_ASYNC_MATCH_CONDITIONS, type MiniGameConfig, type Opponent, type Question } from '@clutch/shared';
import {
  completeSkillDistance,
  continueAfterAnswerResolution,
  createInitialGameState,
  createMatchLobbyState,
  createPreparedMatchState,
  recordAnswer,
} from './gameSession';

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

function opponentFor(matchQuestions: Question[], awards: number[] = matchQuestions.map(() => 0)): Opponent {
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

const customConfig: MiniGameConfig = {
  ...CURRENT_ASYNC_MATCH_CONDITIONS.miniGame.config,
  markerSpeed: 1.2,
  targetWidth: 0.3,
  perfectWidth: 0.08,
};

describe('game session construction', () => {
  it('creates and resets state without stale online fields', () => {
    const initial = createInitialGameState();
    expect(initial).toMatchObject({
      phase: 'home',
      questions: [],
      roundInputs: [],
      activeMatchId: undefined,
    });
    expect(initial.rulesState).toMatchObject({ roundsPlayed: 0, status: 'in_progress' });
  });

  it('builds local and online prepared matches with the right config and id', () => {
    const matchQuestions = questions(2);
    const opponent = opponentFor(matchQuestions);
    const local = createPreparedMatchState({ category: 'history', questions: matchQuestions, opponent });
    const online = createPreparedMatchState({
      category: 'languages',
      questions: matchQuestions,
      opponent,
      activeMatchId: 'online-1',
      miniGameConfig: customConfig,
    });

    expect(local).toMatchObject({ phase: 'question', category: 'history', activeMatchId: undefined });
    expect(online).toMatchObject({
      phase: 'question', category: 'languages', activeMatchId: 'online-1', miniGameConfig: customConfig,
    });
  });

  it('keeps explicit local practice in a ready lobby without an online id', () => {
    const matchQuestions = questions(2);
    const lobby = createMatchLobbyState({
      category: 'geography',
      questions: matchQuestions,
      opponent: opponentFor(matchQuestions),
      matchSource: 'local',
    });
    expect(lobby).toMatchObject({
      phase: 'matchmaking',
      matchSource: 'local',
      activeMatchId: undefined,
      questions: matchQuestions,
    });
  });
});

describe('game session transitions', () => {
  it('records multiple-choice and normalized open answers', () => {
    const matchQuestions = questions(2);
    matchQuestions[1] = {
      ...matchQuestions[1],
      answerType: 'open_answer',
      correctAnswers: ['Казахстан'],
    };
    const base = createPreparedMatchState({
      category: 'geography', questions: matchQuestions, opponent: opponentFor(matchQuestions),
    });
    const multipleChoice = recordAnswer(base, 'correct', 1200);
    const openAnswer = recordAnswer({ ...base, questionIndex: 1 }, ' казахстан ', 2300);

    expect(multipleChoice).toMatchObject({
      phase: 'resolution', lastCorrect: true, correctCount: 1,
      selectedOption: 'correct', responseTimes: [1200],
    });
    expect(openAnswer).toMatchObject({
      phase: 'resolution', lastCorrect: true, correctCount: 1,
      selectedOption: ' казахстан ', responseTimes: [2300],
    });
  });

  it('sends a correct answer to the skill phase without recording the round yet', () => {
    const matchQuestions = questions(1);
    const answered = recordAnswer(createPreparedMatchState({
      category: 'geography', questions: matchQuestions, opponent: opponentFor(matchQuestions),
    }), 'correct', 900);

    expect(continueAfterAnswerResolution(answered)).toMatchObject({
      phase: 'hammer', questionIndex: 0, roundInputs: [],
    });
  });

  it('records an incorrect prefix exactly, then advances or completes', () => {
    const matchQuestions = questions(2);
    const start = createPreparedMatchState({
      category: 'geography', questions: matchQuestions, opponent: opponentFor(matchQuestions),
    });
    const afterFirst = continueAfterAnswerResolution(recordAnswer(start, 'wrong', 1400));
    expect(afterFirst).toMatchObject({
      phase: 'question', questionIndex: 1,
      rulesState: { roundsPlayed: 1, status: 'in_progress' },
      roundInputs: [{
        questionId: 'question-1', selectedAnswer: 'wrong', responseTimeMs: 1400,
      }],
    });
    expect(afterFirst.roundInputs[0]).not.toHaveProperty('skillDistance');

    const completed = continueAfterAnswerResolution(recordAnswer(afterFirst, 'wrong', 1600));
    expect(completed).toMatchObject({
      phase: 'result', questionIndex: 1,
      rulesState: { roundsPlayed: 2, status: 'completed' },
      roundInputs: [
        { questionId: 'question-1', selectedAnswer: 'wrong', responseTimeMs: 1400 },
        { questionId: 'question-2', selectedAnswer: 'wrong', responseTimeMs: 1600 },
      ],
    });
    expect(completed.roundInputs).toHaveLength(completed.rulesState.roundsPlayed);
  });

  it('re-derives the skill result from distance and appends skillDistance', () => {
    const matchQuestions = questions(2);
    const answered = recordAnswer(createPreparedMatchState({
      category: 'geography', questions: matchQuestions, opponent: opponentFor(matchQuestions),
    }), 'correct', 800);
    const completedSkill = completeSkillDistance(answered, 0.2);

    expect(completedSkill).toMatchObject({
      phase: 'question', questionIndex: 1, lastSkill: 'great', bestSkill: 'great',
      skillResults: ['great'],
      rulesState: { roundsPlayed: 1, playerProgress: 18 },
      roundInputs: [{
        questionId: 'question-1', selectedAnswer: 'correct', responseTimeMs: 800, skillDistance: 0.2,
      }],
    });
  });

  it('re-scores the same distance by transcript stage while wrong answers and misses do not advance it', () => {
    const matchQuestions = questions(6);
    let state = createPreparedMatchState({
      category: 'geography', questions: matchQuestions, opponent: opponentFor(matchQuestions),
    });

    state = completeSkillDistance(recordAnswer(state, 'correct', 500), 0.14);
    expect(state.lastSkill).toBe('perfect');
    state = completeSkillDistance(recordAnswer(state, 'correct', 500), 0.14);
    expect(state.lastSkill).toBe('great');

    state = continueAfterAnswerResolution(recordAnswer(state, 'wrong', 500));
    state = completeSkillDistance(recordAnswer(state, 'correct', 500), 0.9);
    expect(state.lastSkill).toBe('miss');
    state = completeSkillDistance(recordAnswer(state, 'correct', 500), 0.14);

    expect(state.lastSkill).toBe('great');
    expect(state.skillResults).toEqual(['perfect', 'great', 'miss', 'great']);
    expect(state.rulesState.playerProgress).toBe(61);
  });

  it('uses roundsPlayed when an early fourth-round win becomes terminal', () => {
    const matchQuestions = questions(10);
    let state = createPreparedMatchState({
      category: 'geography', questions: matchQuestions, opponent: opponentFor(matchQuestions),
    });
    for (let index = 0; index < 4; index += 1) {
      state = completeSkillDistance(recordAnswer(state, 'correct', 500 + index), 0.1);
    }

    expect(state).toMatchObject({
      phase: 'result', questionIndex: 3,
      rulesState: { status: 'completed', roundsPlayed: 4, playerProgress: 100, outcome: 'player' },
    });
    expect(state.roundInputs).toHaveLength(4);
  });
});
