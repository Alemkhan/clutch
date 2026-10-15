import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TiebreakerAnsweredView, TiebreakerTodayResponse } from '@clutch/shared';
import { TiebreakerCardView, TiebreakerReminderView } from './TiebreakerCard';
import { TiebreakerAnswerForm, TiebreakerScreenView } from './Tiebreaker';
import type { TiebreakerTodayState } from '../lib/useTiebreakerToday';
import { distributionBars, formatMultiplier, formatQuantity, safeSourceUrl } from '../lib/tiebreakerView';

const question = { id: 'q1', prompt: 'Сколько метров в самой высокой башне города?', unit: 'м' };

function buckets(counts: Record<number, number>): number[] {
  return Array.from({ length: 12 }, (_, index) => counts[index] ?? 0);
}

function answered(overrides: Partial<TiebreakerAnsweredView> = {}): TiebreakerAnsweredView {
  return {
    guess: 400, multiplier: 1.4, answer: 553, sourceUrl: 'https://www.example.org/tower', asOfDate: '2026-03-12',
    distribution: buckets({ 5: 3, 6: 7 }), totalAnswers: 10, percentile: 63, explanation: null, ...overrides,
  };
}

const ready = (today: Partial<TiebreakerTodayResponse>): TiebreakerTodayState => ({
  status: 'ready',
  today: { dateKey: '2026-10-15', question, answered: null, ...today },
});

describe('home card', () => {
  const html = (state: TiebreakerTodayState) => renderToStaticMarkup(<TiebreakerCardView state={state} onOpen={vi.fn()} />);

  it('shows a quiet placeholder while loading', () => {
    expect(html({ status: 'loading' })).toContain('aria-busy="true"');
  });

  it('is absent when there is no question or the request failed', () => {
    expect(html(ready({ question: null }))).toBe('');
    expect(html({ status: 'error' })).toBe('');
  });

  it('shows the question and an entry when not answered', () => {
    const out = html(ready({}));
    expect(out).toContain('Сколько метров в самой высокой башне города?');
    expect(out).toContain('Ответить на глазок');
  });

  it('shows only the own multiplier and an entry to the reveal when answered', () => {
    const out = html(ready({ answered: answered() }));
    expect(out).toContain('×1,4');
    expect(out).toContain('Посмотреть ответ');
    expect(out).not.toContain('553');
  });
});

describe('reminder before the run', () => {
  const html = (state: TiebreakerTodayState) => renderToStaticMarkup(<TiebreakerReminderView state={state} onOpen={vi.fn()} />);

  it('shows a non-blocking line only for an unanswered question', () => {
    const out = html(ready({}));
    expect(out).toContain('Ответь на «На глазок»');
    expect(out).toContain('решает ничьи сегодня');
    expect(out).not.toContain('role="dialog"');
    expect(html(ready({ answered: answered() }))).toBe('');
    expect(html(ready({ question: null }))).toBe('');
    expect(html({ status: 'loading' })).toBe('');
    expect(html({ status: 'error' })).toBe('');
  });
});

describe('answer form', () => {
  const form = (props: Partial<Parameters<typeof TiebreakerAnswerForm>[0]> = {}) => renderToStaticMarkup(
    <TiebreakerAnswerForm question={question} guest={false} status="idle" onSubmit={vi.fn()} {...props} />,
  );

  it('has a labelled decimal field and a disabled button while empty or invalid', () => {
    const empty = form();
    expect(empty).toContain('<label class="tb-label" for="tb-guess">');
    expect(empty).toContain('inputMode="decimal"');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Ответить<\/button>/);

    const bad = form({ initialText: 'абв' });
    expect(bad).toMatch(/<button[^>]*disabled=""[^>]*>Ответить<\/button>/);
    expect(bad).toContain('Введи число');
    expect(bad).toContain('aria-invalid="true"');
  });

  it('enables the button for a valid number', () => {
    const out = form({ initialText: '1,5 млн' });
    expect(out).toMatch(/<button(?![^>]*disabled)[^>]*class="cta-btn"[^>]*>Ответить<\/button>/);
    expect(out).not.toContain('Введи число');
  });

  it('asks to confirm with the parsed value and says the answer cannot be changed', () => {
    const out = form({ initialText: '1,5 млн', initialConfirm: true });
    expect(out).toContain('Ответ нельзя изменить');
    expect(out).toContain('1 500 000 м');
    expect(out).toContain('Отправить ответ');
  });

  it('locks the confirm button while sending', () => {
    const out = form({ initialText: '5', initialConfirm: true, status: 'sending' });
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Отправляем…<\/button>/);
  });

  it('shows retryable, stale and rejected notices', () => {
    expect(form({ initialText: '5', initialConfirm: true, status: 'network' })).toContain('Ответ не потерян');
    expect(form({ status: 'stale' })).toContain('Вопрос дня сменился');
    expect(form({ initialText: '5', status: 'rejected' })).toContain('Сервер не принял');
  });

  it('tells a browser guest that only Telegram answers break ties, and a Telegram user nothing', () => {
    expect(form({ guest: true })).toContain('только ответ из Telegram');
    expect(form({ guest: false })).not.toContain('только ответ из Telegram');
  });
});

describe('screen and reveal', () => {
  const screen = (state: TiebreakerTodayState) => renderToStaticMarkup(
    <TiebreakerScreenView state={state} guest={false} submitStatus="idle" onBack={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />,
  );

  it('handles loading, error with retry and a missing question', () => {
    expect(screen({ status: 'loading' })).toContain('Загружаем вопрос');
    const failed = screen({ status: 'error' });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Повторить');
    expect(screen(ready({ question: null }))).toContain('вопроса нет');
  });

  it('shows the question text in full with the form before answering, with no answer data', () => {
    const out = screen(ready({}));
    expect(out).toContain(question.prompt);
    expect(out).toContain('tb-form');
    expect(out).not.toContain('Правильный ответ');
  });

  it('reveals the answer, source, date, own guess, multiplier and percentile', () => {
    const out = screen(ready({ answered: answered() }));
    expect(out).toContain('Правильный ответ');
    expect(out).toContain('553 м');
    expect(out).toContain('href="https://www.example.org/tower"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('example.org');
    expect(out).toContain('12.03.2026');
    expect(out).toContain('400 м');
    expect(out).toContain('×1,4');
    expect(out).toContain('Ближе, чем 63% игроков');
    expect(out).not.toContain('tb-form');
  });

  it('omits the percentile when the server sent none and says why', () => {
    const out = screen(ready({ answered: answered({ percentile: null, totalAnswers: 3 }) }));
    expect(out).not.toContain('Ближе, чем');
    expect(out).toContain('когда ответят 10');
  });

  it('draws 12 bars, highlights only the own bucket, and labels the axis', () => {
    const out = screen(ready({ answered: answered() }));
    expect(out.match(/class="tb-bar(?: mine)?"/g)).toHaveLength(12);
    expect(out.match(/class="tb-bar mine"/g)).toHaveLength(1);
    expect(out).toContain('меньше в 1000 раз');
    expect(out).toContain('точно');
    expect(out).toContain('больше в 1000 раз');
    expect(out).toContain('role="img"');
  });

  it('renders an almost empty distribution without breaking', () => {
    const out = screen(ready({ answered: answered({ distribution: buckets({ 5: 1 }), totalAnswers: 1, percentile: null }) }));
    expect(out.match(/class="tb-bar mine"/g)).toHaveLength(1);
  });

  it('refuses a non-http source link', () => {
    expect(safeSourceUrl('javascript:alert(1)')).toBeNull();
    const out = screen(ready({ answered: answered({ sourceUrl: 'javascript:alert(1)' }) }));
    expect(out).not.toContain('href="javascript');
  });
});

describe('view helpers', () => {
  it('puts the own guess in the bucket by guess/answer ratio', () => {
    // 400/553 ≈ 0.72 → log10 ≈ -0.14 → индекс 5; точный ответ — индекс 6.
    const base = answered();
    expect(distributionBars(base).find((bar) => bar.mine)?.index).toBe(5);
    expect(distributionBars({ ...base, guess: 553 }).find((bar) => bar.mine)?.index).toBe(6);
    expect(distributionBars({ ...base, guess: 1e30 }).find((bar) => bar.mine)?.index).toBe(11);
  });

  it('formats multipliers with a comma and one decimal', () => {
    expect(formatMultiplier(1)).toBe('×1,0');
    expect(formatMultiplier(2.84)).toBe('×2,8');
    expect(formatMultiplier(1234.56)).toBe('×1 234,6');
    expect(formatMultiplier(1.2e9)).toBe('×1,2×10⁹');
    expect(formatQuantity(1500, 'м')).toBe('1 500 м');
  });
});

describe('explanation block', () => {
  const screen = (a: TiebreakerAnsweredView) => renderToStaticMarkup(
    <TiebreakerScreenView state={ready({ answered: a })} guest={false} submitStatus="idle" onBack={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />,
  );
  const explanation = {
    steps: [
      { label: 'Полей в здании', value: 1400, unit: 'полей', sourceUrl: 'https://example.org/fields', sourceTitle: 'Каталог полей', asOf: '2025' },
      { label: 'Деталей на поле', value: 2000.5, unit: '', sourceUrl: 'javascript:alert(1)', sourceTitle: 'Спецификация' },
    ],
    summary: '≈ 1 400 полей × 2 000 деталей',
  };

  it('shows numbered steps with Russian numbers, source links and the summary', () => {
    const out = screen(answered({ explanation }));
    expect(out).toContain('Как прикинуть');
    expect(out).toContain('<ol class="tb-steps">');
    expect(out).toContain('Полей в здании');
    expect(out).toContain(formatQuantity(1400, 'полей'));
    expect(out).toContain('2 000,5'.replace(' ', formatQuantity(1000, '')[1]));
    expect(out).toContain('href="https://example.org/fields"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('Каталог полей');
    expect(out).toContain('≈ 1 400 полей × 2 000 деталей');
  });

  it('renders a non-http(s) source as plain text, never as a link', () => {
    const out = screen(answered({ explanation }));
    expect(out).toContain('Спецификация');
    expect(out).not.toContain('javascript:');
  });

  it('is absent when the explanation is missing and never shown before answering', () => {
    expect(screen(answered({ explanation: null }))).not.toContain('Как прикинуть');
    const before = renderToStaticMarkup(
      <TiebreakerScreenView state={ready({})} guest={false} submitStatus="idle" onBack={vi.fn()} onRetry={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(before).not.toContain('Как прикинуть');
  });
});
