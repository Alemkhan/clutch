import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_SOLO_RUN_CONDITIONS,
  PRACTICE_LEVELS,
  SOLO_ROUND_CAP,
  generateMatch,
  type CompleteSoloRunResponse,
  type Opponent,
} from '@clutch/shared';
import { SoloRunScreen, toSoloCategory } from './SoloRun';
import {
  applyLoadedSoloRun,
  beginSoloLoading,
  createSoloFlowState,
  failSoloLoading,
  startSoloPlay,
  type SoloFlowState,
} from './soloRunFlow';
import { applySoloSessionRound, createSoloRunSession } from './soloRunSession';
import type { SoloSaveState } from './useSoloRun';

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
  onMyRuns: vi.fn(),
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
    runId: 'run-1', questions, pace: opponent, config, miniGameId: 'hammer_nail', bankExhausted: false,
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

  it('explains nothing about a rival or pace before the start', () => {
    for (const rival of [null, pace([25])]) {
      const html = render(playing(rival, 'ready'));
      expect(html).not.toMatch(/[Тт]емп|на полосе|не завершает|Alex|Бот/);
      expect(html).toContain('Начать');
    }
  });
});

describe('solo run as practice against a bot', () => {
  const level = PRACTICE_LEVELS[1];
  const renderPractice = (state: SoloFlowState) => renderToStaticMarkup(
    <SoloRunScreen state={state} save={saving} {...handlers} practice={level} />,
  );

  it('says it is a practice, names the bot as a bot and does not count', () => {
    const html = renderPractice(playing(pace([12], 'Max'), 'ready'));
    expect(html).toContain('Тренировка · Любитель');
    expect(html).toContain('Бот Max');
    expect(html).toContain('Не засчитывается');
    expect(html).not.toMatch(/[Тт]емп|Соло-забег/);
  });

  it('draws the bot on the strip by its short name (the long label does not fit 360 px)', () => {
    const html = renderPractice(playing(pace([12, 12], 'Max'), 'question', [12]));
    expect(html).toContain('>Max<');
    expect(html).toContain('aria-valuenow="12"');
  });

  it('shows a short verdict instead of a saved achievement, whatever the save status', () => {
    const state = finished([25, 25, 25, 25], pace([25, 25, 25, 12, 25], 'Max'));
    for (const save of [saving, { status: 'error' as const, response: null, canRetry: true }]) {
      const html = renderToStaticMarkup(<SoloRunScreen state={state} save={save} {...handlers} practice={level} />);
      expect(html).toContain('Ты обошёл бота');
      expect(html).toContain('Тренировка · не засчитывается');
      expect(html).toContain('Ещё раз');
      expect(html).toContain('Другой уровень');
      expect(html).not.toMatch(/Сохраняем|зафиксирован|Мои партии|[Тт]емп/);
      expect(html).not.toContain('role="alert"');
    }
  });

  it('shows the loading and error states under the practice name', () => {
    expect(renderPractice(beginSoloLoading('geography'))).toContain('Тренировка');
    const error = renderPractice(failSoloLoading(beginSoloLoading('geography'), 'Нет сети'));
    expect(error).toContain('Тренировка');
    expect(error).toContain('Повторить');
  });
});

describe('solo run HUD while playing', () => {
  it('draws only the own progress and rounds left when there is no rival', () => {
    const html = render(playing(null, 'question', [10, 0]));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="10"');
    expect(html).toContain('Круг 3');
    expect(html).toContain(`осталось ${SOLO_ROUND_CAP - 2}`);
    expect(html).toContain('solo-hud-alone');
    expect(html).not.toContain('match-hud-competitor opponent');
    expect(html).not.toMatch(/[Тт]емп/);
  });

  it('draws the rival with avatar, name and bar: avatar, name and bar, without any explanation', () => {
    const html = render(playing(pace([25, 25]), 'question', [5, 5]));
    expect(html).toContain('match-hud-competitor opponent');
    expect(html).toContain('>A<');
    expect(html).toContain('>Alex<');
    expect(html).toContain('50%');
    expect(html).toContain('aria-valuenow="10"');
    expect(html).not.toContain('solo-hud-alone');
    expect(html).not.toMatch(/[Тт]емп|не завершает/);
  });

  it('keeps asking questions after the pace reached 100', () => {
    const html = render(playing(pace([25, 25, 25, 25]), 'question', [0, 0, 0, 0]));
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('question-screen');
    expect(html).toContain('Круг 5');
    expect(html).not.toContain('result-screen');
  });
});

describe('solo answer resolution', () => {
  it('distinguishes a wrong multiple-choice answer from the right one', () => {
    const state = playing(null, 'resolution');
    const [correctOption, selectedOption] = questions[0].options;
    const html = render({
      ...state,
      lastCorrect: false,
      selectedOption: selectedOption.id,
      correctAnswer: correctOption.text,
      explanation: 'Почему верен именно этот вариант.',
    });

    expect(html).toContain('Твой ответ');
    expect(html).toContain(selectedOption.text);
    expect(html).toContain('Правильный');
    expect(html).toContain(correctOption.text);
    expect(html).toContain('resolution-answer selected');
    expect(html).toContain('resolution-answer correct');
    expect(html.indexOf('Правильный')).toBeLessThan(html.indexOf('Почему верен'));
  });

  it('shows a correct multiple-choice answer once, without a duplicate selected row', () => {
    const state = playing(null, 'resolution');
    const correctOption = questions[0].options[0];
    const html = render({
      ...state,
      lastCorrect: true,
      selectedOption: correctOption.id,
      correctAnswer: correctOption.text,
      explanation: 'Пояснение.',
    });

    expect(html).toContain('Правильный');
    expect(html).not.toContain('Твой ответ');
    expect(html.match(/resolution-answer correct/g)).toHaveLength(1);
  });

  it('shows the canonical open answer and does not label the typed text as an MC choice', () => {
    const openQuestions = generateMatch(1, 1, 'geography');
    const loaded = applyLoadedSoloRun(beginSoloLoading('geography'), {
      runId: 'run-open', questions: openQuestions, pace: null, config, miniGameId: 'hammer_nail', bankExhausted: false,
    });
    const html = render({
      ...startSoloPlay(loaded),
      stage: 'resolution',
      lastCorrect: false,
      selectedOption: 'мой неточный ответ',
      correctAnswer: 'Сьюдад-де-ла-Пас',
      explanation: 'Каноническое написание.',
    });

    expect(html).toContain('Правильный');
    expect(html).toContain('Сьюдад-де-ла-Пас');
    expect(html).not.toContain('Твой ответ');
    expect(html).not.toContain('мой неточный ответ');
  });
});

describe('solo run result', () => {
  it('reached the target: the result is recorded, with two ways forward and no par or score', () => {
    const html = render(finished([25, 25, 25, 25]), saved({}));
    expect(html).toContain('Дошёл до 100%');
    expect(html).toContain('Твоя запись');
    expect(html).not.toContain('Результат зафиксирован');
    expect(html).toContain('Сыграть ещё');
    expect(html).toContain('Мои партии');
    expect(html).not.toMatch(/[Ээ]талон|0,80|par|score|Ничья|Ждём результата|solo-result-outcome/);
    expect(html).toContain('reached');
  });

  it('offers to call a friend only for a saved run that reached the target, never in practice', () => {
    expect(render(finished([25, 25, 25, 25]), saved({}))).toContain('Позвать друга');
    expect(render(finished([25, 25, 25, 25]))).not.toContain('Позвать друга');
    expect(render(finished([25, 25, 25, 25]), saved({ reachedTarget: false }))).not.toContain('Позвать друга');
    const practice = renderToStaticMarkup(
      <SoloRunScreen state={finished([25, 25, 25, 25], pace([25, 25, 25, 25]))} save={saved({})} practice={PRACTICE_LEVELS[0]} {...handlers} />,
    );
    expect(practice).toContain('Тренировка');
    expect(practice).not.toContain('Позвать друга');
  });

  it('does not reveal the rival outcome on this screen', () => {
    for (const outcome of [null, 'player', 'opponent', 'tie'] as const) {
      const html = render(finished([25, 25, 25, 25], pace([25, 25, 25, 25])), saved({ outcome }));
      expect(html).not.toMatch(/Ничья|Ждём|прошёл набор|лучше тебя|Alex/);
    }
  });

  it('did not reach the target: says so, shows the progress, no victory wording, same buttons', () => {
    const awards = new Array<number>(SOLO_ROUND_CAP).fill(2);
    const html = render(finished(awards), { ...saving });
    expect(html).toContain('До 100% не дошёл');
    expect(html).toContain('40% из 100%');
    expect(html).toContain('not-reached');
    expect(html).toContain('Сыграть ещё');
    expect(html).toContain('Мои партии');
    expect(html).not.toMatch(/Дошёл до 100|Клатч|Эталон|зафиксирован/);
  });

  it('keeps the buttons off while saving and shows a failed save with retry', () => {
    const pending = render(finished([25, 25, 25, 25]));
    expect(pending).toContain('Сохраняем результат');
    expect(pending.match(/disabled=""/g)?.length).toBe(2);
    const html = render(finished([25, 25, 25, 25]), {
      status: 'error', response: null, error: 'Не удалось сохранить результат.', canRetry: true,
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('зафиксирован');
  });

  it('does not render a question after the run is closed', () => {
    expect(render(finished([25, 25, 25, 25]))).not.toContain('question-screen');
  });
});

describe('problem report on the resolution', () => {
  it('offers the report when SoloRun wired it, and not otherwise', () => {
    const state = playing(null, 'resolution');
    const wired = renderToStaticMarkup(
      <SoloRunScreen state={state} save={saving} {...handlers} onReport={vi.fn()} reportState="idle" />,
    );
    expect(wired).toContain('Сообщить о проблеме');
    expect(render(state)).not.toContain('Сообщить о проблеме');
  });

  it('mirrors the parent status: sent hides the form, error offers a retry', () => {
    const state = playing(null, 'resolution');
    const sent = renderToStaticMarkup(
      <SoloRunScreen state={state} save={saving} {...handlers} onReport={vi.fn()} reportState="sent" />,
    );
    expect(sent).toContain('Отправлено, спасибо');
    const failed = renderToStaticMarkup(
      <SoloRunScreen state={state} save={saving} {...handlers} onReport={vi.fn()} reportState="error" />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Повторить');
  });
});

describe('toSoloCategory', () => {
  it('keeps the four categories and falls back to general for anything else', () => {
    for (const id of ['general', 'geography', 'history', 'languages']) expect(toSoloCategory(id)).toBe(id);
    for (const junk of ['', 'sports', 'science', 'GENERAL', '__proto__']) expect(toSoloCategory(junk)).toBe('general');
  });

  it('starts a fresh flow in general', () => {
    expect(createSoloFlowState().category).toBe('general');
  });
});
