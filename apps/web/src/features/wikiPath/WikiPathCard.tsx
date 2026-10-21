import type { WikiPathTodayState } from './useWikiPathToday';

export interface WikiPathCardProps {
  state: WikiPathTodayState;
  onOpen: () => void;
  onRetry: () => void;
}

export function WikiPathCard({ state, onOpen, onRetry }: WikiPathCardProps) {
  if (state.status === 'absent') return null;
  if (state.status === 'loading') {
    return <section className="wp-card wp-card-loading" aria-busy="true" aria-label="Вики-путь">
      <span className="wp-card-eyebrow">Режим дня</span><span className="wp-skeleton" aria-hidden="true" />
    </section>;
  }
  if (state.status === 'error') {
    return <section className="wp-card" aria-label="Вики-путь">
      <div><span className="wp-card-eyebrow">Режим дня</span><h2>Вики-путь</h2><p>Не удалось загрузить маршрут дня.</p></div>
      <button type="button" className="wp-card-action" onClick={onRetry}>Повторить</button>
    </section>;
  }

  const { challenge, run } = state.today;
  if (!challenge) return null;
  const status = state.status === 'completed'
    ? `Завершён · ${run?.clicks ?? 0} переходов`
    : state.status === 'in_progress'
      ? `В процессе · ${run?.clicks ?? 0} переходов`
      : 'Ежедневный маршрут по Wikipedia';
  const action = state.status === 'completed' ? 'Результаты' : state.status === 'in_progress' ? 'Продолжить' : 'Начать';

  return <section className="wp-card" aria-label="Вики-путь">
    <div className="wp-card-copy">
      <span className="wp-card-eyebrow">Режим дня</span>
      <h2>Вики-путь</h2>
      <p className="wp-card-route"><span>{challenge.startTitle}</span><span aria-hidden="true">→</span><span>{challenge.targetTitle}</span></p>
      <p className="wp-card-status">{status}</p>
    </div>
    <button type="button" className="wp-card-action" onClick={onOpen}>{action}<span aria-hidden="true"> →</span></button>
  </section>;
}
