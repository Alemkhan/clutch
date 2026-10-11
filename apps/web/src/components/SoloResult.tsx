import { useEffect, useRef } from 'react';
import type { CompleteSoloRunResponse } from '@clutch/shared';
import { SOLO_TARGET_PROGRESS } from '@clutch/shared';
import { playSound } from '../lib/sounds';
import { buildSoloResult, type SoloSaveStatus } from '../lib/soloResult';
import type { SoloRunView } from '../lib/soloRunSession';

interface SoloResultProps {
  view: SoloRunView;
  correctCount: number;
  paceName: string | null;
  saveStatus: SoloSaveStatus;
  response: CompleteSoloRunResponse | null;
  saveError?: string;
  canRetrySave: boolean;
  onRetrySave: () => void;
  onReplay: () => void;
  onHome: () => void;
}

/** Два разных итога: дошёл до 100% либо упёрся в потолок. Второй не выдаётся за победу. */
export function SoloResult({
  view,
  correctCount,
  paceName,
  saveStatus,
  response,
  saveError,
  canRetrySave,
  onRetrySave,
  onReplay,
  onHome,
}: SoloResultProps) {
  const result = buildSoloResult({ view, save: saveStatus, response, paceName });
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    playSound(result.reachedTarget ? 'matchWin' : 'matchLose');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tone = result.reachedTarget ? 'win' : 'tie';

  return (
    <div className={`result-screen solo-result ${result.reachedTarget ? 'reached' : 'not-reached'}`}>
      <div className={`result-mark ${tone}`} aria-hidden="true">{result.reachedTarget ? '✦' : '↗'}</div>
      <h1 className={`result-headline ${tone}`}>{result.headline}</h1>
      <p className="solo-result-summary">{result.summary}</p>

      <div className="result-stats-grid">
        <div className="stat">
          <span className="stat-label">Прогресс</span>
          <span className="stat-value">{result.progress}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">Кругов</span>
          <span className="stat-value">{result.roundsPlayed}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Верных ответов</span>
          <span className="stat-value">{response && saveStatus === 'saved' ? response.correctCount : correctCount}/{result.roundsPlayed}</span>
        </div>
        {result.reachedTarget ? (
          <div className="stat">
            <span className="stat-label">Результат</span>
            <span className="stat-value">{result.score ?? '…'}</span>
          </div>
        ) : (
          <div className="stat">
            <span className="stat-label">До цели</span>
            <span className="stat-value">{SOLO_TARGET_PROGRESS - result.progress}%</span>
          </div>
        )}
      </div>

      {result.scoreLine && <p className="solo-result-note">{result.scoreLine}</p>}

      {result.outcome && (
        <p className={`solo-result-outcome ${result.outcome.kind}`} role="status">{result.outcome.text}</p>
      )}

      <div
        className={`result-save-status ${saveStatus === 'saved' ? 'saved' : saveStatus === 'error' ? 'error' : 'pending'}`}
        role={saveStatus === 'error' ? 'alert' : 'status'}
      >
        {saveStatus === 'saving' && 'Сохраняем результат…'}
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

      <div className="result-actions">
        <button type="button" className="cta-btn" onClick={() => { onReplay(); }}>Ещё забег</button>
        <button type="button" className="ghost-btn" onClick={() => { onHome(); }}>В меню</button>
      </div>
    </div>
  );
}
