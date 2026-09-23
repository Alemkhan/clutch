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
let initialized = false;

export async function initializeTelegram(): Promise<void> {
  if (initialized || !isTMA()) return;
  initialized = true;
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

  if (mountViewport.isAvailable()) {
    try {
      await mountViewport();
      if (bindViewportCssVars.isAvailable()) bindViewportCssVars();
      if (expandViewport.isAvailable()) expandViewport();
    } catch {
      // Older Telegram clients may not expose viewport methods.
    }
  }

  if (miniAppReady.isAvailable()) miniAppReady();
}

export function getTelegramIdentity(): TelegramIdentity | null {
  return identity;
}
