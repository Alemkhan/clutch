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
      <h1 className="screen-title">Finding Your<br />Opponent</h1>
      <div className="vs-wrap">
        <div className="vs-side">
          <img src="/sprites/avatar-player.png" alt="" className="vs-avatar" />
          <span className="vs-name">You</span>
        </div>
        <span className="vs-label">VS</span>
        <div className="vs-side">
          <img src={opponent.avatar ?? '/sprites/avatar-opponent.png'} alt="" className="vs-avatar" />
          <span className="vs-name">{opponent.displayName}</span>
        </div>
      </div>
      <p className="matchmaking-status">Matching players in your league…</p>
      <div className="matchmaking-spinner" aria-hidden="true" />
      {video && (
        <a className="matchmaking-video-link" href={video.url} target="_blank" rel="noopener noreferrer">
          Watch the source clip ↗
        </a>
      )}
    </section>
  );
}
