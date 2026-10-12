import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateQuestionById } from '@clutch/shared';
import { Training, TRAINING_NOT_SAVED_NOTE } from './Training';
import { HomeDashboard } from './HomeDashboard';
import { BottomNav, navTabForPhase } from './BottomNav';
import { TrainingHub } from './TrainingHub';
import {
  answerTraining,
  buildTrainingQuestions,
  continueTraining,
  createTrainingState,
} from '../lib/trainingSession';

const handlers = { onAnswered: vi.fn(), onBack: vi.fn() };

function homeHandlers() {
  return { onLastStand: vi.fn(), onSolo: vi.fn() };
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
    const question = generateQuestionById('capital_li')!;
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
    for (const phase of ['categories', 'matchmaking', 'question', 'resolution', 'hammer', 'result', 'lastStand', 'solo'] as const) {
      expect(navTabForPhase(phase)).toBeNull();
    }
  });

  it('the training hub offers bots and the mistake log, and shows an empty mistake list', () => {
    const html = renderToStaticMarkup(
      <TrainingHub questions={[]} onAnswered={vi.fn()} onStartBot={vi.fn()} onBack={vi.fn()} />,
    );
    expect(html).toContain('Игра против ботов');
    expect(html).toContain('Отработка ошибок');
    expect(html).toContain('Пока нет ошибок');
    expect(html).not.toMatch(/[Тт]емп/);
  });

  it('home dashboard has one main action, and it starts the solo run', () => {
    const html = renderToStaticMarkup(<HomeDashboard {...homeHandlers()} />);
    expect(html).toContain('Играть');
    expect(html).not.toMatch(/гонк|обгони|первым|race|Мои партии|Найти соперника|Забег до 100|[Тт]емп|Видео|Челлендж|челлендж|Robb|Смотреть клип|10 вопросов|Точность решает/);
    // Единственная большая кнопка экрана; её обработчик в App — запуск соло-забега.
    expect(html.match(/class="cta-btn"/g)).toHaveLength(1);
  });

  it('home dashboard renders the Last Stand card without a hook before any data arrives', () => {
    const html = renderToStaticMarkup(
      <HomeDashboard {...homeHandlers()} />,
    );
    expect(html).toContain('ls-home-card');
    expect(html).toContain('не совпадай с соперником');
    expect(html).toContain('aria-label="Last Stand: начать забег по категориям стран"');
    expect(html).toContain('До 12 кругов');
    expect(html).not.toContain('ls-home-hook');
    expect(html).not.toContain('Сегодня');
    expect(html).not.toContain('VS');
    expect(html.indexOf('home-hero-card')).toBeLessThan(html.indexOf('ls-home-card'));
  });
});

describe('training session transitions', () => {
  it('walks question, resolution and done, counting correct answers', () => {
    const questions = buildTrainingQuestions([
      { id: 'capital_li', category: 'geography', count: 1, lastAt: 1 },
      { id: 'lang_ka', category: 'languages', count: 2, lastAt: 1 },
    ]);
    expect(questions.map((q) => q.id)).toEqual(['lang_ka', 'capital_li']);
    let state = createTrainingState(questions);
    state = answerTraining(state, questions[0].correctOptionId);
    expect(state.step).toBe('resolution');
    expect(state.lastCorrect).toBe(true);
    state = continueTraining(state);
    state = answerTraining(state, '__timeout__');
    expect(state.lastCorrect).toBe(false);
    state = continueTraining(state);
    expect(state.step).toBe('done');
    expect(state.correctCount).toBe(1);
  });

  it('skips stored ids that cannot be rebuilt', () => {
    expect(buildTrainingQuestions([{ id: 'gone_xx', category: 'geography', count: 5, lastAt: 1 }])).toEqual([]);
  });
});
