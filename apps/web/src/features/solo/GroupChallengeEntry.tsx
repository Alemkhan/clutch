import { useMessages } from '../../i18n/messages';
import { useLocale } from '../../i18n/locale';
import { m } from './messages';
import { useEffect, useState } from 'react';
import type { CategoryId, GroupChallengePreviewResponse } from '@clutch/shared';
import { ApiError, fetchGroupChallenge } from '../../platform/api';
import { categoryName } from '../myRuns/myRunsView';
import { Creature } from '../../ui/Creature';
import { displayPlayerName } from '../../i18n/playerName';

const DATE_LOCALES = { ru: 'ru-RU', en: 'en-GB', kk: 'kk-KZ' } as const;

export function GroupChallengeEntry({ challengeId, onStart, onClose }: {
  challengeId: string; onStart: (id: string, category: CategoryId) => void; onClose: () => void;
}) {
  const t = useMessages(m);
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
        ? t.challengeGone : t.challengeLoadFailed);
    });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId, attempt]);
  return <GroupChallengeEntryView preview={preview} error={error} challengeId={challengeId} onStart={onStart} onClose={onClose} onRetry={() => setAttempt(n => n + 1)} />;
}

export function GroupChallengeEntryView({ preview, error, challengeId, onStart, onClose, onRetry }: {
  preview: GroupChallengePreviewResponse | null; error: string; challengeId: string;
  onStart: (id: string, category: CategoryId) => void; onClose: () => void; onRetry: () => void;
}) {
  const t = useMessages(m);
  const locale = useLocale();
  const completed = preview?.viewerEntry?.status === 'completed';
  const resume = preview?.viewerEntry?.status === 'in_progress';
  const full = preview ? preview.participantCount >= preview.maxPlayers : false;
  return <section className="matchmaking"><div className="matchmaking-body">
    <span className="matchmaking-eyebrow">{t.friendsChallenge}</span>
    {!preview && !error && <div className="matchmaking-loading" role="status">{t.loadingChallenge}</div>}
    {error && <><p className="matchmaking-error" role="alert">{error}</p><button className="cta-btn" onClick={onRetry}>{t.retry}</button></>}
    {preview && <>
      <h1 className="screen-title">{t.challengeFrom(displayPlayerName(preview.creator.displayName))}</h1>
      <p className="matchmaking-status">{t.challengeRules(categoryName(preview.category))}</p>
      <p className="matchmaking-status">{t.freeSeats(Math.max(0, preview.maxPlayers - preview.participantCount), new Date(preview.expiresAt).toLocaleString(DATE_LOCALES[locale]))}</p>
      {preview.expired && <p role="status">{t.challengeExpired}</p>}
      {completed && <p role="status">{t.challengeCompleted}</p>}
      {full && !preview.viewerEntry && <p role="status">{t.seatsFull}</p>}
      <div className="solo-board-list" aria-label={t.challengeBoard}>
        {preview.board.map(row => <div className="solo-board-row" key={row.runId}>
          <span className="solo-board-place">{row.rank}</span>
          <span className="solo-board-avatar" aria-hidden="true"><Creature seed={row.displayName} /></span>
          <span className="solo-board-name">{row.displayName}{row.isCreator ? t.author : ''}</span>
          <strong className="solo-board-score">{row.score.toFixed(2)} · {t.roundsShort(row.roundsPlayed)}</strong>
        </div>)}
      </div>
      {!completed && (resume || (!preview.expired && !full)) && <button className="cta-btn" onClick={() => onStart(challengeId, preview.category)}>{resume ? t.resume : t.play}</button>}
    </>}
    <button className="ghost-btn" onClick={onClose}>{t.home}</button>
  </div></section>;
}
