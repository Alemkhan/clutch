import { useEffect, useState } from 'react';
import type { PlayerAchievement, PlayerLevel, PlayerStreak, SoloProfileResponse } from '@clutch/shared';
import { fetchDailyNotifications, fetchSoloProfile, setDailyNotifications } from '../../platform/api';
import { ensureBotCanWrite, getTelegramIdentity } from '../../platform/telegram';
import { messagesFor, useMessages } from '../../i18n/messages';
import { m } from './messages';

/** «1 день», «3 дня», «7 дней». */
export function daysText(count: number): string {
  return messagesFor(m).days(count);
}

/** Профиль с прогрессом для главной: null, пока не загрузился или сервер старый. */
export function usePlayerProgress(refreshKey = 0): SoloProfileResponse | null {
  const [profile, setProfile] = useState<SoloProfileResponse | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchSoloProfile(controller.signal).then(
      (next) => { if (!controller.signal.aborted) setProfile(next); },
      () => {},
    );
    return () => controller.abort();
  }, [refreshKey]);
  return profile;
}

/** Огонёк серии в шапке. Ноль не показываем: пустая серия ничего не обещает. */
export function StreakBadge({ streak }: { streak: PlayerStreak }) {
  const t = useMessages(m);
  if (streak.current < 1) return null;
  const atRisk = !streak.playedToday;
  return (
    <span
      className={`streak-badge${atRisk ? ' at-risk' : ''}`}
      aria-label={t.streakAria(t.days(streak.current), atRisk)}
    >
      <span aria-hidden="true">🔥</span> {streak.current}
    </span>
  );
}

/** Подсказка под главной карточкой: серия сгорит в полночь, если не сыграть. */
export function StreakHint({ streak }: { streak: PlayerStreak }) {
  const t = useMessages(m);
  if (streak.playedToday || streak.current < 1) return null;
  return (
    <p className="streak-hint" role="status">
      <span aria-hidden="true">🔥</span> {t.streakHint(t.days(streak.current))}
    </p>
  );
}

export function LevelBar({ level }: { level: PlayerLevel }) {
  const t = useMessages(m);
  const percent = Math.round((level.xpIntoLevel / level.xpForLevel) * 100);
  return (
    <div className="level-bar">
      <div className="level-bar-head">
        <strong>{t.level(level.level)}</strong>
        <span>{t.xp(level.xpIntoLevel, level.xpForLevel)}</span>
      </div>
      <div
        className="level-bar-track"
        role="progressbar"
        aria-label={t.levelAria(level.level, level.xpIntoLevel, level.xpForLevel)}
        aria-valuemin={0}
        aria-valuemax={level.xpForLevel}
        aria-valuenow={level.xpIntoLevel}
      >
        <span className="level-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="level-bar-note">{t.xpNote}</p>
    </div>
  );
}

/** Что открыть дальше: прогресс словами для карточки достижения. */
export function achievementStatus(achievement: PlayerAchievement): string {
  const t = messagesFor(m);
  if (achievement.unlocked) return t.unlocked;
  return achievement.goal > 1 ? t.progressOf(achievement.value, achievement.goal) : t.notYetUnlocked;
}

export function AchievementGrid({ achievements }: { achievements: PlayerAchievement[] }) {
  const t = useMessages(m);
  const [selectedId, setSelectedId] = useState<PlayerAchievement['id'] | null>(null);
  const unlocked = achievements.filter((achievement) => achievement.unlocked).length;
  const selected = achievements.find((achievement) => achievement.id === selectedId) ?? null;
  return (
    <section className="achievements" aria-label={t.achievements}>
      <h2 className="section-heading">{t.achievements} <span className="achievements-count">{t.countOf(unlocked, achievements.length)}</span></h2>
      <ul className="achievements-grid">
        {achievements.map((achievement) => (
          <li key={achievement.id}>
            <button
              type="button"
              className={`achievement${achievement.unlocked ? ' unlocked' : ''}${achievement.id === selectedId ? ' selected' : ''}`}
              aria-pressed={achievement.id === selectedId}
              aria-controls="achievement-detail"
              onClick={() => setSelectedId((current) => (current === achievement.id ? null : achievement.id))}
            >
              <span className="achievement-icon" aria-hidden="true">{achievement.icon}</span>
              <strong className="achievement-title">{achievement.title}</strong>
              <span className="achievement-meta">
                {achievement.unlocked ? t.unlocked : achievement.goal > 1 ? `${achievement.value} / ${achievement.goal}` : t.notUnlocked}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="achievement-hint">{t.achievementHint}</p>
      {/* Панель снизу экрана: видна, где бы ни была плитка, а не под сеткой за краем экрана. */}
      {selected && (
        <div className="achievement-sheet-backdrop" onClick={() => setSelectedId(null)}>
          <div
            id="achievement-detail"
            className={`achievement-detail achievement-sheet${selected.unlocked ? ' unlocked' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={selected.title}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="achievement-detail-icon" aria-hidden="true">{selected.icon}</span>
            <div className="achievement-detail-text">
              <strong>{selected.title}</strong>
              <p>{selected.description}</p>
              <span className="achievement-detail-status">{achievementStatus(selected)}</span>
            </div>
            <button type="button" className="achievement-sheet-close" aria-label={t.close} onClick={() => setSelectedId(null)}>×</button>
          </div>
        </div>
      )}
    </section>
  );
}

type ReminderState = 'hidden' | 'offer' | 'saving' | 'on' | 'declined' | 'error';

/**
 * Предложение напоминаний после забега. Раньше переключатель жил только в профиле, и включили его
 * трое: здесь одна кнопка в момент, когда игроку интересно, что будет завтра. Только в Telegram.
 */
export function DailyReminderOffer() {
  const t = useMessages(m);
  const [state, setState] = useState<ReminderState>('hidden');

  useEffect(() => {
    if (!getTelegramIdentity()) return;
    const controller = new AbortController();
    fetchDailyNotifications(controller.signal).then(
      ({ enabled }) => { if (!controller.signal.aborted && !enabled) setState('offer'); },
      () => {},
    );
    return () => controller.abort();
  }, []);

  if (state === 'hidden') return null;
  if (state === 'on') {
    return <p className="reminder-offer done" role="status">{t.reminderDone}</p>;
  }

  const enable = async () => {
    setState('saving');
    if (!(await ensureBotCanWrite())) {
      setState('declined');
      return;
    }
    setDailyNotifications(true).then(() => setState('on'), () => setState('error'));
  };

  return (
    <div className="reminder-offer" role="group" aria-label={t.reminderAria}>
      <p className="reminder-offer-text">
        <strong>{t.reminderLead}</strong> {t.reminderText}
      </p>
      {state === 'declined' && <p className="profile-setting-error" role="alert">{t.reminderDeclined}</p>}
      {state === 'error' && <p className="profile-setting-error" role="alert">{t.reminderError}</p>}
      <button type="button" className="cta-btn reminder-offer-btn" disabled={state === 'saving'} onClick={() => { void enable(); }}>
        {state === 'saving' ? t.reminderSaving : t.reminderButton}
      </button>
    </div>
  );
}

/** Открыто в обычном браузере, а не в Telegram и не в приложении из магазина (Capacitor). */
export function isPlainBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  return !getTelegramIdentity() && !(window as { Capacitor?: unknown }).Capacitor;
}

/**
 * Заход по прямой ссылке на сайт: 34 таких гостя открыли главную один раз и ушли. Говорим прямо,
 * где живёт игра и что даёт Telegram (сохранение, таблица под своим именем, напоминания).
 */
export function TelegramBanner({ botLink }: { botLink?: string }) {
  const t = useMessages(m);
  if (!botLink || !isPlainBrowser()) return null;
  return (
    <a className="telegram-banner" href={botLink} target="_blank" rel="noreferrer">
      <span className="telegram-banner-text">
        <strong>{t.telegramTitle}</strong>
        <span>{t.telegramText}</span>
      </span>
      <span aria-hidden="true">→</span>
    </a>
  );
}
