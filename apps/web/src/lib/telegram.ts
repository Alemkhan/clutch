import {
  bindMiniAppCssVars,
  bindViewportCssVars,
  expandViewport,
  init,
  initDataUser,
  isTMA,
  miniAppReady,
  mountMiniAppSync,
  mountViewport,
  restoreInitData,
  retrieveRawInitData,
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
