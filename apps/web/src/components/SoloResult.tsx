import { useEffect, useRef } from 'react';
import type { CompleteSoloRunResponse } from '@clutch/shared';
import { playSound } from '../lib/sounds';
import { buildSoloResult, type SoloSaveStatus } from '../lib/soloResult';
import type { SoloRunView } from '../lib/soloRunSession';
import type { PracticeSummary } from '../lib/practiceResult';
import { FRIEND_DUEL_CHIP, type FriendDuelSummary } from '../lib/friendDuelResult';
import { useFriendInvite } from '../lib/useFriendInvite';

interface SoloResultProps {
  view: SoloRunView;
  saveStatus: SoloSaveStatus;
  response: CompleteSoloRunResponse | null;
  saveError?: string;
  canRetrySave: boolean;
  onRetrySave: () => void;
  onReplay: () => void;
  onMyRuns: () => void;
  /** Тренировка против бота: короткий итог без сохранения; «Мои партии» заменяет выбор уровня. */
  practice?: PracticeSummary | null;
  onExitPractice?: () => void;
  /** Дружеская дуэль: вне соревнования, но исход против записи автора показывается. */
  friendDuel?: FriendDuelSummary | null;
}

/**
 * Два разных итога: дошёл до 100% либо упёрся в потолок. Второй не выдаётся за победу.
 * Исхода против соперника здесь нет: результат зафиксирован, а исход живёт в «Моих партиях».
 */
export function SoloResult({
  view,
  saveStatus,
  response,
  saveError,
  canRetrySave,
  onRetrySave,
  onReplay,
  onMyRuns,
  practice,
  onExitPractice,
  friendDuel,
}: SoloResultProps) {
  const result = buildSoloResult({ view, save: saveStatus, response });
  const playedRef = useRef(false);
  const practiceWon = practice ? practice.outcome === 'player' : null;
  const invite = useFriendInvite(response?.runId);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    playSound((practiceWon ?? result.reachedTarget) ? 'matchWin' : 'matchLose');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (practice) {
    const practiceTone = practice.outcome === 'player' ? 'win' : practice.outcome === 'tie' ? 'tie' : 'loss';
    return (
      <div className="result-screen solo-result">
        <span className="chip">Тренировка · не засчитывается</span>
        <h1 className={`result-headline ${practiceTone}`}>{practice.headline}</h1>
        <p className="solo-result-summary">{practice.line}</p>
        <div className="result-actions">
          <button type="button" className="cta-btn" onClick={() => { onReplay(); }}>Ещё раз</button>
          <button type="button" className="ghost-btn" onClick={() => { onExitPractice?.(); }}>Другой уровень</button>
        </div>
      </div>
    );
  }

  // Уход с экрана оборвал бы отправку результата, поэтому до ответа сервера кнопки выключены.
  const saving = saveStatus === 'saving';
  const tone = result.reachedTarget ? 'win' : 'tie';
  // Звать есть кого, только когда результат дошёл до цели и сохранён на сервере.
  // Забег по ссылке вне соревнования: звать с него друзей нельзя.
  const canInvite = saveStatus === 'saved' && response?.reachedTarget === true && !friendDuel;
  const duelTone = friendDuel?.outcome === 'player' ? 'win' : friendDuel?.outcome === 'opponent' ? 'loss' : 'tie';

  return (
    <div className={`result-screen solo-result ${result.reachedTarget ? 'reached' : 'not-reached'}`}>
      {friendDuel && <span className="chip">{FRIEND_DUEL_CHIP}</span>}
      {!friendDuel && <div className={`result-mark ${tone}`} aria-hidden="true">{result.reachedTarget ? '✦' : '↗'}</div>}
      <h1 className={`result-headline ${friendDuel ? duelTone : tone}`}>{friendDuel ? friendDuel.headline : result.headline}</h1>
      <p className="solo-result-summary">{friendDuel ? friendDuel.line || result.summary : result.summary}</p>

      {(saveStatus === 'saving' || saveStatus === 'error') && (
        <div
          className={`result-save-status ${saveStatus === 'error' ? 'error' : 'pending'}`}
          role={saveStatus === 'error' ? 'alert' : 'status'}
        >
          {saveStatus === 'saving' && 'Сохраняем результат…'}
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
      )}

      {invite.status === 'copied' && <p className="result-insight" role="status">Ссылка скопирована.</p>}
      {invite.status === 'error' && <p className="result-insight" role="alert">Не удалось отправить. Нажми ещё раз.</p>}

      <div className="result-actions">
        <button type="button" className="cta-btn" disabled={saving} onClick={() => { onReplay(); }}>Сыграть ещё</button>
        {canInvite && (
          <button
            type="button"
            className="ghost-btn"
            disabled={invite.status === 'working'}
            onClick={() => { void invite.send(); }}
          >
            Позвать друга
          </button>
        )}
        <button type="button" className="ghost-btn" disabled={saving} onClick={() => { onMyRuns(); }}>Мои партии</button>
      </div>
    </div>
  );
}
