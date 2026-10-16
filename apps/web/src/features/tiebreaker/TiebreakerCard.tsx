import { useTiebreakerToday, type TiebreakerTodayState } from './useTiebreakerToday';
import { formatCountdownClock, formatCountdownShort } from './tiebreakerClock';
import { formatMultiplier, formatTiebreakerNumber, standingText } from './tiebreakerView';

interface TiebreakerCardViewProps {
  state: TiebreakerTodayState;
  /** Сколько осталось до конца игровых суток, мс; тикает снаружи (один интервал на экран). */
  msLeft: number;
  onOpen: () => void;
}

/** «Точнее 80% · следующий через 5:12»; без перцентиля — «Следующий через 5:12». */
export function answeredCardSubtitle(percentile: number | null, msLeft: number): string {
  const parts = [standingText(percentile), `следующий через ${formatCountdownShort(msLeft)}`].filter(Boolean) as string[];
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Карточка «На глазок» на главной. Нет вопроса или ошибка сети — карточки нет совсем: главную
 * она ломать не должна, а повторять запрос тут некому и незачем. Таймер — обычный текст без
 * aria-live: скринридер не должен читать его каждую секунду.
 */
export function TiebreakerCardView({ state, msLeft, onOpen }: TiebreakerCardViewProps) {
  if (state.status === 'error') return null;

  if (state.status === 'loading') {
    return (
      <section className="tb-card tb-card-loading" aria-busy="true" aria-label="На глазок">
        <span className="tb-card-title">На глазок</span>
        <span className="tb-card-skeleton" aria-hidden="true" />
      </section>
    );
  }

  const { question, answered, answersCount } = state.today;
  if (!question) return null;

  if (answered) {
    return (
      <section className="tb-card tb-card-done" aria-label="На глазок">
        <div className="tb-card-done-text">
          <h2 className="tb-card-done-title">
            На глазок #{question.number} · <span className="tb-card-mult">{formatMultiplier(answered.multiplier)}</span>
          </h2>
          <p className="tb-card-meta">{answeredCardSubtitle(answered.percentile, msLeft)}</p>
        </div>
        <button type="button" className="tb-card-open" onClick={() => { onOpen(); }}>
          Ответ дня
        </button>
      </section>
    );
  }

  return (
    <section className="tb-card" aria-label="На глазок">
      <div className="tb-card-head">
        <h2 className="tb-card-title">
          На глазок <span className="tb-num">#{question.number}</span>
        </h2>
        <span className="tb-card-timer">ещё {formatCountdownClock(msLeft)}</span>
      </div>
      <p className="tb-card-prompt">{question.cardPrompt ?? question.prompt}</p>
      <p className="tb-card-meta">
        {answersCount > 0 ? `Ответили ${formatTiebreakerNumber(answersCount)} · один ответ в день` : 'Один ответ в день'}
      </p>
      <button type="button" className="tb-card-btn" onClick={() => { onOpen(); }}>
        Ответить на глазок
      </button>
    </section>
  );
}

interface TiebreakerReminderViewProps {
  state: TiebreakerTodayState;
  onOpen: () => void;
}

/** Напоминание на экране готовности забега: только если вопрос есть и игрок ещё не ответил. Не модальное. */
export function TiebreakerReminderView({ state, onOpen }: TiebreakerReminderViewProps) {
  if (state.status !== 'ready' || !state.today.question || state.today.answered) return null;
  return (
    <p className="tb-reminder">
      <button type="button" className="tb-reminder-link" onClick={() => { onOpen(); }}>
        Ответь на «На глазок»
      </button>
      {' '}— она решает ничьи сегодня.
    </p>
  );
}

export function TiebreakerReminder({ onOpen }: { onOpen: () => void }) {
  const { state } = useTiebreakerToday();
  return <TiebreakerReminderView state={state} onOpen={onOpen} />;
}
