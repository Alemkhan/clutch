import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_LEVELS } from '@clutch/shared';
import { PracticeLevelList, TrainingMenu, type MistakeSummary } from './TrainingHub';

const noop = vi.fn();

describe('training hub', () => {
  beforeEach(() => vi.stubGlobal('localStorage', {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  }));
  afterEach(() => vi.unstubAllGlobals());

  const menu = (summary: MistakeSummary) => renderToStaticMarkup(
    <TrainingMenu summary={summary} onBots={noop} onMistakes={noop} onBack={noop} />,
  );

  it('shows two entries under the shared header and the server-reported mistake count', () => {
    const html = menu({ status: 'ready', count: 3, ids: ['capital_li'] });
    expect(html).toContain('screen-header');
    expect(html).toContain('Игра против ботов');
    expect(html).toContain('Отработка ошибок');
    expect(html).toContain('Ошибок накоплено: 3');
    expect(html).not.toMatch(/[Тт]емп/);
    expect(html).not.toContain('<p class="training-text"');
  });

  it('says honestly when there are no mistakes, while loading, and when the server is unreachable', () => {
    expect(menu({ status: 'ready', count: 0, ids: [] })).toContain('Пока нет ошибок');
    const loading = menu({ status: 'loading' });
    expect(loading).toContain('Загружаем');
    expect(loading).not.toContain('Пока нет ошибок');
    const failed = menu({ status: 'error' });
    expect(failed).toContain('Не удалось загрузить ошибки');
    expect(failed).not.toContain('Пока нет ошибок');
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
