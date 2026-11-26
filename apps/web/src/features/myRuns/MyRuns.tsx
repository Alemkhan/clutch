import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MyRematchInvite, MyRunSummary } from '@clutch/shared';
import { createRematchInvite, fetchMyRuns } from '../../platform/api';
import {
  categoryName,
  formatRunTime,
  friendDuelNote,
  inviteDeadline,
  inviteRoundsParts,
  runBadge,
  runRoundsLine,
} from './myRunsView';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { useMessages } from '../../i18n/messages';
import { m } from './messages';
import { displayPlayerName } from '../../i18n/playerName';

const PAGE_SIZE = 20;

export type MyRunsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; runs: MyRunSummary[]; invites: MyRematchInvite[]; nextCursor: string | null };

/**
 * Что показывать у забега вместо кнопки реванша. null - звать некого. 'working'/'error' живут
 * только в этом экране: сервер знает лишь «приглашение есть» ('sent') или «нет» ('available').
 */
export type RematchOfferState = 'available' | 'working' | 'sent' | 'error' | null;

export interface RematchOffer {
  stateOf: (run: MyRunSummary) => RematchOfferState;
  send: (runId: string) => void;
}

/** По умолчанию экран показывает то, что сказал сервер, и ничего не нажимает сам. */
export const SERVER_REMATCH_OFFER: RematchOffer = {
  stateOf: (run) => run.rematchOffer ?? null,
  send: () => {},
};

interface MyRunsViewProps {
  state: MyRunsState;
  loadingMore: boolean;
  moreFailed: boolean;
  now: number;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenInvite: (inviteId: string) => void;
  onPlay: () => void;
  offer?: RematchOffer;
}

function Invite({ invite, now, onOpen }: { invite: MyRematchInvite; now: number; onOpen: (inviteId: string) => void }) {
  const t = useMessages(m);
  const deadline = inviteDeadline(invite.expiresAt, now);
  if (!deadline) return null;
  const rounds = inviteRoundsParts(invite);
  return (
    <li className="my-run-invite">
      <div className="my-run-invite-body">
        <div className="my-run-top">
          {/* Адресное приглашение теперь рождается только от нажатия соперника, поэтому «зовёт»
              здесь - правда. Раньше строку создавало уведомление, и вызов приходил от системы. */}
          <span className="my-run-title">{t.callsRematch(invite.challengerName)}</span>
          <span className="my-run-deadline">{deadline}</span>
        </div>
        <span className="my-run-invite-info">
          {rounds
            ? <>{rounds.lead}<strong>{rounds.strong}</strong>{rounds.rest} · {categoryName(invite.category)}</>
            : <>{categoryName(invite.category)} · {t.progressVs(invite.challengerProgress, invite.yourProgress)}</>}
        </span>
      </div>
      <button type="button" className="cta-btn my-run-accept" onClick={() => { onOpen(invite.inviteId); }}>
        {t.acceptRematch}
      </button>
    </li>
  );
}

function Run({ run, now, offer }: { run: MyRunSummary; now: number; offer: RematchOffer }) {
  const t = useMessages(m);
  const status = runBadge(run);
  const state = offer.stateOf(run);
  return (
    <li className="my-run">
      <div className="my-run-main">
        <span className="my-run-line">{runRoundsLine(run)}</span>
        <span className="my-run-meta">
          {categoryName(run.category)} · {formatRunTime(run.completedAt, now)}
          {run.opponent ? ` · ${displayPlayerName(run.opponent.displayName)}` : ''}
        </span>
        {friendDuelNote(run) && <span className="my-run-meta">{friendDuelNote(run)}</span>}
        {/* Реванш зовёт игрок: кнопка есть у забега против записи человека при любом исходе. */}
        {state === 'available' && (
          <button
            type="button"
            className="ghost-btn my-run-rematch"
            onClick={() => { offer.send(run.runId); }}
          >
            {t.offerRematch}
          </button>
        )}
        {state === 'working' && <span className="my-run-meta" role="status">{t.offerWorking}</span>}
        {state === 'sent' && <span className="my-run-meta">{t.offerSent}</span>}
        {state === 'error' && (
          <span className="my-run-meta" role="alert">
            {t.offerError}{' '}
            <button type="button" className="result-save-retry" onClick={() => { offer.send(run.runId); }}>{t.offerAgain}</button>
          </span>
        )}
      </div>
      <span className={`my-run-status ${status.kind}`}>{status.text}</span>
    </li>
  );
}

/** Экран «Мои партии» без сети: состояние приходит снаружи, поэтому все варианты проверяются тестами. */
export function MyRunsView({
  state,
  loadingMore,
  moreFailed,
  now,
  onRetry,
  onLoadMore,
  onOpenInvite,
  onPlay,
  offer = SERVER_REMATCH_OFFER,
}: MyRunsViewProps) {
  const t = useMessages(m);
  const invites = state.status === 'ready'
    ? state.invites.filter((invite) => inviteDeadline(invite.expiresAt, now) !== null)
    : [];

  return (
    <section className="my-runs root-tab">
      <ScreenHeader title={t.title} />

      {state.status === 'loading' && (
        <div className="matchmaking-loading" role="status"><span /> {t.loading}</div>
      )}

      {state.status === 'error' && (
        <div className="my-runs-message">
          <p className="matchmaking-error" role="alert">{t.loadError}</p>
          <button type="button" className="cta-btn" onClick={onRetry}>{t.retry}</button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {invites.length > 0 && (
            <div className="my-runs-group">
              <h2 className="my-runs-heading">{t.invitesHeading}</h2>
              <ul className="my-runs-invites">
                {invites.map((invite) => (
                  <Invite key={invite.inviteId} invite={invite} now={now} onOpen={onOpenInvite} />
                ))}
              </ul>
            </div>
          )}

          {state.runs.length === 0 && (
            <div className="my-runs-message">
              <p className="matchmaking-error">{t.empty}</p>
              <button type="button" className="cta-btn" onClick={onPlay}>{t.play}</button>
            </div>
          )}

          {state.runs.length > 0 && (
            <div className="my-runs-group">
              <h2 className="my-runs-heading">{t.historyHeading}</h2>
              <ul className="my-runs-card">
                {state.runs.map((run) => <Run key={run.runId} run={run} now={now} offer={offer} />)}
              </ul>
              {moreFailed && (
                <p className="matchmaking-error" role="alert">{t.moreError}</p>
              )}
              {state.nextCursor && (
                <button type="button" className="ghost-btn my-runs-more" disabled={loadingMore} onClick={onLoadMore}>
                  {loadingMore ? t.loadingMore : t.showMore}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface MyRunsProps {
  onOpenInvite: (inviteId: string) => void;
  onPlay: () => void;
}

export function MyRuns({ onOpenInvite, onPlay }: MyRunsProps) {
  const [state, setState] = useState<MyRunsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // Нажатия «Позвать на реванш» по id забега. Сервер после успеха и сам вернёт 'sent',
  // но список не перезагружается, поэтому ответ показывается сразу отсюда.
  const [offers, setOffers] = useState<Record<string, 'working' | 'sent' | 'error'>>({});

  const sendOffer = useCallback((runId: string) => {
    setOffers((current) => (current[runId] === 'working' ? current : { ...current, [runId]: 'working' }));
    createRematchInvite(runId)
      .then(() => setOffers((current) => ({ ...current, [runId]: 'sent' })))
      .catch(() => setOffers((current) => ({ ...current, [runId]: 'error' })));
  }, []);

  const offer = useMemo<RematchOffer>(() => ({
    stateOf: (run) => offers[run.runId] ?? run.rematchOffer ?? null,
    send: sendOffer,
  }), [offers, sendOffer]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    setMoreFailed(false);
    fetchMyRuns({ limit: PAGE_SIZE }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'ready',
          runs: response.runs,
          invites: response.invites,
          nextCursor: response.nextCursor,
        });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    return () => controller.abort();
  }, [attempt]);

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.nextCursor || loadingMore) return;
    const before = state.nextCursor;
    setLoadingMore(true);
    setMoreFailed(false);
    fetchMyRuns({ limit: PAGE_SIZE, before })
      .then((response) => {
        setState((current) => current.status === 'ready' && current.nextCursor === before
          ? { ...current, runs: [...current.runs, ...response.runs], nextCursor: response.nextCursor }
          : current);
      })
      .catch(() => setMoreFailed(true))
      .finally(() => setLoadingMore(false));
  }, [state, loadingMore]);

  return (
    <MyRunsView
      state={state}
      loadingMore={loadingMore}
      moreFailed={moreFailed}
      now={Date.now()}
      onRetry={() => setAttempt((value) => value + 1)}
      onLoadMore={loadMore}
      onOpenInvite={onOpenInvite}
      onPlay={onPlay}
      offer={offer}
    />
  );
}
