import { useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE, isLocale, localeFromLanguageCode, type Locale } from '@clutch/shared';
import { getTelegramIdentity } from '../platform/telegram';

/**
 * Язык игры на этом устройстве. Выбирается при первом входе (экран выбора) и в профиле;
 * уходит серверу заголовком X-Clutch-Locale, чтобы вопросы и разбор пришли на нём.
 */
const STORAGE_KEY = 'clutch_locale_v1';
const listeners = new Set<() => void>();
let memory: Locale | null = null;

function stored(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return memory;
  }
}

/** Язык, который предложить первым: из Telegram, иначе из браузера. */
export function suggestedLocale(): Locale {
  const telegram = getTelegramIdentity()?.languageCode;
  if (telegram) return localeFromLanguageCode(telegram);
  // Без браузера (тесты, серверный рендер) — исходный язык контента.
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return DEFAULT_LOCALE;
  return localeFromLanguageCode(navigator.language);
}

/** Игрок уже выбрал язык (иначе показываем экран выбора). */
export function hasChosenLocale(): boolean {
  return stored() !== null || memory !== null;
}

export function currentLocale(): Locale {
  return stored() ?? memory ?? suggestedLocale();
}

export function setLocale(locale: Locale): void {
  memory = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Без хранилища язык живёт до перезагрузки.
  }
  document.documentElement.lang = locale;
  listeners.forEach((listener) => listener());
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentLocale,
    () => DEFAULT_LOCALE,
  );
}
