import { useEffect, useRef, useState } from 'react';
import type { SkillResult } from '@clutch/shared';
import { playSound } from '../lib/sounds';
import type { ResultSaveStatus } from '../lib/useGameState';
import { canShareViaTelegram, shareViaTelegram } from '../lib/telegram';
import {
  buildSharePayload,
  chooseShareStrategy,
  executeShare,
  buildShareUrl,
  shareHeadline,
  type ShareResult,
} from '../lib/share';
import { MATCH_SOURCE_LABELS, type MatchSource } from '../lib/matchmaking';

interface ResultScreenProps {
  playerProgress: number;
  opponentProgress: number;
  opponentName: string;
  matchSource: MatchSource;
  abandonedNote?: string | null;
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
  abandonedNote,
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
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);
  const shareInput = { playerProgress, opponentProgress, opponentName, matchSource };
  const shareUrl = buildShareUrl(
    shareInput,
    import.meta.env.VITE_API_URL ?? '',
    typeof window === 'undefined' ? '' : window.location.origin,
  );

  async function handleShare() {
    const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const strategy = chooseShareStrategy({ telegramShare: canShareViaTelegram(), nativeShare: hasNative });
    const result = await executeShare(strategy, buildSharePayload(shareInput, shareUrl), {
      telegramShare: shareViaTelegram,
      nativeShare: hasNative ? (data) => navigator.share(data) : undefined,
      copy: (text) => navigator.clipboard.writeText(text),
    });
    setShareResult(result);
  }
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
      {abandonedNote && <span className="match-source source-player abandoned-note">{abandonedNote}</span>}

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

      <div
        className={`result-save-status ${saveStatus}`}
        role={saveStatus === 'error' ? 'alert' : 'status'}
      >
        {saveStatus === 'practice' && 'Локальная практика — результат не сохраняется.'}
        {saveStatus === 'pending' && 'Сохраняем результат…'}
        {saveStatus === 'saved' && 'Результат сохранён.'}
        {saveStatus === 'error' && (
          <>
            <span>{saveError || 'Не удалось сохранить результат.'}</span>
            {canRetrySave && (
              <>
                {' '}
                <button type="button" className="result-save-retry" onClick={onRetrySave}>Повторить</button>
              </>
            )}
          </>
        )}
      </div>

      <div className="share-card">
        <p className="share-card-title">CLUTCH</p>
        <p className="share-card-headline">{shareHeadline(shareInput)}</p>
        <div className="share-card-scores">
          <span>Я {playerProgress}%</span>
          <span>vs</span>
          <span>{opponentName} {opponentProgress}%</span>
        </div>
        {matchSource === 'local' && <p className="share-card-note">Тренировка, результат не сохранён</p>}
      </div>
      {shareResult === 'copied' && <p className="result-insight" role="status">Ссылка скопирована.</p>}
      {shareResult === 'failed' && (
        <p className="result-insight" role="status">Не удалось поделиться. Ссылка: {shareUrl}</p>
      )}

      <div className="result-actions">
        <button type="button" className="cta-btn" onClick={() => { playSound('click'); onReplay(); }}>Ещё раз</button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => { playSound('click'); void handleShare(); }}
        >
          Поделиться
        </button>
        <button type="button" className="ghost-btn" onClick={() => { playSound('click'); onHome(); }}>В меню</button>
      </div>
    </div>
  );
}
