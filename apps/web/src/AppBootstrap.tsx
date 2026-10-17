import { useEffect, useState } from 'react';
import App from './App';
import { getTelegramIdentity, initializeTelegram } from './platform/telegram';
import {
  observeTelegramInitialization,
  type TelegramBootstrapResult,
} from './app/bootstrap';
import { installSoundUnlock } from './platform/sounds';
import { logAnalyticsEvent } from './platform/api';
import { readLaunchIntent } from './app/launchIntent';

let appOpenedSent = false;

/** Раз за загрузку страницы. Дружеская ссылка и реванш делят один формат, поэтому по ссылке entry = rematch. */
export function trackAppOpened(): void {
  if (appOpenedSent) return;
  appOpenedSent = true;
  const intent = readLaunchIntent();
  logAnalyticsEvent('app_opened', {
    source: getTelegramIdentity() ? 'telegram' : 'browser',
    entry: intent?.type === 'rematch' ? 'rematch' : 'direct',
  });
}

export const TELEGRAM_BOOTSTRAP_TIMEOUT_MS = 2_500;

export function LoadingShell() {
  return (
    <main className="app-shell bootstrap-loading" aria-busy="true">
      <div className="bootstrap-loading-card" role="status">
        <span className="bootstrap-spinner" aria-hidden="true" />
        <span>Запускаем Clutch…</span>
      </div>
    </main>
  );
}

export default function AppBootstrap() {
  const [result, setResult] = useState<TelegramBootstrapResult | 'loading'>('loading');

  useEffect(() => observeTelegramInitialization(
    initializeTelegram(),
    setResult,
    TELEGRAM_BOOTSTRAP_TIMEOUT_MS,
  ), []);

  useEffect(() => installSoundUnlock(), []);

  useEffect(() => {
    if (result !== 'loading') trackAppOpened();
  }, [result]);

  if (result === 'loading') return <LoadingShell />;

  return (
    <>
      <App />
      {result !== 'ready' && (
        <div className="bootstrap-status" role="status">
          {result === 'timeout'
            ? 'Telegram отвечает медленно. Игра уже доступна.'
            : 'Не удалось подключить Telegram. Игра доступна в обычном режиме.'}
        </div>
      )}
    </>
  );
}
