import { useEffect, useState } from 'react';
import type { CategoryId, GroupChallengePreviewResponse } from '@clutch/shared';
import { ApiError, fetchGroupChallenge } from '../../platform/api';
import { categoryName } from '../myRuns/myRunsView';

export function GroupChallengeEntry({ challengeId, onStart, onClose }: {
  challengeId: string; onStart: (id: string, category: CategoryId) => void; onClose: () => void;
}) {
  const [preview, setPreview] = useState<GroupChallengePreviewResponse | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setPreview(null);
    void fetchGroupChallenge(challengeId, controller.signal).then(value => {
      if (!controller.signal.aborted) setPreview(value);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof ApiError && [404, 410].includes(reason.status)
        ? 'Вызов больше недоступен.' : 'Не удалось загрузить вызов. Попробуй ещё раз.');
    });
    return () => controller.abort();
  }, [challengeId, attempt]);
  return <GroupChallengeEntryView preview={preview} error={error} challengeId={challengeId} onStart={onStart} onClose={onClose} onRetry={() => setAttempt(n => n + 1)} />;
}

export function GroupChallengeEntryView({ preview, error, challengeId, onStart, onClose, onRetry }: {
  preview: GroupChallengePreviewResponse | null; error: string; challengeId: string;
  onStart: (id: string, category: CategoryId) => void; onClose: () => void; onRetry: () => void;
}) {
  const completed = preview?.viewerEntry?.status === 'completed';
  const resume = preview?.viewerEntry?.status === 'in_progress';
  const full = preview ? preview.participantCount >= preview.maxPlayers : false;
  return <section className="matchmaking"><div className="matchmaking-body">
    <span className="matchmaking-eyebrow">Вызов друзьям</span>
    {!preview && !error && <div className="matchmaking-loading" role="status">Загружаем вызов…</div>}
    {error && <><p className="matchmaking-error" role="alert">{error}</p><button className="cta-btn" onClick={onRetry}>Повторить</button></>}
    {preview && <>
      <h1 className="screen-title">Вызов от {preview.creator.displayName}</h1>
      <p className="matchmaking-status">{categoryName(preview.category)}. Один набор для всех, одна попытка. Ссылка действует 24 часа.</p>
      <p className="matchmaking-status">Свободных мест: {Math.max(0, preview.maxPlayers - preview.participantCount)}. До {new Date(preview.expiresAt).toLocaleString('ru-RU')}.</p>
      {preview.expired && <p role="status">Срок вызова вышел.</p>}
      {completed && <p role="status">Твой результат уже в таблице. Повторная попытка недоступна.</p>}
      {full && !preview.viewerEntry && <p role="status">Все места заняты.</p>}
      <div className="solo-board-list" aria-label="Таблица вызова">
        {preview.board.map(row => <div className="solo-board-row" key={row.runId}>
          <span className="solo-board-place">{row.rank}</span>
          <span className="solo-board-avatar" aria-hidden="true">{row.displayName.slice(0, 2)}</span>
          <span className="solo-board-name">{row.displayName}{row.isCreator ? ' · автор' : ''}</span>
          <strong className="solo-board-score">{row.score.toFixed(2)} · {row.roundsPlayed} кр.</strong>
        </div>)}
      </div>
      {!completed && (resume || (!preview.expired && !full)) && <button className="cta-btn" onClick={() => onStart(challengeId, preview.category)}>{resume ? 'Продолжить' : 'Играть'}</button>}
    </>}
    <button className="ghost-btn" onClick={onClose}>На главную</button>
  </div></section>;
}
