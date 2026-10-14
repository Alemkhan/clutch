import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileView, type ProfileState } from './Profile';

function render(state: ProfileState) {
  return renderToStaticMarkup(
    <ProfileView onBack={vi.fn()} playerName="Анна" state={state} onRetry={vi.fn()} />,
  );
}

describe('server-backed profile', () => {
  it('shows an accessible loading state without invented statistics', () => {
    const html = render({ status: 'loading' });
    expect(html).toContain('role="status"');
    expect(html).toContain('Загружаем статистику');
    expect(html).not.toContain('Винрейт');
  });

  it('shows a retryable error and keeps settings available', () => {
    const html = render({ status: 'error' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Повторить');
    expect(html).toContain('Настройки');
  });

  it('renders confirmed solo totals and best finish', () => {
    const html = render({
      status: 'ready',
      profile: { completedRuns: 7, reachedTargetRuns: 5, bestRounds: 4 },
    });
    expect(html).toContain('Подтверждённая статистика');
    expect(html).toContain('>7<');
    expect(html).toContain('>5<');
    expect(html).toContain('>4 круга<');
    expect(html).toContain('Лучший финиш');
    expect(html).not.toContain('Побед');
    expect(html).not.toContain('Достижения');
  });

  it('explains the empty state without presenting local data as saved', () => {
    const html = render({
      status: 'ready',
      profile: { completedRuns: 0, reachedTargetRuns: 0, bestRounds: null },
    });
    expect(html).toContain('Сыграй первый зачётный забег');
    expect(html).toContain('>—<');
    expect(html).not.toContain('этом устройстве');
  });
});
