import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TiebreakerAnsweredView, TiebreakerTodayResponse } from '@clutch/shared';
import { TiebreakerCardView, TiebreakerReminderView, answeredCardSubtitle } from './TiebreakerCard';
import { TiebreakerAnswerForm, TiebreakerScreenView } from './Tiebreaker';
import type { TiebreakerTodayState } from '../lib/useTiebreakerToday';
import {
  answersText, bucketSide, distributionAxisTicks, distributionBars, formatDayMonth, formatMultiplier, formatQuantity,
  formatQuantityBreakable, safeSourceUrl,
} from '../lib/tiebreakerView';

const question = { id: 'q1', number: 7, prompt: 'Сколько метров в самой высокой башне города?', cardPrompt: null, unit: 'м' };

// 5 ч 12 мин 40 с до конца суток.
const MS_LEFT = (5 * 3600 + 12 * 60 + 40) * 1000;

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
  today: { dateKey: '2026-10-15', question, answered: null, answersCount: 214, ...today },
});

describe('home card', () => {
  const html = (state: TiebreakerTodayState) => renderToStaticMarkup(<TiebreakerCardView state={state} msLeft={MS_LEFT} onOpen={vi.fn()} />);

  it('shows a quiet placeholder while loading', () => {
    expect(html({ status: 'loading' })).toContain('aria-busy="true"');
  });

  it('is absent when there is no question or the request failed', () => {
    expect(html(ready({ question: null }))).toBe('');
    expect(html({ status: 'error' })).toBe('');
  });

  it('shows number, countdown, question, answer count and an entry when not answered', () => {
    const out = html(ready({}));
    expect(out).toContain('#7');
    expect(out).toContain('ещё 5:12:40');
    expect(out).toContain('Сколько метров в самой высокой башне города?');
    expect(out).toContain('Ответили 214 · один ответ в день');
    expect(out).toContain('Ответить на глазок');
    // Таймер не объявляется скринридеру каждую секунду.
    expect(out).not.toContain('aria-live');
  });

  it('prefers the short card prompt and falls back to the full one', () => {
    const short = html(ready({ question: { ...question, cardPrompt: 'Коротко: сколько метров?' } }));
    expect(short).toContain('Коротко: сколько метров?');
    expect(short).not.toContain('в самой высокой башне города');
    expect(html(ready({}))).toContain('в самой высокой башне города');
  });

  it('shows only the one-answer rule when nobody has answered yet', () => {
    const out = html(ready({ answersCount: 0 }));
    expect(out).toContain('Один ответ в день');
    expect(out).not.toContain('Ответили');
  });

  it('shows number, multiplier, standing, next-question time and the day answer entry when answered', () => {
    const out = html(ready({ answered: answered() }));
    expect(out).toContain('На глазок #7');
    expect(out).toContain('×1,4');
    expect(out).toContain('Точнее 63% · следующий через 5:12');
    expect(out).toContain('Ответ дня');
    // До вскрытия правильного числа на главной нет и после ответа.
    expect(out).not.toContain('553');
    expect(out).not.toContain('Ответить на глазок');
  });

  it('drops the standing when there is no percentile, and says the best answer when it is', () => {
    expect(html(ready({ answered: answered({ percentile: null }) }))).toContain('Следующий через 5:12');
    expect(html(ready({ answered: answered({ percentile: null }) }))).not.toContain('Точнее');
    expect(answeredCardSubtitle(100, MS_LEFT)).toBe('Лучший ответ дня · следующий через 5:12');
    expect(answeredCardSubtitle(null, 59_000)).toBe('Следующий через 0:00');
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
  const screen = (state: TiebreakerTodayState, extra: Partial<Parameters<typeof TiebreakerScreenView>[0]> = {}) => renderToStaticMarkup(
    <TiebreakerScreenView
      state={state}
      guest={false}
      submitStatus="idle"
      msLeft={MS_LEFT}
      onBack={vi.fn()}
      onRetry={vi.fn()}
      onSubmit={vi.fn()}
      {...extra}
    />,
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
    expect(out).toContain('#7');
    expect(out).not.toContain('Правильный');
    expect(out).not.toContain('Твой промах');
    expect(out).not.toContain('Как ответили все');
  });

  it('starts the reveal with the big miss, then own and correct answer in one card, then the share action', () => {
    const out = screen(ready({ answered: answered() }));
    expect(out).toContain('Твой промах');
    expect(out).toContain('×1,4');
    expect(out).toContain('Точнее 63%');
    expect(out).toContain('Твой ответ');
    expect(out).toContain('Правильный');
    expect(out).toContain('553 м');
    expect(out).toContain('400 м');
    expect(out).toContain('15 октября');
    expect(out).toContain('Поделиться результатом');
    expect(out).toContain('Следующий вопрос');
    expect(out).toContain('5:12:40');
    expect(out).not.toContain('tb-form');
    expect(out.indexOf('Твой промах')).toBeLessThan(out.indexOf('Как ответили все'));
    expect(out.indexOf('Как ответили все')).toBeLessThan(out.indexOf('Следующий вопрос'));
    // Правильный ответ — строка той же карточки, а не отдельный блок.
    expect(out.match(/class="tb-compare-row"/g)).toHaveLength(2);
  });

  it('shows the source link and the data date', () => {
    const out = screen(ready({ answered: answered() }));
    expect(out).toContain('href="https://www.example.org/tower"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('Источник: example.org');
    expect(out).toContain('12.03.2026');
  });

  it('says the best answer of the day only for a strictly best percentile, and the usual wording otherwise', () => {
    const best = screen(ready({ answered: answered({ percentile: 100, multiplier: 1 }) }));
    expect(best).toContain('Лучший ответ дня');
    expect(best).toContain('tb-miss best');
    expect(best).not.toContain('Точнее 100%');
    const close = screen(ready({ answered: answered({ percentile: 99 }) }));
    expect(close).toContain('Точнее 99%');
    expect(close).not.toContain('Лучший ответ дня');
    expect(close).not.toContain('Ближе, чем');
  });

  it('omits the percentile when the server sent none and says why', () => {
    const out = screen(ready({ answered: answered({ percentile: null, totalAnswers: 3 }) }));
    expect(out).not.toContain('Точнее');
    expect(out).not.toContain('Лучший ответ дня');
    expect(out).toContain('когда ответят 10');
    expect(out).toContain('3 ответа');
  });

  it('draws 12 bars, highlights only the own bucket, colours the sides and shows the legend', () => {
    const out = screen(ready({ answered: answered() }));
    expect(out.match(/class="tb-bar (?:under|over)(?: mine)?"/g)).toHaveLength(12);
    expect(out.match(/class="tb-bar under mine"/g)).toHaveLength(1);
    expect(out.match(/class="tb-bar under"/g)).toHaveLength(5);
    expect(out.match(/class="tb-bar over"/g)).toHaveLength(6);
    expect(out).toContain('занизили');
    expect(out).toContain('завысили');
    expect(out).toContain('10 ответов');
    expect(out).toContain('role="img"');
  });

  it('labels the axis from the bucket scale constants, not from hardcoded text', () => {
    expect(distributionAxisTicks().map((tick) => tick.label)).toEqual(['÷1000', '÷100', '÷10', 'точно', '×10', '×100', '×1000']);
    expect(distributionAxisTicks().map((tick) => tick.position)).toEqual([0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1]);
    const out = screen(ready({ answered: answered() }));
    for (const label of ['÷1000', '÷100', '÷10', 'точно', '×10', '×100', '×1000']) expect(out).toContain(`>${label}</span>`);
    // Деления стоят на границах корзин: «точно» — ровно между 5-й и 6-й корзинами.
    expect(bucketSide(5)).toBe('under');
    expect(bucketSide(6)).toBe('over');
  });

  it('renders an almost empty distribution without breaking', () => {
    const out = screen(ready({ answered: answered({ distribution: buckets({ 5: 1 }), totalAnswers: 1, percentile: null }) }));
    expect(out.match(/class="tb-bar under mine"/g)).toHaveLength(1);
    expect(out).toContain('1 ответ');
  });

  it('confirms a copied result and reports a failed share', () => {
    expect(screen(ready({ answered: answered() }), { shareStatus: 'copied' })).toContain('Скопировано');
    expect(screen(ready({ answered: answered() }), { shareStatus: 'failed' })).toContain('Не удалось поделиться');
    const idle = screen(ready({ answered: answered() }));
    expect(idle).not.toContain('Скопировано');
    expect(idle).not.toContain('Не удалось поделиться');
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

describe('reveal helpers and layout rules', () => {
  it('formats the day, the answer count and a breakable quantity', () => {
    expect(formatDayMonth('2026-10-16')).toBe('16 октября');
    expect(formatDayMonth('2026-03-01')).toBe('1 марта');
    expect(formatDayMonth('вчера')).toBe('вчера');
    expect([1, 2, 5, 11, 21, 214].map(answersText)).toEqual(['1 ответ', '2 ответа', '5 ответов', '11 ответов', '21 ответ', '214 ответов']);
    // Между числом и единицей обычный пробел: длинная единица переносится по словам, а тысячи не рвутся.
    expect(formatQuantityBreakable(78000, 'контейнеров')).toMatch(/^78 000 контейнеров$/);
    expect(formatQuantityBreakable(5, '')).toBe('5');
  });

  it('wraps long units by words, not in the middle of a word', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    const rule = /.tb-compare dd {([^}]*)}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('overflow-wrap: break-word');
    expect(rule).not.toContain('anywhere');
  });

  it('keeps the two histogram side colours as tokens next to the palette', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/:root {[^}]*--tb-under: #8fa6ee;[^}]*--tb-over: #e8be5a;/);
  });
});

describe('explanation block', () => {
  const screen = (a: TiebreakerAnsweredView, open = false) => renderToStaticMarkup(
    <TiebreakerScreenView
      state={ready({ answered: a })}
      guest={false}
      submitStatus="idle"
      msLeft={MS_LEFT}
      explanationOpen={open}
      onBack={vi.fn()}
      onRetry={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  const explanation = {
    steps: [
      { label: 'Полей в здании', value: 1400, unit: 'полей', sourceUrl: 'https://example.org/fields', sourceTitle: 'Каталог полей', asOf: '2025' },
      { label: 'Деталей на поле', value: 2000.5, unit: '', sourceUrl: 'javascript:alert(1)', sourceTitle: 'Спецификация' },
    ],
    summary: '≈ 1 400 полей × 2 000 деталей',
  };

  it('is collapsed by default: a labelled toggle with the step count and summary, no steps', () => {
    const out = screen(answered({ explanation }));
    expect(out).toContain('Как прикинуть');
    expect(out).toMatch(/<button[^>]*class="tb-explain-toggle"[^>]*aria-expanded="false"/);
    expect(out).toContain('2 шага · ≈ 1 400 полей × 2 000 деталей');
    expect(out).not.toContain('tb-steps');
    expect(out).not.toContain('Полей в здании');
    expect(out).not.toContain('Каталог полей');
  });

  it('shows numbered steps with Russian numbers, source links and the summary when expanded', () => {
    const out = screen(answered({ explanation }), true);
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-controls="tb-explain-body"');
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
    const out = screen(answered({ explanation }), true);
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
