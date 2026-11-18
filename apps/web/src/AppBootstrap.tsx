import { useEffect, useState } from 'react';
import App from './App';
import { getTelegramIdentity, initializeTelegram } from './platform/telegram';
import {
  observeTelegramInitialization,
  type TelegramBootstrapResult,
} from './app/bootstrap';
import { installSoundUnlock } from './platform/sounds';
import { fetchPlayerSettings, logAnalyticsEvent } from './platform/api';
import { readLaunchIntent } from './app/launchIntent';
import { hasChosenLocale } from './i18n/locale';
import { FirstLaunchLanguage } from './features/language/LanguagePicker';
import { useMessages } from './i18n/messages';
import { m } from './messages';

let appOpenedSent = false;

/** Раз за загрузку страницы. Дружеская ссылка и реванш делят один формат, поэтому по ссылке entry = rematch. */
export function trackAppOpened(): void {
  if (appOpenedSent) return;
  appOpenedSent = true;
  const intent = readLaunchIntent();
  logAnalyticsEvent('app_opened', {
    source: getTelegramIdentity() ? 'telegram' : 'browser',
    entry: intent?.type === 'rematch' ? 'rematch'
      : intent?.type === 'daily-tiebreaker' || intent?.type === 'daily-wiki-path' ? 'daily_message'
        : 'direct',
  });
}

export const TELEGRAM_BOOTSTRAP_TIMEOUT_MS = 2_500;

export function LoadingShell() {
  const t = useMessages(m);
  return (
    <main className="app-shell bootstrap-loading" aria-busy="true">
      <div className="bootstrap-loading-card" role="status">
        <span className="bootstrap-spinner" aria-hidden="true" />
        <span>{t.loading}</span>
      </div>
    </main>
  );
}

export default function AppBootstrap() {
  const t = useMessages(m);
  const [result, setResult] = useState<TelegramBootstrapResult | 'loading'>('loading');
  // Язык выбирают один раз, до первого экрана: вопросы и интерфейс сразу на нём.
  const [languageChosen, setLanguageChosen] = useState(hasChosenLocale);

  useEffect(() => observeTelegramInitialization(
    initializeTelegram(),
    setResult,
    TELEGRAM_BOOTSTRAP_TIMEOUT_MS,
  ), []);

  useEffect(() => installSoundUnlock(), []);

  useEffect(() => {
    if (result !== 'loading') trackAppOpened();
  }, [result]);

  // Сервер запоминает язык игрока (сообщения бота) и обновляет автоматическую гео-зону.
  useEffect(() => {
    if (result !== 'loading' && languageChosen) fetchPlayerSettings().catch(() => {});
  }, [result, languageChosen]);

  if (result === 'loading') return <LoadingShell />;
  if (!languageChosen) return <FirstLaunchLanguage onChosen={() => setLanguageChosen(true)} />;

  return (
    <>
      <App />
      {result !== 'ready' && (
        <div className="bootstrap-status" role="status">
          {result === 'timeout'
            ? t.telegramSlow
            : t.telegramFailed}
        </div>
      )}
    </>
  );
}
