import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateQuestionById, toPublicQuestion } from '@clutch/shared';
import { Training, TRAINING_NOT_SAVED_NOTE } from './Training';
import { HomeDashboard } from '../home/HomeDashboard';
import { BottomNav, navTabForPhase } from '../../ui/BottomNav';
import { TrainingMenu } from './TrainingHub';
import {
  applyTrainingVerdict,
  beginTrainingAnswer,
  continueTraining,
  createTrainingState,
  failTrainingCheck,
  retryTrainingCheck,
  trainingAnswerText,
} from './trainingSession';

const handlers = { onBack: vi.fn(), check: vi.fn() };
const publicQuestion = (id: string) => toPublicQuestion(generateQuestionById(id)!);

function homeHandlers() {
  return { onSolo: vi.fn(), onBoard: vi.fn(), onTiebreaker: vi.fn(), onWikiPath: vi.fn() };
}

describe('Training screens', () => {
  beforeEach(() => vi.stubGlobal('localStorage', {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  }));
  afterEach(() => vi.unstubAllGlobals());

  it('shows an honest empty state without invented questions', () => {
    const html = renderToStaticMarkup(<Training {...handlers} questions={[]} />);
    expect(html).toContain('Пока здесь пусто');
    expect(html).toContain('наполняется');
    expect(html).toContain(TRAINING_NOT_SAVED_NOTE);
    expect(html).not.toContain('question-prompt');
  });

  it('shows the question without opponent, hammer or rewards, and says nothing is saved', () => {
    const question = publicQuestion('capital_li');
    const html = renderToStaticMarkup(<Training {...handlers} questions={[question]} />);
    expect(html).toContain('Тренировка · 1 из 1');
    expect(html).toContain(TRAINING_NOT_SAVED_NOTE);
    expect(html).not.toMatch(/молот|hammer|match-hud|VS|Найти соперника/i);
  });

  it('the bottom nav offers all four sections, marks the active one and hides during the game', () => {
    const html = renderToStaticMarkup(<BottomNav active="training" onSelect={vi.fn()} />);
    for (const label of ['Главная', 'Партии', 'Тренировка', 'Профиль']) expect(html).toContain(label);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).not.toMatch(/Рейтинг|Ranked|Лига/);
    for (const phase of ['home', 'myRuns', 'training', 'profile'] as const) expect(navTabForPhase(phase)).toBe(phase);
    for (const phase of ['lastStand', 'solo'] as const) {
      expect(navTabForPhase(phase)).toBeNull();
    }
  });

  it('the training menu offers bots and the mistake log, and shows an empty mistake list', () => {
    const html = renderToStaticMarkup(
      <TrainingMenu summary={{ status: 'ready', count: 0, ids: [] }} onBots={vi.fn()} onMistakes={vi.fn()} />,
    );
    expect(html).toContain('Игра против ботов');
    expect(html).toContain('Отработка ошибок');
    expect(html).toContain('Пока нет ошибок');
    expect(html).not.toMatch(/[Тт]емп/);
  });

  it('home dashboard has one main action, and it starts the run of the day', () => {
    const html = renderToStaticMarkup(<HomeDashboard {...homeHandlers()} />);
    expect(html).toMatch(/class="cta-btn"[^>]*>Забег дня/);
    expect(html).not.toMatch(/гонк|обгони|первым|race|Мои партии|Найти соперника|Забег до 100|[Тт]емп|Видео|Челлендж|челлендж|Robb|Смотреть клип|10 вопросов|Точность решает/);
    // Единственная большая кнопка экрана; её обработчик в App — запуск соло-забега.
    expect(html.match(/class="cta-btn"/g)).toHaveLength(1);
  });

  it('home dashboard neither advertises Last Stand nor fetches its leaderboard', () => {
    const html = renderToStaticMarkup(<HomeDashboard {...homeHandlers()} />);
    expect(html).not.toMatch(/Last Stand|ls-home|не совпадай с соперником|До 12 кругов/);

    const source = readFileSync(new URL('../home/HomeDashboard.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('fetchLastStandLeaderboard');
  });

  it('wires the mistake-training report (mode training, no run) and its start event in the hub', () => {
    // Сеть остаётся в TrainingHub: экран Training получает репорт инъекцией и без него кнопки не рисует.
    const hub = readFileSync(new URL('./TrainingHub.tsx', import.meta.url), 'utf8');
    expect(hub).toContain("mode: 'training'");
    expect(hub).toContain("logAnalyticsEvent('training_started'");
    const html = renderToStaticMarkup(<Training {...handlers} questions={[publicQuestion('capital_li')]} />);
    expect(html).not.toContain('Сообщить о проблеме');
  });
});

describe('training session transitions', () => {
  const verdict = (correct: boolean) => ({ correct, correctText: 'Тбилиси', explanation: 'Пояснение.' });

  it('waits for the server verdict, then walks question, resolution and done', () => {
    const questions = [publicQuestion('lang_ka'), publicQuestion('capital_li')];
    let state = createTrainingState(questions);
    state = beginTrainingAnswer(state, questions[0].options[0].id);
    // Верность решает сервер: пока вердикта нет, клиент ничего не засчитывает.
    expect(state).toMatchObject({
      step: 'checking', correctCount: 0, lastCorrect: false, correctAnswer: '', explanation: '',
    });
    state = applyTrainingVerdict(state, verdict(true));
    expect(state).toMatchObject({
      step: 'resolution', lastCorrect: true, correctAnswer: 'Тбилиси', correctCount: 1, explanation: 'Пояснение.',
    });
    state = continueTraining(state);
    expect(state).toMatchObject({ step: 'question', index: 1, correctAnswer: '', explanation: '' });
    state = applyTrainingVerdict(beginTrainingAnswer(state, '__timeout__'), verdict(false));
    expect(state.lastCorrect).toBe(false);
    state = continueTraining(state);
    expect(state.step).toBe('done');
    expect(state.correctCount).toBe(1);
  });

  it('keeps the answer when the check does not reach the server and can send it again', () => {
    const questions = [publicQuestion('capital_li')];
    const checking = beginTrainingAnswer(createTrainingState(questions), questions[0].options[1].id);
    const failed = failTrainingCheck(checking);
    expect(failed).toMatchObject({ step: 'checking', checkFailed: true, selectedOption: questions[0].options[1].id });
    expect(retryTrainingCheck(failed)).toMatchObject({ step: 'checking', checkFailed: false });
    // Вердикт не к месту (вопрос уже закрыт) ничего не меняет.
    const resolved = applyTrainingVerdict(checking, verdict(true));
    expect(applyTrainingVerdict(resolved, verdict(false))).toBe(resolved);
  });

  it('sends the option text, because the options are rebuilt on every request', () => {
    const choice = publicQuestion('capital_li');
    expect(trainingAnswerText(choice, choice.options[2].id)).toBe(choice.options[2].text);
    expect(trainingAnswerText(choice, '__timeout__')).toBe('');
    const open = publicQuestion('open_capital_li');
    expect(trainingAnswerText(open, 'Вадуц')).toBe('Вадуц');
  });

  it('keeps the first canonical answer for an open training question', () => {
    const question = publicQuestion('open_capital_li');
    const checking = beginTrainingAnswer(createTrainingState([question]), 'Вадуц');
    const resolved = applyTrainingVerdict(checking, {
      correct: true,
      correctAnswers: ['Вадуц', 'Vaduz'],
      explanation: 'Столица Лихтенштейна.',
    });
    expect(resolved.correctAnswer).toBe('Вадуц');
  });

  it('an empty list is done at once', () => {
    expect(createTrainingState([]).step).toBe('done');
  });
});
