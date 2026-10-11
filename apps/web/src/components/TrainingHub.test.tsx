import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_LEVELS, generateQuestionById } from '@clutch/shared';
import { PracticeLevelList, TrainingHub } from './TrainingHub';

const noop = vi.fn();

describe('training hub', () => {
  beforeEach(() => vi.stubGlobal('localStorage', {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  }));
  afterEach(() => vi.unstubAllGlobals());

  it('shows two entries under the shared header, and an honest empty mistake list', () => {
    const html = renderToStaticMarkup(
      <TrainingHub questions={[generateQuestionById('capital_li')!]} onAnswered={noop} onStartBot={noop} onBack={noop} />,
    );
    expect(html).toContain('screen-header');
    expect(html).toContain('Игра против ботов');
    expect(html).toContain('Отработка ошибок');
    expect(html).toContain('Пока нет ошибок');
    expect(html).not.toMatch(/[Тт]емп/);
    expect(html).not.toContain('<p class="training-text"');
  });

  it('lists every level with its short caption', () => {
    const html = renderToStaticMarkup(<PracticeLevelList onStartBot={noop} />);
    for (const level of PRACTICE_LEVELS) {
      expect(html).toContain(level.name);
      expect(html).toContain(level.caption);
    }
    expect(html).not.toMatch(/Alex|Dana|Max|Ira|clutch_bot|[Тт]емп/);
    expect(html).not.toContain('<p');
  });
});
