import type { Opponent, Tournament } from '@clutch/shared';
import { MATCH_SOURCE_LABELS, type MatchSource, type MatchmakingStatus } from '../lib/matchmaking';

interface MatchmakingProps {
  opponent: Opponent;
  video?: Tournament['video'];
  status: MatchmakingStatus;
  source: MatchSource;
  abandonedNote?: string | null;
  error?: string;
  onStart: () => void;
  onRetry: () => void;
  onLocalPractice: () => void;
  onBack: () => void;
}

export function Matchmaking({
  opponent,
  video,
  status,
  source,
  abandonedNote,
  error,
  onStart,
  onRetry,
  onLocalPractice,
  onBack,
}: MatchmakingProps) {
  return (
    <section className="matchmaking">
      <button className="back-btn" onClick={onBack}>← Назад</button>
      {/* The body is centred on its own; keeping Back inside that flow pushed it off the top. */}
      <div className="matchmaking-body">
      <span className="matchmaking-eyebrow">Асинхронный матч</span>
      {status === 'loading' && (
        <>
          <h1 className="screen-title">Ищем соперника</h1>
          <div className="matchmaking-loading" role="status"><span /> Загружаем матч</div>
        </>
      )}
      {status === 'error' && (
        <>
          <h1 className="screen-title">Не удалось начать матч</h1>
          <p className="matchmaking-error" role="alert">{error}</p>
          <div className="matchmaking-actions">
            <button className="cta-btn" onClick={onRetry}>Повторить</button>
            <button className="ghost-btn" onClick={onLocalPractice}>Локальная практика</button>
          </div>
        </>
      )}
      {status === 'ready' && (
        <>
          <h1 className="screen-title">Матч готов</h1>
          <span className={`match-source source-${source}`}>{MATCH_SOURCE_LABELS[source]}</span>
          {abandonedNote && <span className="match-source source-player abandoned-note">{abandonedNote}</span>}
          <div className="matchmaking-card">
            <div className="vs-wrap">
              <div className="vs-side">
                <span className="vs-avatar player" aria-hidden="true">ТЫ</span>
                <span className="vs-name">Ты</span>
              </div>
              <span className="vs-label">VS</span>
              <div className="vs-side">
                <span className="vs-avatar opponent" aria-hidden="true">{opponent.displayName.slice(0, 2).toUpperCase()}</span>
                <span className="vs-name">{opponent.displayName}</span>
              </div>
            </div>
            <p className="matchmaking-status">
              {source === 'player' && 'Ты сыграешь тот же раунд против сохранённого результата игрока.'}
              {source === 'bot' && 'В пуле нет подходящей записи — этот раунд сыграет бот.'}
              {source === 'local' && 'Практика работает без сервера. Результат не будет сохранён.'}
              {source === 'challenge' && 'Фиксированный челлендж из исходного клипа.'}
            </p>
          </div>
          <button className="cta-btn" onClick={onStart}>Начать</button>
          {video && (
            <a className="matchmaking-video-link" href={video.url} target="_blank" rel="noopener noreferrer">
              Смотреть исходный клип ↗
            </a>
          )}
        </>
      )}
      </div>
    </section>
  );
}
