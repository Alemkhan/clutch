import { useEffect } from 'react';
import type { Opponent, Tournament } from '@clutch/shared';

interface MatchmakingProps {
  opponent: Opponent;
  video?: Tournament['video'];
  onDone: () => void;
}

export function Matchmaking({ opponent, video, onDone }: MatchmakingProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1800);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <section className="matchmaking">
      <span className="matchmaking-eyebrow">Асинхронный матч</span>
      <h1 className="screen-title">Соперник найден</h1>
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
        <p className="matchmaking-status">Ты сыграешь тот же раунд против сохранённого результата соперника.</p>
      </div>
      <div className="matchmaking-loading"><span /> Загружаем раунд</div>
      {video && (
        <a className="matchmaking-video-link" href={video.url} target="_blank" rel="noopener noreferrer">
          Смотреть исходный клип ↗
        </a>
      )}
    </section>
  );
}
