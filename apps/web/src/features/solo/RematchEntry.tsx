import { messagesFor, useMessages } from '../../i18n/messages';
import { m } from './messages';
import { useEffect, useState } from 'react';
import type { CategoryId } from '@clutch/shared';
import {
  ApiError,
  fetchRematchPreview,
  setDailyNotifications,
  setOutbidNotifications,
  type RematchPreview,
} from '../../platform/api';
import type { LaunchIntent } from '../../app/launchIntent';

interface RematchEntryProps {
  intent: LaunchIntent;
  onStartRematch: (inviteId: string, category: CategoryId) => void;
  onClose: () => void;
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: RematchPreview }
  | { status: 'gone'; reason?: string }
  | { status: 'error' };

export function rematchErrorKind(error: unknown): 'gone' | 'error' {
  return error instanceof ApiError && [403, 404, 410].includes(error.status) ? 'gone' : 'error';
}

/** Почему приглашение не открылось; сервер называет причину у ссылок «Позвать друга». */
export function rematchGoneText(reason: string | undefined): string {
  const t = messagesFor(m);
  if (reason === 'own') return t.goneOwn;
  if (reason === 'taken') return t.goneTaken;
  if (reason === 'expired') return t.goneExpired;
  return t.goneOther;
}

function RematchInvite({ inviteId, onStartRematch, onClose }: {
  inviteId: string;
  onStartRematch: RematchEntryProps['onStartRematch'];
  onClose: () => void;
}) {
  const t = useMessages(m);
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const friend = (state.status === 'ready' && state.preview.friend === true)
    || (state.status === 'gone' && state.reason !== undefined);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchRematchPreview(inviteId, controller.signal)
      .then((preview) => { if (!controller.signal.aborted) setState({ status: 'ready', preview }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(rematchErrorKind(error) === 'gone'
          ? { status: 'gone', reason: error instanceof ApiError ? error.reason : undefined }
          : { status: 'error' });
      });
    return () => controller.abort();
  }, [inviteId, attempt]);

  return (
    <section className="matchmaking">
      <div className="matchmaking-body">
        <span className="matchmaking-eyebrow">{friend ? t.challenge : t.rematch}</span>
        {state.status === 'loading' && (
          <>
            <h1 className="screen-title">{t.openingInvite}</h1>
            <div className="matchmaking-loading" role="status"><span /> {t.loading}</div>
          </>
        )}
        {state.status === 'ready' && (
          <>
            {state.preview.friend ? (
              <>
                <h1 className="screen-title">{t.beat(state.preview.challengerName)}</h1>
                <p className="matchmaking-status">{t.hisResult(state.preview.challengerProgress)}</p>
              </>
            ) : (
              <>
                <h1 className="screen-title">{t.rematchWith(state.preview.challengerName)}</h1>
                <p className="matchmaking-status">
                  {t.rematchVs(state.preview.challengerName, state.preview.challengerProgress, state.preview.yourProgress)}
                  {' '}{t.rematchExplain}
                </p>
              </>
            )}
            <button
              className="cta-btn"
              onClick={() => onStartRematch(state.preview.inviteId, state.preview.category)}
            >
              {state.preview.friend ? t.play : t.startRematch}
            </button>
            <button className="ghost-btn" onClick={onClose}>{t.notNow}</button>
          </>
        )}
        {state.status === 'gone' && (
          <>
            <h1 className="screen-title">{state.reason ? t.linkUnavailable : t.rematchUnavailable}</h1>
            <p className="matchmaking-error" role="alert">{rematchGoneText(state.reason)}</p>
            <button className="cta-btn" onClick={onClose}>{t.home}</button>
          </>
        )}
        {state.status === 'error' && (
          <>
            <h1 className="screen-title">{t.inviteOpenFailed}</h1>
            <p className="matchmaking-error" role="alert">{t.checkConnection}</p>
            <button className="cta-btn" onClick={() => setAttempt((value) => value + 1)}>{t.retry}</button>
            <button className="ghost-btn" onClick={onClose}>{t.home}</button>
          </>
        )}
      </div>
    </section>
  );
}

type UnsubscribeState = 'working' | 'off' | 'on' | 'error';

function Unsubscribe({ onClose, daily = false }: { onClose: () => void; daily?: boolean }) {
  const t = useMessages(m);
  const [state, setState] = useState<UnsubscribeState>('working');

  const change = (enabled: boolean) => {
    setState('working');
    (daily ? setDailyNotifications(enabled) : setOutbidNotifications(enabled))
      .then(() => setState(enabled ? 'on' : 'off'))
      .catch(() => setState('error'));
  };

  // Opening the link is the request: nothing else to confirm.
  useEffect(() => { change(false); }, []);

  return (
    <section className="matchmaking">
      <div className="matchmaking-body">
        <span className="matchmaking-eyebrow">{t.notifications}</span>
        {state === 'working' && (
          <div className="matchmaking-loading" role="status"><span /> {t.saving}</div>
        )}
        {state === 'off' && (
          <>
            <h1 className="screen-title">{t.messagesOff}</h1>
            <p className="matchmaking-status">{daily
              ? t.dailyOff
              : t.outbidOff}</p>
            <button className="cta-btn" onClick={onClose}>{t.home}</button>
            <button className="ghost-btn" onClick={() => change(true)}>{t.turnBackOn}</button>
          </>
        )}
        {state === 'on' && (
          <>
            <h1 className="screen-title">{t.messagesOn}</h1>
            <p className="matchmaking-status">{daily
              ? t.dailyOn
              : t.outbidOn}</p>
            <button className="cta-btn" onClick={onClose}>{t.home}</button>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 className="screen-title">{t.saveFailed}</h1>
            <p className="matchmaking-error" role="alert">{t.settingUnchanged}</p>
            <button className="cta-btn" onClick={() => change(false)}>{t.retry}</button>
            <button className="ghost-btn" onClick={onClose}>{t.home}</button>
          </>
        )}
      </div>
    </section>
  );
}

export function RematchEntry({ intent, onStartRematch, onClose }: RematchEntryProps) {
  if (intent.type === 'rematch') {
    return <RematchInvite inviteId={intent.inviteId} onStartRematch={onStartRematch} onClose={onClose} />;
  }
  if (intent.type === 'unsubscribe' || intent.type === 'daily-unsubscribe') {
    return <Unsubscribe onClose={onClose} daily={intent.type === 'daily-unsubscribe'} />;
  }
  return null;
}
