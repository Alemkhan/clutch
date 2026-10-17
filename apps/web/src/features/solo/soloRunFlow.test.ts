import { describe, expect, it } from 'vitest';
import {
  CURRENT_SOLO_RUN_CONDITIONS,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  generateMatch,
  toPublicQuestion,
  type Opponent,
  type SoloRunSnapshot,
  type PublicQuestion,
  type SoloRoundResponse,
} from '@clutch/shared';
import { normalizeSoloSnapshot, type NormalizedSoloSnapshot } from './clientMatchRules';
import {
  applyLoadedSoloRun,
  applySoloAnswerVerdict,
  applySoloHammerVerdict,
  beginSoloLoading,
  completeSoloHammer,
  continueSoloAfterResolution,
  currentSoloQuestion,
  enterStartedSoloRun,
  failSoloLoading,
  failSoloSync,
  isSoloPlaying,
  recordSoloAnswer,
  restoreSoloRun,
  retrySoloSync,
  soloFlowView,
  soloRoundsLeft,
  startSoloPlay,
  type SoloFlowState,
} from './soloRunFlow';

const config = CURRENT_SOLO_RUN_CONDITIONS.miniGame.config;

function paceOf(questions: PublicQuestion[], awards: number[]): Opponent {
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

function started(questions: PublicQuestion[], pace: Opponent | null): SoloFlowState {
  const loaded = applyLoadedSoloRun(beginSoloLoading('geography'), {
    runId: 'run-1', questions, pace, config, miniGameId: 'hammer_nail', bankExhausted: false,
  });
  return startSoloPlay(loaded);
}

/** Ответ сервера по кругу: так выглядит то, что клиент получает вместо собственной проверки. */
function serverRound(state: SoloFlowState, overrides: Partial<SoloRoundResponse>): SoloRoundResponse {
  const pending = state.pending!;
  return {
    runId: 'run-1',
    roundIndex: pending.request.roundIndex,
    questionId: pending.request.questionId,
    correct: false,
    correctOptionId: currentSoloQuestion(state)?.options[0]?.id,
    explanation: 'Пояснение сервера.',
    awaitingHammer: false,
    skillResult: null,
    progressAwarded: 0,
    progress: 0,
    roundsPlayed: pending.request.roundIndex + 1,
    status: 'in_progress',
    reachedTarget: false,
    result: null,
    ...overrides,
  };
}

/** Круг с неверным ответом: сервер закрыл его с нулём, мини-игры нет. */
function missRound(state: SoloFlowState): SoloFlowState {
  const checking = recordSoloAnswer(state, '__timeout__', 1000);
  expect(checking.stage).toBe('checking');
  const resolved = applySoloAnswerVerdict(checking, serverRound(checking, { correct: false }));
  expect(resolved.stage).toBe('resolution');
  return continueSoloAfterResolution(resolved);
}

/** Верный ответ и идеальный удар: сервер присуждает +25. */
function perfectRound(state: SoloFlowState): SoloFlowState {
  const checking = recordSoloAnswer(state, 'a', 1000);
  const verdict = applySoloAnswerVerdict(checking, serverRound(checking, { correct: true, awaitingHammer: true }));
  const answered = continueSoloAfterResolution(verdict);
  expect(answered.stage).toBe('hammer');
  const submitting = completeSoloHammer(answered, 420);
  expect(submitting.stage).toBe('submitting');
  return applySoloHammerVerdict(submitting, serverRound(submitting, {
    correct: true, skillResult: 'perfect', progressAwarded: 25,
  }));
}

describe('solo run flow', () => {
  const questions = generateMatch(24, 0, 'geography').map(toPublicQuestion);

  it('moves loading, error and ready without starting the run by itself', () => {
    const loading = beginSoloLoading('history');
    expect(loading).toMatchObject({ stage: 'loading', category: 'history' });
    expect(failSoloLoading(loading, 'нет сети')).toMatchObject({ stage: 'error', error: 'нет сети' });
    const ready = applyLoadedSoloRun(loading, { runId: 'r', questions, pace: null, config, miniGameId: 'hammer_nail', bankExhausted: true });
    expect(ready).toMatchObject({ stage: 'ready', runId: 'r', bankExhausted: true });
    expect(soloFlowView(ready)).toMatchObject({ progress: 0, round: 1 });
    expect(startSoloPlay(ready).stage).toBe('question');
    expect(isSoloPlaying('ready')).toBe(false);
    for (const stage of ['question', 'checking', 'resolution', 'hammer', 'submitting'] as const) {
      expect(isSoloPlaying(stage)).toBe(true);
    }
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
});

describe('solo run flow with a server that scores the rounds', () => {
  const questions = generateMatch(24, 0, 'geography').map(toPublicQuestion);

  it('does not decide whether the answer is right: it waits for the server verdict', () => {
    const checking = recordSoloAnswer(started(questions, null), 'a', 1234);
    expect(checking).toMatchObject({
      stage: 'checking', selectedOption: 'a', lastCorrect: false, correctAnswer: '', correctCount: 0,
    });
    expect(checking.pending).toEqual({
      kind: 'answer',
      request: {
        roundIndex: 0,
        questionId: questions[0].id,
        selectedAnswer: 'a',
        responseTimeMs: 1234,
        selectedText: questions[0].options[0].text,
        optionCount: questions[0].options.length,
        firstOptionId: questions[0].options[0].id,
      },
    });
    // До ответа сервера ни пояснения, ни прогресса нет.
    expect(checking.explanation).toBe('');
    expect(soloFlowView(checking)).toMatchObject({ progress: 0, roundsPlayed: 0 });

    const correctOption = questions[0].options[2];
    const answered = applySoloAnswerVerdict(checking, serverRound(checking, {
      correct: true, awaitingHammer: true, correctOptionId: correctOption.id,
    }));
    expect(answered).toMatchObject({
      stage: 'resolution', lastCorrect: true, correctAnswer: correctOption.text, correctCount: 1, pending: null,
    });
    expect(answered.explanation).toBe('Пояснение сервера.');
  });

  it('shows the option the server recorded when it differs from the local choice', () => {
    const checking = recordSoloAnswer(started(questions, null), 'c', 900);
    const answered = applySoloAnswerVerdict(checking, serverRound(checking, {
      correct: false, awaitingHammer: false, correctOptionId: 'c', selectedAnswer: 'a',
    }));
    expect(answered.selectedOption).toBe('a');
    // Старый сервер без поля: остаётся локальный выбор.
    const legacy = applySoloAnswerVerdict(checking, serverRound(checking, { correct: true, awaitingHammer: true, correctOptionId: 'c' }));
    expect(legacy.selectedOption).toBe('c');
  });

  it('sends only the plain answer for an open question and for a timeout', () => {
    const openQuestion = generateMatch(1, 1, 'geography').map(toPublicQuestion);
    expect(recordSoloAnswer(started(openQuestion, null), 'Астана', 800).pending?.request).toEqual({
      roundIndex: 0, questionId: openQuestion[0].id, selectedAnswer: 'Астана', responseTimeMs: 800,
    });
    const timeout = recordSoloAnswer(started(questions, null), '__timeout__', 15000).pending?.request;
    expect(timeout).not.toHaveProperty('selectedText');
  });

  it('uses the first canonical server answer for an open question', () => {
    const openQuestion = generateMatch(1, 1, 'geography').map(toPublicQuestion);
    const checking = recordSoloAnswer(started(openQuestion, null), 'Астана', 800);
    expect(checking.correctAnswer).toBe('');

    const answered = applySoloAnswerVerdict(checking, serverRound(checking, {
      correct: false,
      correctOptionId: undefined,
      correctAnswers: ['Сьюдад-де-ла-Пас', 'Ciudad de la Paz'],
    }));
    expect(answered).toMatchObject({
      stage: 'resolution', lastCorrect: false, correctAnswer: 'Сьюдад-де-ла-Пас', selectedOption: 'Астана',
    });
  });

  it('takes the reward from the server, not from the tap moment', () => {
    let state = recordSoloAnswer(started(questions, null), 'a', 1);
    state = continueSoloAfterResolution(applySoloAnswerVerdict(state, serverRound(state, { correct: true, awaitingHammer: true })));
    const submitting = completeSoloHammer(state, 420);
    expect(submitting.pending).toEqual({
      kind: 'hammer',
      request: { roundIndex: 0, questionId: questions[0].id, activeElapsedMs: 420 },
    });
    // Сервер присудил 12: именно это попадает в прогресс, присланное время само собой не награда.
    const done = applySoloHammerVerdict(submitting, serverRound(submitting, {
      correct: true, skillResult: 'good', progressAwarded: 12,
    }));
    expect(soloFlowView(done)).toMatchObject({ progress: 12, roundsPlayed: 1 });
    expect(done.skillResults).toEqual(['good']);
  });

  it('ignores a verdict for another round or question', () => {
    const checking = recordSoloAnswer(started(questions, null), 'a', 1);
    expect(applySoloAnswerVerdict(checking, serverRound(checking, { roundIndex: 3 }))).toBe(checking);
    expect(applySoloAnswerVerdict(checking, serverRound(checking, { questionId: 'other' }))).toBe(checking);
    expect(applySoloAnswerVerdict(checking, serverRound(checking, { runId: 'other' }))).toBe(checking);
  });

  it('keeps the unsent round when the connection fails and allows sending it again', () => {
    const checking = recordSoloAnswer(started(questions, null), 'a', 1);
    const failed = failSoloSync(checking, 'offline');
    expect(failed).toMatchObject({ stage: 'checking', syncFailed: true });
    expect(failed.pending).toEqual(checking.pending);
    const retried = retrySoloSync(failed);
    expect(retried.syncFailed).toBe(false);
    expect(retried.pending).toEqual(checking.pending);
  });

  it('a wrong answer that the server closed with the run ends the run at the cap', () => {
    let state = started(questions, null);
    for (let round = 0; round < SOLO_ROUND_CAP - 1; round += 1) state = missRound(state);
    const checking = recordSoloAnswer(state, '__timeout__', 1);
    const closing = applySoloAnswerVerdict(checking, serverRound(checking, {
      correct: false,
      status: 'completed',
      result: {
        runId: 'run-1', rounds: [], progress: 0, correctCount: 0, roundsPlayed: SOLO_ROUND_CAP,
        reachedTarget: false, par: 5, score: 4, outcome: null,
      },
    }));
    expect(closing.result).toMatchObject({ roundsPlayed: SOLO_ROUND_CAP });
    expect(continueSoloAfterResolution(closing).stage).toBe('result');
  });
});

describe('a run interrupted after several rounds continues from the same place', () => {
  const questions = generateMatch(24, 0, 'geography').map(toPublicQuestion);
  const snapshot = (overrides: Partial<NormalizedSoloSnapshot> = {}): NormalizedSoloSnapshot => ({
    runId: 'run-1',
    questions,
    pace: null,
    config,
    miniGameId: 'hammer_nail',
    bankExhausted: false,
    category: 'geography',
    status: 'in_progress',
    result: null,
    rounds: [
      { questionId: questions[0].id, correct: true, skillResult: 'perfect', progressAwarded: 25, responseTimeMs: 1500 },
      { questionId: questions[1].id, correct: false, skillResult: null, progressAwarded: 0, responseTimeMs: 4000 },
      { questionId: questions[2].id, correct: true, skillResult: 'good', progressAwarded: 12, responseTimeMs: 2500 },
    ],
    ...overrides,
  });

  it('rebuilds progress, skill history and counters from the server record', () => {
    const state = restoreSoloRun(snapshot());
    expect(state).toMatchObject({
      stage: 'ready', resumed: true, runId: 'run-1', correctCount: 2, skillResults: ['perfect', 'good'], pending: null,
    });
    expect(soloFlowView(state)).toMatchObject({ progress: 37, roundsPlayed: 3, round: 4 });
    // Дальше играется следующий вопрос набора, а не первый.
    const playing = startSoloPlay(state);
    expect(currentSoloQuestion(playing)?.id).toBe(questions[3].id);
    expect(recordSoloAnswer(playing, 'a', 1).pending).toMatchObject({ request: { roundIndex: 3, questionId: questions[3].id } });
  });

  it('shows the result at once when the server has already closed the run', () => {
    const result = {
      runId: 'run-1', rounds: [], progress: 100, correctCount: 4, roundsPlayed: 4, reachedTarget: true,
      par: 5, score: 0.8, outcome: null,
    };
    const state = restoreSoloRun(snapshot({
      status: 'completed',
      result,
      rounds: [0, 1, 2, 3].map((index) => ({
        questionId: questions[index].id, correct: true, skillResult: 'perfect' as const, progressAwarded: 25, responseTimeMs: 1000,
      })),
    }));
    expect(state).toMatchObject({ stage: 'result', result });
  });
});

describe('a start that resumes an unfinished run', () => {
  const questions = generateMatch(24, 0, 'geography').map(toPublicQuestion);
  const base = {
    runId: 'run-1', questions, pace: null, target: SOLO_TARGET_PROGRESS, roundCap: SOLO_ROUND_CAP,
    rulesVersion: CURRENT_SOLO_RUN_CONDITIONS.rulesVersion, miniGameId: 'hammer_nail' as const,
    bankExhausted: false, category: 'geography' as const, status: 'in_progress' as const, result: null,
  };
  const played = (index: number, skillResult: 'perfect' | 'miss', progressAwarded: number) => ({
    questionId: questions[index].id, correct: true, skillResult, progressAwarded, responseTimeMs: 1500,
  });
  const resumedStart = (rounds: SoloRunSnapshot['rounds']): SoloRunSnapshot & { resumed: true } => ({
    ...base, rounds, resumed: true,
  });

  it('enters it like a restore: played rounds kept, play goes on from the first unplayed one', () => {
    const raw = resumedStart([played(0, 'perfect', 25), played(1, 'perfect', 25), played(2, 'perfect', 25)]);
    const entered = enterStartedSoloRun(beginSoloLoading('geography'), raw, false);
    expect(entered).toEqual(restoreSoloRun(normalizeSoloSnapshot(raw)));
    expect(entered).toMatchObject({ stage: 'ready', resumed: true, correctCount: 3, pending: null });
    expect(soloFlowView(entered)).toMatchObject({ progress: 75, roundsPlayed: 3 });
    expect(currentSoloQuestion(startSoloPlay(entered))?.id).toBe(questions[3].id);
  });

  it('treats a correct answer whose hammer the server forfeited as a played miss', () => {
    const raw = resumedStart([played(0, 'perfect', 25), played(1, 'perfect', 25), played(2, 'perfect', 25), played(3, 'miss', 0)]);
    const entered = enterStartedSoloRun(beginSoloLoading('geography'), raw, false);
    expect(entered).toEqual(restoreSoloRun(normalizeSoloSnapshot(raw)));
    expect(entered.skillResults).toEqual(['perfect', 'perfect', 'perfect', 'miss']);
    expect(currentSoloQuestion(startSoloPlay(entered))?.id).toBe(questions[4].id);
  });

  it('keeps a plain new start as it was: ready at round 0, not resumed', () => {
    const { status: _status, result: _result, category: _category, ...fresh } = base;
    const entered = enterStartedSoloRun(beginSoloLoading('geography'), fresh, false);
    expect(entered).toMatchObject({ stage: 'ready', resumed: false, correctCount: 0, runId: 'run-1' });
    expect(soloFlowView(entered)).toMatchObject({ roundsPlayed: 0 });
  });
});
