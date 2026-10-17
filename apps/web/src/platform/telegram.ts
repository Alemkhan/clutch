import {
  bindMiniAppCssVars,
  bindViewportCssVars,
  expandViewport,
  init,
  initDataUser,
  isTMA,
  miniAppReady,
  openLink,
  mountMiniAppSync,
  mountViewport,
  restoreInitData,
  retrieveRawInitData,
  shareMessage,
  shareURL,
} from '@telegram-apps/sdk-react';

interface TelegramIdentity {
  initData: string;
  displayName: string;
}

let identity: TelegramIdentity | null = null;
let initializationPromise: Promise<void> | null = null;
let coreInitializationPromise: Promise<void> | null = null;
let viewportInitializationPromise = Promise.resolve();

function runTelegramInitialization(): void {
  if (!isTMA()) return;
  init();
  restoreInitData();

  const raw = retrieveRawInitData();
  const user = initDataUser();
  if (raw && user) {
    identity = {
      initData: raw,
      displayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
    };
  }

  if (mountMiniAppSync.isAvailable()) mountMiniAppSync();
  if (bindMiniAppCssVars.isAvailable()) bindMiniAppCssVars();
  if (miniAppReady.isAvailable()) miniAppReady();

  if (mountViewport.isAvailable()) {
    try {
      viewportInitializationPromise = mountViewport().then(() => {
        if (bindViewportCssVars.isAvailable()) bindViewportCssVars();
        if (expandViewport.isAvailable()) expandViewport();
      }).catch(() => {
        // Older Telegram clients may reject viewport requests.
      });
    } catch {
      // Older Telegram clients may not expose viewport methods.
      viewportInitializationPromise = Promise.resolve();
    }
  }
}

export function whenTelegramCoreReady(): Promise<void> {
  coreInitializationPromise ??= Promise.resolve().then(runTelegramInitialization);
  return coreInitializationPromise;
}

export function initializeTelegram(): Promise<void> {
  initializationPromise ??= whenTelegramCoreReady().then(() => viewportInitializationPromise);
  return initializationPromise;
}

export function getTelegramIdentity(): TelegramIdentity | null {
  return identity;
}

/** Внешняя ссылка: в Telegram открывается его встроенным браузером, а не уводит Mini App. false — открывать обычной ссылкой. */
export function openExternalLink(url: string): boolean {
  if (!isTMA() || !openLink.isAvailable()) return false;
  try {
    openLink(url);
    return true;
  } catch {
    return false;
  }
}

export function canShareViaTelegram(): boolean {
  return isTMA() && shareURL.isAvailable();
}

/** Отправка подготовленного ботом сообщения (Mini Apps 8.0+): карточка и кнопка «Играть». */
export function canShareMessage(): boolean {
  return isTMA() && shareMessage.isAvailable();
}

/** USER_DECLINED — человек закрыл окно сам: это отмена, а не повод открывать второе окно. */
export async function shareMessageViaTelegram(id: string): Promise<'shared' | 'cancelled' | 'failed'> {
  if (!shareMessage.isAvailable()) return 'failed';
  try {
    await shareMessage(id);
    return 'shared';
  } catch (error) {
    return error instanceof Error && error.message.includes('USER_DECLINED') ? 'cancelled' : 'failed';
  }
}

export function shareViaTelegram(url: string, text: string): boolean {
  if (!shareURL.isAvailable()) return false;
  shareURL(url, text);
  return true;
}
