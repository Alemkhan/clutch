import type { WikiPathTodayState } from './useWikiPathToday';
import { useMessages } from '../../i18n/messages';
import { m } from './messages';

export interface WikiPathCardProps {
  state: WikiPathTodayState;
  onOpen: () => void;
  onRetry: () => void;
}

export function WikiPathCard({ state, onOpen, onRetry }: WikiPathCardProps) {
  const t = useMessages(m);
  if (state.status === 'absent') return null;
  if (state.status === 'loading') {
    return <section className="wp-card wp-card-loading" aria-busy="true" aria-label={t.mode}>
      <span className="wp-card-eyebrow">{t.modeOfDay}</span><span className="wp-skeleton" aria-hidden="true" />
    </section>;
  }
  if (state.status === 'error') {
    return <section className="wp-card" aria-label={t.mode}>
      <div><span className="wp-card-eyebrow">{t.modeOfDay}</span><h2>{t.mode}</h2><p>{t.loadRouteError}</p></div>
      <button type="button" className="wp-card-action" onClick={onRetry}>{t.retry}</button>
    </section>;
  }

  const { challenge, run } = state.today;
  if (!challenge) return null;
  const status = state.status === 'completed'
    ? t.completedClicks(run?.clicks ?? 0)
    : state.status === 'in_progress'
      ? t.inProgressClicks(run?.clicks ?? 0)
      : t.dailyRoute;
  const action = state.status === 'completed' ? t.results : state.status === 'in_progress' ? t.continue : t.start;

  return <section className="wp-card" aria-label={t.mode}>
    <div className="wp-card-copy">
      <span className="wp-card-eyebrow">{t.modeOfDay}</span>
      <h2>{t.mode}</h2>
      <p className="wp-card-route"><span>{challenge.startTitle}</span><span aria-hidden="true">→</span><span>{challenge.targetTitle}</span></p>
      <p className="wp-card-status">{status}</p>
    </div>
    <button type="button" className="wp-card-action" onClick={onOpen}>{action}<span aria-hidden="true"> →</span></button>
  </section>;
}
