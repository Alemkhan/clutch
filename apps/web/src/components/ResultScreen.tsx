import { useEffect, useRef, useState } from 'react';
import type { SkillResult } from '@clutch/shared';
import { playSound } from '../lib/sounds';
import type { ResultSaveStatus } from '../lib/useGameState';
import { MATCH_SOURCE_LABELS, type MatchSource } from '../lib/matchmaking';

interface ResultScreenProps {
  playerProgress: number;
  opponentProgress: number;
  opponentName: string;
  matchSource: MatchSource;
  bestSkill: SkillResult | null;
  correctCount: number;
  questionsPlayed: number;
  perfectHits: number;
  avgResponseMs: number;
  saveStatus: ResultSaveStatus;
  saveError?: string;
  canRetrySave: boolean;
  onRetrySave: () => void;
  onReplay: () => void;
  onHome: () => void;
}

export function ResultScreen({
  playerProgress,
  opponentProgress,
  opponentName,
  matchSource,
  bestSkill,
  correctCount,
  questionsPlayed,
  perfectHits,
  avgResponseMs,
  saveStatus,
  saveError,
  canRetrySave,
  onRetrySave,
  onReplay,
  onHome,
}: ResultScreenProps) {
  const won = playerProgress > opponentProgress;
  const tie = playerProgress === opponentProgress;
  const [showShare, setShowShare] = useState(false);
  const recordedRef = useRef(false);

  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    playSound(won ? 'matchWin' : 'matchLose');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="result-screen">
      <div className={`result-mark ${won ? 'win' : tie ? 'tie' : 'loss'}`} aria-hidden="true">
        {won ? '✦' : tie ? '=' : '↗'}
      </div>

      <h1 className={`result-headline ${won ? 'win' : tie ? 'tie' : 'loss'}`}>
        {won ? 'Клатч!' : tie ? 'Ничья' : 'Почти!'}
      </h1>
      <span className={`match-source source-${matchSource}`}>{MATCH_SOURCE_LABELS[matchSource]}</span>

      <div className="result-comparison">
        <div className="result-side player">
          <span className="result-name">Ты</span>
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
          <span className="stat-label">Верных ответов</span>
          <span className="stat-value">{correctCount}/{questionsPlayed}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Идеальных удара</span>
          <span className="stat-value">{perfectHits}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Ср. реакция</span>
          <span className="stat-value">{(avgResponseMs / 1000).toFixed(2)}с</span>
        </div>
        {bestSkill && (
          <div className="stat">
            <span className="stat-label">Лучший удар</span>
            <span className="stat-value">
              {{ perfect: 'Идеально', great: 'Отлично', good: 'Хорошо', weak: 'Слабо', miss: 'Мимо' }[bestSkill]}
            </span>
          </div>
        )}
      </div>

      {!won && !tie && (
        <p className="result-insight">Один точный удар мог всё изменить.</p>
      )}

      <div className={`result-save-status ${saveStatus}`} role="status">
        {saveStatus === 'practice' && 'Локальная практика — результат не сохраняется.'}
        {saveStatus === 'pending' && 'Сохраняем результат…'}
        {saveStatus === 'saved' && 'Результат сохранён.'}
        {saveStatus === 'error' && (
          <>
            <span>{saveError || 'Не удалось сохранить результат.'}</span>
            {canRetrySave && (
              <>
                {' '}
                <button className="result-save-retry" onClick={onRetrySave}>Повторить</button>
              </>
            )}
          </>
        )}
      </div>

      {showShare && (
        <div className="share-card">
          <p className="share-card-title">CLUTCH</p>
          <p className="share-card-headline">{won ? 'Я вытащил клатч!' : 'Почти получилось!'}</p>
          <div className="share-card-scores">
            <span>Я {playerProgress}%</span>
            <span>vs</span>
            <span>{opponentName} {opponentProgress}%</span>
          </div>
        </div>
      )}

      <div className="result-actions">
        <button className="cta-btn" onClick={() => { playSound('click'); onReplay(); }}>Ещё раз</button>
        <button
          className="ghost-btn"
          onClick={() => {
            playSound('click');
            if (navigator.share) {
              navigator.share({ text: `Я ${won ? 'выиграл' : 'сыграл'} ${playerProgress}% против ${opponentProgress}% в Clutch!` }).catch(() => {});
            } else {
              setShowShare((v) => !v);
            }
          }}
        >
          Поделиться
        </button>
        <button className="ghost-btn" onClick={() => { playSound('click'); onHome(); }}>В меню</button>
      </div>
    </div>
  );
}
