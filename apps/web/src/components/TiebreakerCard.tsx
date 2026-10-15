import { useTiebreakerToday, type TiebreakerTodayState } from '../lib/useTiebreakerToday';
import { formatMultiplier } from '../lib/tiebreakerView';

interface TiebreakerCardViewProps {
  state: TiebreakerTodayState;
  onOpen: () => void;
}

/**
 * Карточка «На глазок» на главной. Нет вопроса или ошибка сети — карточки нет совсем: главную
 * она ломать не должна, а повторять запрос тут некому и незачем.
 */
export function TiebreakerCardView({ state, onOpen }: TiebreakerCardViewProps) {
  if (state.status === 'error') return null;

  if (state.status === 'loading') {
    return (
      <section className="tb-card tb-card-loading" aria-busy="true" aria-label="На глазок">
        <span className="tb-card-kicker">На глазок</span>
        <span className="tb-card-skeleton" aria-hidden="true" />
      </section>
    );
  }

  const { question, answered } = state.today;
  if (!question) return null;

  return (
    <section className="tb-card" aria-label="На глазок">
      <span className="tb-card-kicker">На глазок · вопрос дня</span>
      {answered ? (
        <>
          <p className="tb-card-text">
            Твой промах: <strong className="tb-card-mult">{formatMultiplier(answered.multiplier)}</strong>
          </p>
          <button type="button" className="ghost-btn tb-card-btn" onClick={() => { onOpen(); }}>
            Посмотреть ответ
          </button>
        </>
      ) : (
        <>
          <p className="tb-card-text tb-card-prompt">{question.prompt}</p>
          <button type="button" className="ghost-btn tb-card-btn" onClick={() => { onOpen(); }}>
            Ответить на глазок
          </button>
        </>
      )}
    </section>
  );
}

export function TiebreakerCard({ onOpen }: { onOpen: () => void }) {
  const { state } = useTiebreakerToday();
  return <TiebreakerCardView state={state} onOpen={onOpen} />;
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
