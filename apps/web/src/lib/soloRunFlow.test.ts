import { describe, expect, it } from 'vitest';
import {
  CURRENT_SOLO_RUN_CONDITIONS,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  generateMatch,
  type Opponent,
  type Question,
} from '@clutch/shared';
import {
  applyLoadedSoloRun,
  beginSoloLoading,
  completeSoloHammer,
  continueSoloAfterResolution,
  currentSoloQuestion,
  failSoloLoading,
  isSoloPlaying,
  recordSoloAnswer,
  soloFlowView,
  soloRoundsLeft,
  startSoloPlay,
  type SoloFlowState,
} from './soloRunFlow';

const config = CURRENT_SOLO_RUN_CONDITIONS.miniGame.config;

function paceOf(questions: Question[], awards: number[]): Opponent {
  return {
    id: 'pace',
    displayName: 'Alex',
    rounds: awards.map((progressAwarded, index) => ({
      questionId: questions[index].id,
      correct: progressAwarded > 0,
      responseTimeMs: 2000,
      skillScore: 0,
      progressAwarded,
    })),
  };
}

function started(questions: Question[], pace: Opponent | null): SoloFlowState {
  const loaded = applyLoadedSoloRun(beginSoloLoading('geography'), {
    runId: 'run-1', questions, pace, config, bankExhausted: false,
  });
  return startSoloPlay(loaded);
}

/** Круг с неверным ответом: без мини-игры, прогресс 0. */
function missRound(state: SoloFlowState): SoloFlowState {
  return continueSoloAfterResolution(recordSoloAnswer(state, '__timeout__', 1000));
}

/** Верный ответ и идеальный удар: +25. */
function perfectRound(state: SoloFlowState): SoloFlowState {
  const question = currentSoloQuestion(state)!;
  const answered = continueSoloAfterResolution(recordSoloAnswer(state, question.correctOptionId, 1000));
  expect(answered.stage).toBe('hammer');
  return completeSoloHammer(answered, 0);
}

describe('solo run flow', () => {
  const questions = generateMatch(24, 0, 'geography');

  it('moves loading, error and ready without starting the run by itself', () => {
    const loading = beginSoloLoading('history');
    expect(loading).toMatchObject({ stage: 'loading', category: 'history' });
    expect(failSoloLoading(loading, 'нет сети')).toMatchObject({ stage: 'error', error: 'нет сети' });
    const ready = applyLoadedSoloRun(loading, { runId: 'r', questions, pace: null, config, bankExhausted: true });
    expect(ready).toMatchObject({ stage: 'ready', runId: 'r', bankExhausted: true });
    expect(soloFlowView(ready)).toMatchObject({ progress: 0, round: 1 });
    expect(startSoloPlay(ready).stage).toBe('question');
    expect(isSoloPlaying('ready')).toBe(false);
    expect(isSoloPlaying('hammer')).toBe(true);
  });

  it('a pace that reached 100 does NOT finish the run: the player keeps playing', () => {
    const pace = paceOf(questions, [25, 25, 25, 25]);
    let state = started(questions, pace);
    for (let round = 0; round < 4; round += 1) state = missRound(state);

    const view = soloFlowView(state)!;
    expect(view.paceProgress).toBe(SOLO_TARGET_PROGRESS);
    expect(view.progress).toBe(0);
    expect(view.completed).toBe(false);
    expect(state.stage).toBe('question');
    expect(currentSoloQuestion(state)?.id).toBe(questions[4].id);

    // Игрок доигрывает сам и закрывает забег своими четырьмя идеальными ударами.
    for (let round = 0; round < 4; round += 1) state = perfectRound(state);
    expect(state.stage).toBe('result');
    expect(soloFlowView(state)).toMatchObject({ progress: 100, reachedTarget: true, roundsPlayed: 8 });
  });

  it('the same player rounds give the same run with or without a pace', () => {
    const play = (pace: Opponent | null) => {
      let state = started(questions, pace);
      state = perfectRound(state);
      state = missRound(state);
      state = perfectRound(state);
      return soloFlowView(state)!;
    };
    expect({ ...play(paceOf(questions, [25, 25, 25, 25])), paceProgress: null }).toEqual(play(null));
  });

  it('ends only at the round cap when the player never reaches the target', () => {
    let state = started(questions, paceOf(questions, [25, 25, 25, 25]));
    for (let round = 0; round < SOLO_ROUND_CAP - 1; round += 1) {
      state = missRound(state);
      expect(state.stage).toBe('question');
    }
    expect(soloRoundsLeft(soloFlowView(state)!)).toBe(1);
    state = missRound(state);
    expect(state.stage).toBe('result');
    expect(soloFlowView(state)).toMatchObject({ completed: true, reachedTarget: false, roundsPlayed: SOLO_ROUND_CAP });
  });

  it('shows the closer limit when the set is shorter than the cap', () => {
    const view = soloFlowView(started(questions.slice(0, 5), null))!;
    expect(soloRoundsLeft(view)).toBe(5);
    expect(soloRoundsLeft({ roundsToCap: 3, questionsLeft: 9 })).toBe(3);
  });

  it('records one round input per round, with the hammer distance only after a hit', () => {
    let state = started(questions, null);
    state = missRound(state);
    state = perfectRound(state);
    expect(state.roundInputs).toEqual([
      expect.objectContaining({ questionId: questions[0].id, selectedAnswer: '__timeout__' }),
      expect.objectContaining({ questionId: questions[1].id, skillDistance: 0 }),
    ]);
    expect(state.roundInputs[0]).not.toHaveProperty('skillDistance');
    expect(state.correctCount).toBe(1);
  });
});
