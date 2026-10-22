import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WikiPathTodayResponse } from '@clutch/shared';
import { WikiPathCard } from './WikiPathCard';
import { allowedWikiTitles, approvedWikiLink, normalizeWikiTitle } from './wikiArticle';
import { followApprovedWikiLink, loadWikiPathTransition, WikiPathScreen } from './WikiPathScreen';
import type { WikiPathTodayState } from './useWikiPathToday';

const challenge = { id: 'day-1', date: '2026-10-21', startTitle: 'Абай Кунанбаев', targetTitle: 'Альберт Эйнштейн' };
const inProgress = { runId: 'run-1', challengeId: challenge.id, status: 'in_progress' as const, clicks: 2, path: ['1', '2', '3'], startedAt: 1, completedAt: null };
const completed = { ...inProgress, status: 'completed' as const, clicks: 4, completedAt: 100 };
const today = (run: WikiPathTodayResponse['run'] = null): WikiPathTodayResponse => ({ challenge, run });
const markup = (state: WikiPathTodayState) => renderToStaticMarkup(
  <WikiPathCard state={state} onOpen={vi.fn()} onRetry={vi.fn()} />,
);

describe('WikiPathCard', () => {
  it('shows a loading placeholder and hides absent routes', () => {
    expect(markup({ status: 'loading' })).toContain('aria-busy="true"');
    expect(markup({ status: 'absent' })).toBe('');
  });

  it('offers a retry when today could not be loaded', () => {
    expect(markup({ status: 'error' })).toContain('Повторить');
  });

  it('shows start, resume and completion states with the route', () => {
    expect(markup({ status: 'available', today: today() })).toContain('Начать');
    const active = markup({ status: 'in_progress', today: today(inProgress) });
    expect(active).toContain('Продолжить');
    expect(active).toContain('2 переходов');
    const done = markup({ status: 'completed', today: today(completed) });
    expect(done).toContain('Результаты');
    expect(done).toContain('Завершён');
    expect(done).toContain('Альберт Эйнштейн');
  });
});

describe('WikiPathScreen', () => {
  it('uses the shared nested-screen shell without nesting another main element', () => {
    const result = renderToStaticMarkup(
      <WikiPathScreen
        today={{ status: 'absent' }}
        onRetryToday={vi.fn()}
        onBack={vi.fn()}
        onCompleted={vi.fn()}
        onPageLoaded={vi.fn()}
      />,
    );

    expect(result).toContain('<section class="wp-screen">');
    expect(result).toContain('class="screen-header"');
    expect(result).toContain('class="back-btn"');
    expect(result).not.toContain('<main');
  });

  it('explains the route and daily attempt before starting or resuming', () => {
    const renderScreen = (status: 'available' | 'in_progress') => renderToStaticMarkup(
      <WikiPathScreen
        today={{ status, today: today(status === 'in_progress' ? inProgress : null) }}
        onRetryToday={vi.fn()}
        onBack={vi.fn()}
        onCompleted={vi.fn()}
        onPageLoaded={vi.fn()}
      />,
    );

    for (const status of ['available', 'in_progress'] as const) {
      const result = renderScreen(status);
      expect(result).toContain('Дана стартовая статья и цель');
      expect(result).toContain('наименьшим числом переходов');
      expect(result).toContain('только по ссылкам внутри текущей статьи');
      expect(result).toContain('Попытка одна в день');
      expect(result).toContain('её можно продолжить позже');
    }
  });

});

describe('wiki article link allowlist', () => {
  it('normalizes and matches only an approved article title', () => {
    const allowed = allowedWikiTitles([{ title: 'Ёлка_и   Новый_год' }]);
    expect(normalizeWikiTitle(' Ёлка_и Новый_год ')).toBe('Ёлка и Новый год');
    expect(approvedWikiLink('Елка_и_Новый_год', allowed)).toBe('Ёлка и Новый год');
    expect(approvedWikiLink('https://example.com', allowed)).toBeNull();
  });

  it('calls the server navigation callback only for an approved title', async () => {
    const allowed = allowedWikiTitles([{ title: 'Казахская литература' }]);
    const navigate = vi.fn(async () => undefined);
    expect(await followApprovedWikiLink('Казахская_литература', allowed, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('Казахская литература');
    expect(await followApprovedWikiLink('https://example.com', allowed, navigate)).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('scrolls the shell only after a transition succeeds; retry is the successful page change', async () => {
    const onPageLoaded = vi.fn();
    type TransitionResult = { run: { status: 'in_progress' }; currentPage: { title: string } };
    const request = vi.fn<() => Promise<TransitionResult>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ run: { status: 'in_progress' }, currentPage: { title: 'Новая статья' } });

    await expect(loadWikiPathTransition(request, () => onPageLoaded())).rejects.toThrow('network');
    expect(onPageLoaded).not.toHaveBeenCalled();

    const response = await loadWikiPathTransition(request, (result) => {
      if (result.run.status === 'in_progress') onPageLoaded();
    });
    expect(response.currentPage.title).toBe('Новая статья');
    expect(onPageLoaded).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
