import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_SOLO_RUN_CONDITIONS,
  SOLO_ROUND_CAP,
  generateMatch,
  type CompleteSoloRunResponse,
  type Opponent,
} from '@clutch/shared';
import { SoloRunScreen } from './SoloRun';
import {
  applyLoadedSoloRun,
  beginSoloLoading,
  createSoloFlowState,
  failSoloLoading,
  startSoloPlay,
  type SoloFlowState,
} from '../lib/soloRunFlow';
import { applySoloSessionRound, createSoloRunSession } from '../lib/soloRunSession';
import type { SoloSaveState } from '../lib/useSoloRun';

const questions = generateMatch(24, 0, 'geography');
const config = CURRENT_SOLO_RUN_CONDITIONS.miniGame.config;

const handlers = {
  onSelectCategory: vi.fn(),
  onRetryStart: vi.fn(),
  onBackToCategories: vi.fn(),
  onStart: vi.fn(),
  onAnswer: vi.fn(),
  onContinue: vi.fn(),
  onHammerComplete: vi.fn(),
  onRetrySave: vi.fn(),
  onHome: vi.fn(),
};

const saving: SoloSaveState = { status: 'saving', response: null, canRetry: false };

function pace(awards: number[], name = 'Alex'): Opponent {
  return {
    id: 'pace',
    displayName: name,
    rounds: awards.map((progressAwarded, index) => ({
      questionId: questions[index].id, correct: true, responseTimeMs: 2000, skillScore: 0, progressAwarded,
    })),
  };
}

function playing(opponent: Opponent | null, stage: SoloFlowState['stage'] = 'question', rounds: number[] = []): SoloFlowState {
  const loaded = applyLoadedSoloRun(beginSoloLoading('geography'), {
    runId: 'run-1', questions, pace: opponent, config, bankExhausted: false,
  });
  const session = rounds.reduce(applySoloSessionRound, loaded.session!);
  return { ...startSoloPlay({ ...loaded, session }), stage };
}

function finished(awards: number[], opponent: Opponent | null = null): SoloFlowState {
  const session = awards.reduce(applySoloSessionRound, createSoloRunSession(questions, opponent));
  return { ...createSoloFlowState(), stage: 'result', runId: 'run-1', session, correctCount: 5 };
}

function render(state: SoloFlowState, save: SoloSaveState = saving) {
  return renderToStaticMarkup(<SoloRunScreen state={state} save={save} {...handlers} />);
}

function saved(overrides: Partial<CompleteSoloRunResponse>): SoloSaveState {
  return {
    status: 'saved',
    canRetry: false,
    response: {
      runId: 'run-1', rounds: [], progress: 100, correctCount: 6, roundsPlayed: 4, reachedTarget: true,
      par: 5, score: 0.8, outcome: null, ...overrides,
    },
  };
}

describe('solo run screens', () => {
  it('asks for a category first, with the shared header', () => {
    const html = render(createSoloFlowState());
    expect(html).toContain('Выбери');
    expect(html).toContain('screen-header');
  });

  it('shows loading and an error with retry, both with a way back', () => {
    const loading = render(beginSoloLoading('geography'));
    expect(loading).toContain('role="status"');
    expect(loading).toContain('back-btn');
    const error = render(failSoloLoading(beginSoloLoading('geography'), 'Нет сети'));
    expect(error).toContain('role="alert"');
    expect(error).toContain('Нет сети');
    expect(error).toContain('Повторить');
    expect(error).toContain('back-btn');
  });

  it('says plainly when there is no pace and never invents a rival', () => {
    const html = render({ ...playing(null, 'ready') });
    expect(html).toContain('Темпа соперника пока нет');
    expect(html).not.toMatch(/Бот|Alex/);
  });

  it('tells that a pace does not finish the run', () => {
    const html = render({ ...playing(pace([25]), 'ready') });
    expect(html).toContain('Темп: Alex');
    expect(html).toContain('Он не завершает забег');
  });
});

describe('solo run HUD while playing', () => {
  it('draws the own progress, rounds left and no pace when there is none', () => {
    const html = render(playing(null, 'question', [10, 0]));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="10"');
    expect(html).toContain('Круг 3');
    expect(html).toContain(`осталось ${SOLO_ROUND_CAP - 2}`);
    expect(html).not.toContain('solo-hud-pace');
    expect(html).not.toContain('Темп:');
  });

  it('draws the pace as a mark on the same bar', () => {
    const html = render(playing(pace([25, 25]), 'question', [5, 5]));
    expect(html).toContain('solo-hud-pace-mark');
    expect(html).toContain('Темп: <strong>Alex</strong> · 50%');
    expect(html).toContain('aria-valuenow="10"');
  });

  it('keeps asking questions after the pace reached 100', () => {
    const html = render(playing(pace([25, 25, 25, 25]), 'question', [0, 0, 0, 0]));
    expect(html).toContain('Темп: <strong>Alex</strong> · 100%');
    expect(html).toContain('question-screen');
    expect(html).toContain('Круг 5');
    expect(html).not.toContain('result-screen');
  });
});

describe('solo run result', () => {
  it('reached the target: rounds, par and score in plain words', () => {
    const html = render(finished([25, 25, 25, 25]), saved({}));
    expect(html).toContain('Дошёл до 100%');
    expect(html).toContain('4 круга');
    expect(html).toContain('Эталон для этого набора — 5 кругов');
    expect(html).toContain('0,80');
    expect(html).toContain('быстрее эталонного игрока');
    expect(html).toContain('reached');
  });

  it('did not reach the target: says so, shows the progress, no victory wording', () => {
    const awards = new Array<number>(SOLO_ROUND_CAP).fill(2);
    const html = render(finished(awards), { ...saving });
    expect(html).toContain('До 100% не дошёл');
    expect(html).toContain('40% из 100%');
    expect(html).toContain('not-reached');
    expect(html).toContain('До цели');
    expect(html).not.toMatch(/Дошёл до 100|Клатч|Эталон/);
  });

  it('waiting for the rival is shown as waiting, not as a tie', () => {
    const html = render(finished([25, 25, 25, 25]), saved({ outcome: null }));
    expect(html).toContain('Ждём результата соперника');
    expect(html).toContain('solo-result-outcome waiting');
    expect(html).not.toContain('Ничья');
  });

  it('a real tie is shown as a tie, not as waiting', () => {
    const html = render(finished([25, 25, 25, 25], pace([25, 25, 25, 25])), saved({ outcome: 'tie' }));
    expect(html).toContain('Ничья с Alex');
    expect(html).toContain('solo-result-outcome tie');
    expect(html).not.toContain('Ждём результата');
  });

  it('shows the pending save and the failed save with retry', () => {
    expect(render(finished([25, 25, 25, 25]))).toContain('Сохраняем результат');
    const html = render(finished([25, 25, 25, 25]), {
      status: 'error', response: null, error: 'Не удалось сохранить результат.', canRetry: true,
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('Эталон');
  });

  it('does not render a question after the run is closed', () => {
    expect(render(finished([25, 25, 25, 25]))).not.toContain('question-screen');
  });
});
