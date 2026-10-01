import { useEffect, useState } from 'react';
import App from './App';
import { initializeTelegram } from './lib/telegram';
import {
  observeTelegramInitialization,
  type TelegramBootstrapResult,
} from './lib/bootstrap';

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
