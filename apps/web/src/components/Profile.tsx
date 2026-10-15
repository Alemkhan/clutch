import { useCallback, useEffect, useState } from 'react';
import type { SoloProfileResponse } from '@clutch/shared';
import { fetchSoloProfile } from '../lib/api';
import { soloRoundsText } from '../lib/myRunsView';
import { getTelegramIdentity } from '../lib/telegram';
import { SoundToggle } from './SoundToggle';

export type ProfileState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: SoloProfileResponse };

interface ProfileViewProps {
  playerName: string;
  state: ProfileState;
  onRetry: () => void;
}

export function ProfileView({ playerName, state, onRetry }: ProfileViewProps) {
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
    />
  );
}
