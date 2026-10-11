import { useCallback, useEffect, useState } from 'react';
import type { MyRematchInvite, MyRunSummary } from '@clutch/shared';
import { fetchMyRuns } from '../lib/api';
import {
  categoryName,
  formatRunTime,
  friendDuelNote,
  inviteDeadline,
  runStatus,
  runSummary,
} from '../lib/myRunsView';
import { ScreenHeader } from './ScreenHeader';

const PAGE_SIZE = 20;

export type MyRunsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; runs: MyRunSummary[]; invites: MyRematchInvite[]; nextCursor: string | null };

interface MyRunsViewProps {
  state: MyRunsState;
  loadingMore: boolean;
  moreFailed: boolean;
  now: number;
  onBack: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenInvite: (inviteId: string) => void;
  onPlay: () => void;
}

function Invite({ invite, now, onOpen }: { invite: MyRematchInvite; now: number; onOpen: (inviteId: string) => void }) {
  const deadline = inviteDeadline(invite.expiresAt, now);
  if (!deadline) return null;
  return (
    <li>
      <button type="button" className="my-run my-run-invite" onClick={() => { onOpen(invite.inviteId); }}>
        <span className="my-run-top">
          <span className="my-run-title">{invite.challengerName} зовёт на реванш</span>
          <span className="my-run-status">{deadline}</span>
        </span>
        <span className="my-run-meta">
          {categoryName(invite.category)} · {invite.challengerProgress}% против {invite.yourProgress}%
        </span>
      </button>
    </li>
  );
}

function Run({ run, now }: { run: MyRunSummary; now: number }) {
  const status = runStatus(run);
  return (
    <li className="my-run">
      <span className="my-run-top">
        <span className="my-run-title">{categoryName(run.category)}</span>
        <span className={`my-run-status ${status.kind}`}>{status.text}</span>
      </span>
      <span className="my-run-meta">{runSummary(run)}</span>
      <span className="my-run-meta">
        {formatRunTime(run.completedAt, now)}
        {run.opponent ? ` · против ${run.opponent.displayName}` : ''}
        {run.mode === 'race' ? ' · гонка' : ''}
      </span>
      {friendDuelNote(run) && <span className="my-run-meta">{friendDuelNote(run)}</span>}
    </li>
  );
}

/** Экран «Мои партии» без сети: состояние приходит снаружи, поэтому все варианты проверяются тестами. */
export function MyRunsView({
  state,
  loadingMore,
  moreFailed,
  now,
  onBack,
  onRetry,
  onLoadMore,
  onOpenInvite,
  onPlay,
}: MyRunsViewProps) {
  const invites = state.status === 'ready'
    ? state.invites.filter((invite) => inviteDeadline(invite.expiresAt, now) !== null)
    : [];

  return (
    <section className="my-runs">
      <ScreenHeader onBack={onBack} title="Мои партии" />

      {state.status === 'loading' && (
        <div className="matchmaking-loading" role="status"><span /> Загружаем партии</div>
      )}

      {state.status === 'error' && (
        <div className="my-runs-message">
          <p className="matchmaking-error" role="alert">Не удалось загрузить партии. Проверь соединение и попробуй ещё раз.</p>
          <button type="button" className="cta-btn" onClick={onRetry}>Повторить</button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {invites.length > 0 && (
            <>
              <h2 className="my-runs-heading">Вызовы</h2>
              <ul className="my-runs-list">
                {invites.map((invite) => (
                  <Invite key={invite.inviteId} invite={invite} now={now} onOpen={onOpenInvite} />
                ))}
              </ul>
            </>
          )}

          {state.runs.length === 0 && (
            <div className="my-runs-message">
              <p className="matchmaking-error">Пока нет сыгранных партий.</p>
              <button type="button" className="cta-btn" onClick={onPlay}>Играть</button>
            </div>
          )}

          {state.runs.length > 0 && (
            <>
              {invites.length > 0 && <h2 className="my-runs-heading">Партии</h2>}
              <ul className="my-runs-list">
                {state.runs.map((run) => <Run key={run.runId} run={run} now={now} />)}
              </ul>
              {moreFailed && (
                <p className="matchmaking-error" role="alert">Не удалось загрузить остальное.</p>
              )}
              {state.nextCursor && (
                <button type="button" className="ghost-btn" disabled={loadingMore} onClick={onLoadMore}>
                  {loadingMore ? 'Загружаем…' : 'Показать ещё'}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

interface MyRunsProps {
  onBack: () => void;
  onOpenInvite: (inviteId: string) => void;
  onPlay: () => void;
}

export function MyRuns({ onBack, onOpenInvite, onPlay }: MyRunsProps) {
  const [state, setState] = useState<MyRunsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

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
      onBack={onBack}
      onRetry={() => setAttempt((value) => value + 1)}
      onLoadMore={loadMore}
      onOpenInvite={onOpenInvite}
      onPlay={onPlay}
    />
  );
}
