import { useCallback, useEffect, useState } from 'react';
import type { SoloProfileResponse } from '@clutch/shared';
import { fetchDailyNotifications, fetchSoloProfile, setDailyNotifications } from '../../platform/api';
import { soloRoundsText } from '../myRuns/myRunsView';
import { getTelegramIdentity } from '../../platform/telegram';
import { SoundToggle } from '../../ui/SoundToggle';

export type ProfileState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: SoloProfileResponse };

interface ProfileViewProps {
  playerName: string;
  state: ProfileState;
  onRetry: () => void;
  telegram?: boolean;
}

type DailySettingState = 'loading' | 'on' | 'off' | 'saving' | 'error';

export function DailyNotificationsToggle() {
  const [state, setState] = useState<DailySettingState>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetchDailyNotifications(controller.signal).then(
      ({ enabled }) => { if (!controller.signal.aborted) setState(enabled ? 'on' : 'off'); },
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setState('error');
      },
    );
    return () => controller.abort();
  }, []);

  const enabled = state === 'on';
  const change = () => {
    if (state === 'loading' || state === 'saving') return;
    const next = !enabled;
    setState('saving');
    setDailyNotifications(next).then(
      () => setState(next ? 'on' : 'off'),
      () => setState('error'),
    );
  };

  return <>
    <button
      type="button"
      className="sound-toggle-row"
      aria-pressed={enabled}
      aria-label={`Ежедневные задания ${enabled ? 'включены' : 'выключены'}`}
      disabled={state === 'loading' || state === 'saving'}
      onClick={change}
    >
      <span className="sound-toggle-title" aria-hidden="true">Ежедневные задания</span>
      <span className="sound-toggle-state" aria-hidden="true">{state === 'loading' || state === 'saving' ? '…' : enabled ? 'вкл' : 'выкл'}</span>
    </button>
    {state === 'error' && <p className="profile-setting-error" role="alert">Не удалось сохранить настройку. Нажми ещё раз.</p>}
  </>;
}

export function ProfileView({ playerName, state, onRetry, telegram = false }: ProfileViewProps) {
  const empty = state.status === 'ready' && state.profile.completedRuns === 0;

  return (
    <section className="profile-screen root-tab">
      <div className="profile-head">
        <span className="profile-avatar" aria-hidden="true">{playerName.slice(0, 2).toUpperCase()}</span>
        <h1 className="profile-name">{playerName}</h1>
        <p className="profile-tag">Подтверждённая статистика зачётных соло-забегов</p>
      </div>

      {state.status === 'loading' && (
        <div className="matchmaking-loading" role="status"><span /> Загружаем статистику</div>
      )}

      {state.status === 'error' && (
        <div className="my-runs-message">
          <p className="matchmaking-error" role="alert">Не удалось загрузить статистику. Проверь соединение и попробуй ещё раз.</p>
          <button type="button" className="cta-btn" onClick={onRetry}>Повторить</button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div className="home-stats-card">
            <div className="mini-stat">
              <span className="mini-stat-value">{state.profile.completedRuns}</span>
              <span className="mini-stat-label">Забегов</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{state.profile.reachedTargetRuns}</span>
              <span className="mini-stat-label">Финишей</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">
                {state.profile.bestRounds === null ? '—' : soloRoundsText(state.profile.bestRounds)}
              </span>
              <span className="mini-stat-label">Лучший финиш</span>
            </div>
          </div>
          {empty && <p className="profile-tag">Сыграй первый зачётный забег — результат появится здесь.</p>}
        </>
      )}

      <h2 className="section-heading">Настройки</h2>
      <SoundToggle variant="profile" />
      {telegram
        ? <DailyNotificationsToggle />
        : <p className="profile-tag">Ежедневные сообщения доступны внутри Telegram.</p>}
    </section>
  );
}

export function Profile() {
  const [state, setState] = useState<ProfileState>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const playerName = getTelegramIdentity()?.displayName || 'Игрок';
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setRequestKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSoloProfile(controller.signal).then(
      (profile) => setState({ status: 'ready', profile }),
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [requestKey]);

  return (
    <ProfileView
      playerName={playerName}
      state={state}
      onRetry={retry}
      telegram={getTelegramIdentity() !== null}
    />
  );
}
