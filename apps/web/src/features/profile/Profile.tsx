import { useCallback, useEffect, useState } from 'react';
import type { SoloProfileResponse } from '@clutch/shared';
import { deleteAccount, fetchDailyNotifications, fetchSoloProfile, setDailyNotifications } from '../../platform/api';
import { soloRoundsText } from '../myRuns/myRunsView';
import { ensureBotCanWrite, getTelegramIdentity } from '../../platform/telegram';
import { AchievementGrid, daysText, LevelBar } from '../progress/Progress';
import { LanguageSetting } from '../language/LanguagePicker';
import { RegionSetting } from '../language/RegionSetting';
import { SoundToggle } from '../../ui/SoundToggle';
import { PlayerAvatar } from '../../ui/PlayerAvatar';
import { useMyClan } from '../clans/clanStore';
import { clansEnabled } from '../clans/clansEnabled';
import { m as clanMessages } from '../clans/messages';
import { useMessages } from '../../i18n/messages';
import { m } from './messages';

export type ProfileState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: SoloProfileResponse };

interface ProfileViewProps {
  playerName: string;
  state: ProfileState;
  onRetry: () => void;
  telegram?: boolean;
  /** Эмодзи клана - аватар; без клана - зверёк. */
  clanEmoji?: string | null;
  /** Открыть клан (или выбор эмодзи). */
  onClan?: () => void;
}

type DailySettingState = 'loading' | 'on' | 'off' | 'saving' | 'error';

export function DailyNotificationsToggle() {
  const t = useMessages(m);
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
    // Включение: сначала разрешение Telegram писать в личку, иначе сообщения не дойдут.
    void (next ? ensureBotCanWrite() : Promise.resolve(true)).then((allowed) => {
      if (!allowed) {
        setState('off');
        return;
      }
      setDailyNotifications(next).then(
        () => setState(next ? 'on' : 'off'),
        () => setState('error'),
      );
    });
  };

  return <>
    <button
      type="button"
      className="sound-toggle-row"
      aria-pressed={enabled}
      aria-label={t.dailyAria(enabled)}
      disabled={state === 'loading' || state === 'saving'}
      onClick={change}
    >
      <span className="sound-toggle-title" aria-hidden="true">{t.dailyTitle}</span>
      <span className="sound-toggle-state" aria-hidden="true">{state === 'loading' || state === 'saving' ? '…' : enabled ? t.on : t.off}</span>
    </button>
    {state === 'error' && <p className="profile-setting-error" role="alert">{t.saveError}</p>}
  </>;
}

type DeleteState = 'idle' | 'confirm' | 'deleting' | 'error';

/** Удаление аккаунта: требование App Store и Google Play. Два шага, чтобы не стереть случайным тапом. */
export function DeleteAccountSection({ onDeleted = () => window.location.reload() }: { onDeleted?: () => void }) {
  const t = useMessages(m);
  const [state, setState] = useState<DeleteState>('idle');
  const remove = () => {
    setState('deleting');
    deleteAccount().then(onDeleted, () => setState('error'));
  };

  if (state === 'idle') {
    return (
      <button type="button" className="profile-delete-link" onClick={() => setState('confirm')}>
        {t.deleteAccount}
      </button>
    );
  }
  return (
    <div className="profile-delete-box" role="group" aria-label={t.deleteGroup}>
      <p className="profile-delete-text">
        {t.deleteText}
      </p>
      {state === 'error' && <p className="profile-setting-error" role="alert">{t.deleteError}</p>}
      <div className="profile-delete-actions">
        <button type="button" className="profile-delete-confirm" disabled={state === 'deleting'} onClick={remove}>
          {state === 'deleting' ? t.deleting : t.deleteForever}
        </button>
        <button type="button" className="profile-delete-cancel" disabled={state === 'deleting'} onClick={() => setState('idle')}>
          {t.cancel}
        </button>
      </div>
    </div>
  );
}

export function ProfileView({ playerName, state, onRetry, telegram = false, clanEmoji = null, onClan }: ProfileViewProps) {
  const t = useMessages(m);
  const c = useMessages(clanMessages);
  const empty = state.status === 'ready' && state.profile.completedRuns === 0;

  return (
    <section className="profile-screen root-tab">
      <div className="profile-head">
        <span className="profile-avatar" aria-hidden="true"><PlayerAvatar seed={playerName} emoji={clanEmoji} /></span>
        <h1 className="profile-name">{playerName}</h1>
        <p className="profile-tag">{t.tag}</p>
        {onClan && (
          <button type="button" className="profile-clan-link" onClick={onClan}>
            {clanEmoji ? `${c.profileClan} ${clanEmoji}` : c.homeClaim} ›
          </button>
        )}
      </div>

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
          <div className="home-stats-card">
            <div className="mini-stat">
              <span className="mini-stat-value">{state.profile.completedRuns}</span>
              <span className="mini-stat-label">{t.runs}</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{state.profile.reachedTargetRuns}</span>
              <span className="mini-stat-label">{t.finishes}</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">
                {state.profile.bestRounds === null ? '–' : soloRoundsText(state.profile.bestRounds)}
              </span>
              <span className="mini-stat-label">{t.bestFinish}</span>
            </div>
          </div>
          {empty && <p className="profile-tag">{t.empty}</p>}
          {state.profile.streak && (
            <div className="home-stats-card profile-streak">
              <div className="mini-stat">
                <span className="mini-stat-value">🔥 {state.profile.streak.current}</span>
                <span className="mini-stat-label">{t.streakNow}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat-value">{daysText(state.profile.streak.best)}</span>
                <span className="mini-stat-label">{t.streakBest}</span>
              </div>
            </div>
          )}
          {state.profile.level && <LevelBar level={state.profile.level} />}
          {state.profile.achievements && <AchievementGrid achievements={state.profile.achievements} />}
        </>
      )}

      <LanguageSetting />
      <RegionSetting />
      <h2 className="section-heading">{t.settings}</h2>
      <SoundToggle variant="profile" />
      {telegram
        ? <DailyNotificationsToggle />
        : <p className="profile-tag">{t.telegramOnly}</p>}
      <DeleteAccountSection />
      {/* Карточку-приглашение в клан рисует сервер картинками Twemoji: лицензия просит указать авторство. */}
      {/* Часть вопросов из Open Trivia Database: CC BY-SA 4.0 требует указать источник. */}
      <p className="profile-credit">
        <a href="https://opentdb.com/" target="_blank" rel="noreferrer">{t.triviaCredit}</a>
      </p>
      {clansEnabled() && (
        <p className="profile-credit">
          <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noreferrer">{t.emojiCredit}</a>
        </p>
      )}
    </section>
  );
}

export function Profile({ onClan }: { onClan?: () => void } = {}) {
  const t = useMessages(m);
  const clan = useMyClan();
  const [state, setState] = useState<ProfileState>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const playerName = getTelegramIdentity()?.displayName || t.player;
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
      clanEmoji={clan.me?.clan?.emoji ?? null}
      onClan={onClan}
    />
  );
}
