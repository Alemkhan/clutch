import { useEffect, useState } from 'react';
import type { SkillResult } from '@clutch/shared';
import { playSound } from '../lib/sounds';
import { recordMatch } from '../lib/localStats';

interface ResultScreenProps {
  playerProgress: number;
  opponentProgress: number;
  opponentName: string;
  bestSkill: SkillResult | null;
  correctCount: number;
  totalQuestions: number;
  perfectHits: number;
  avgResponseMs: number;
  onReplay: () => void;
  onHome: () => void;
}

export function ResultScreen({
  playerProgress,
  opponentProgress,
  opponentName,
  bestSkill,
  correctCount,
  totalQuestions,
  perfectHits,
  avgResponseMs,
  onReplay,
  onHome,
}: ResultScreenProps) {
  const won = playerProgress > opponentProgress;
  const tie = playerProgress === opponentProgress;
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    playSound(won ? 'matchWin' : 'matchLose');
    recordMatch(won ? 'win' : tie ? 'tie' : 'loss');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="result-screen">
      {won && <img className="result-trophy" src="/sprites/trophy.png" alt="" aria-hidden="true" />}

      <h1 className={`result-headline ${won ? 'win' : tie ? 'tie' : 'loss'}`}>
        {won ? 'You Clutched It!' : tie ? 'Draw' : 'So Close'}
      </h1>

      <div className="result-comparison">
        <div className="result-side player">
          <span className="result-name">You</span>
          <span className="result-progress">{playerProgress}%</span>
        </div>
        <div className="result-vs">vs</div>
        <div className="result-side opponent">
          <span className="result-name">{opponentName}</span>
          <span className="result-progress">{opponentProgress}%</span>
        </div>
      </div>

      <div className="result-stats-grid">
        <div className="stat">
          <span className="stat-label">Correct Answers</span>
          <span className="stat-value">{correctCount}/{totalQuestions}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Perfect Hits</span>
          <span className="stat-value">{perfectHits}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Avg Reaction</span>
          <span className="stat-value">{(avgResponseMs / 1000).toFixed(2)}s</span>
        </div>
        {bestSkill && (
          <div className="stat">
            <span className="stat-label">Best Strike</span>
            <span className="stat-value">{bestSkill}</span>
          </div>
        )}
      </div>

      {!won && !tie && (
        <p className="result-insight">One better strike could have won it.</p>
      )}

      {showShare && (
        <div className="share-card">
          <p className="share-card-title">CLUTCH</p>
          <p className="share-card-headline">{won ? 'I clutched the win!' : 'Close match!'}</p>
          <div className="share-card-scores">
            <span>You {playerProgress}%</span>
            <span>vs</span>
            <span>{opponentName} {opponentProgress}%</span>
          </div>
        </div>
      )}

      <div className="result-actions">
        <button className="cta-btn" onClick={() => { playSound('click'); onReplay(); }}>Play Again</button>
        <button
          className="ghost-btn"
          onClick={() => {
            playSound('click');
            if (navigator.share) {
              navigator.share({ text: `I ${won ? 'won' : 'played'} ${playerProgress}% to ${opponentProgress}% on Clutch!` }).catch(() => {});
            } else {
              setShowShare((v) => !v);
            }
          }}
        >
          Share
        </button>
        <button className="ghost-btn" onClick={() => { playSound('click'); onHome(); }}>Back to Home</button>
      </div>
    </div>
  );
}
