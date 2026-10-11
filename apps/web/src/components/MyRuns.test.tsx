import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MyRematchInvite, MyRunSummary } from '@clutch/shared';
import { MyRunsView, type MyRunsState } from './MyRuns';

const NOW = new Date(2026, 9, 11, 15, 0).getTime();
const HOUR = 60 * 60 * 1000;

const handlers = {
  onBack: vi.fn(),
  onRetry: vi.fn(),
  onLoadMore: vi.fn(),
  onOpenInvite: vi.fn(),
  onPlay: vi.fn(),
};

function run(overrides: Partial<MyRunSummary> = {}): MyRunSummary {
  return {
    runId: 'r1', category: 'geography', mode: 'solo', roundsPlayed: 7, progress: 100, correctCount: 6,
    reachedTarget: true, setPar: 8, soloScore: 0.9, startedAt: NOW - HOUR, completedAt: NOW - HOUR,
    opponent: null, outcome: null, ...overrides,
  };
}

function invite(overrides: Partial<MyRematchInvite> = {}): MyRematchInvite {
  return {
    inviteId: 'rm_invite', category: 'languages', challengerName: 'Ann', challengerProgress: 100,
    yourProgress: 60, expiresAt: NOW + 5 * HOUR, ...overrides,
  };
}

function render(state: MyRunsState, extra: { loadingMore?: boolean; moreFailed?: boolean } = {}) {
  return renderToStaticMarkup(
    <MyRunsView state={state} loadingMore={false} moreFailed={false} now={NOW} {...extra} {...handlers} />,
  );
}

const ready = (runs: MyRunSummary[], invites: MyRematchInvite[] = [], nextCursor: string | null = null): MyRunsState => (
  { status: 'ready', runs, invites, nextCursor }
);

describe('my runs screen', () => {
  it('uses the shared header and shows loading with a way back', () => {
    const html = render({ status: 'loading' });
    expect(html).toContain('screen-header');
    expect(html).toContain('back-btn');
    expect(html).toContain('Мои партии');
    expect(html).toContain('role="status"');
  });

  it('shows an error with retry', () => {
    const html = render({ status: 'error' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Повторить');
  });

  it('shows an empty list with a way to play', () => {
    const html = render(ready([]));
    expect(html).toContain('Пока нет сыгранных партий');
    expect(html).toContain('Играть');
  });

  it('lists when, category and how each run ended, with waiting kept apart from a tie', () => {
    const rival = { kind: 'player', displayName: 'Ann' } as const;
    const html = render(ready([
      run({ runId: 'a' }),
      run({ runId: 'b', category: 'history', outcome: 'tie', opponent: rival }),
      run({ runId: 'c', category: 'languages', outcome: 'player', opponent: rival, completedAt: NOW - 30 * HOUR }),
      run({ runId: 'd', reachedTarget: false, progress: 64, roundsPlayed: 20 }),
    ]));
    expect(html).toContain('География');
    expect(html).toContain('Другие флаги');
    expect(html).toContain('Ждём соперника');
    expect(html).toContain('Ничья');
    expect(html).toContain('Победа');
    expect(html).toContain('Не дошёл до цели');
    expect(html).toContain('Сегодня, 14:00');
    expect(html).toContain('Вчера, 09:00');
    expect(html).toContain('против Ann');
    expect(html).not.toMatch(/[Тт]емп|эталон|score|par\b/);
  });

  it('shows active invites with the time left and opens them by id', () => {
    const html = render(ready([run()], [invite()]));
    expect(html).toContain('Ann зовёт на реванш');
    expect(html).toContain('Ещё 5 ч');
    expect(html).toContain('Языки · 100% против 60%');
    expect(html).toContain('my-run-invite');
  });

  it('hides an invite whose time has run out', () => {
    const html = render(ready([run()], [invite({ expiresAt: NOW - 1 })]));
    expect(html).not.toContain('зовёт на реванш');
    expect(html).not.toContain('Вызовы');
  });

  it('shows invites even when there are no runs yet', () => {
    const html = render(ready([], [invite()]));
    expect(html).toContain('зовёт на реванш');
    expect(html).toContain('Пока нет сыгранных партий');
  });

  it('survives long names and offers more only when there is a next page', () => {
    const long = 'Очень'.repeat(30);
    const html = render(ready(
      [run({ opponent: { kind: 'player', displayName: long }, outcome: 'opponent' })],
      [invite({ challengerName: long })],
      'cursor',
    ));
    expect(html).toContain(long);
    expect(html).toContain('Показать ещё');
    expect(render(ready([run()]))).not.toContain('Показать ещё');
    expect(render(ready([run()], [], 'cursor'), { moreFailed: true })).toContain('Не удалось загрузить остальное');
  });
});
