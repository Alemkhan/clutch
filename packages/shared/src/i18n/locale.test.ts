import { describe, expect, it } from 'vitest';
import { isEverywhere, isLocale, localeFromLanguageCode, regionFromCountry } from './locale';

describe('locale and region', () => {
  it('maps Telegram language codes to the three app languages', () => {
    expect(localeFromLanguageCode('kk')).toBe('kk');
    expect(localeFromLanguageCode('ru-RU')).toBe('ru');
    expect(localeFromLanguageCode('uz')).toBe('ru');
    expect(localeFromLanguageCode('en-US')).toBe('en');
    expect(localeFromLanguageCode('de')).toBe('en');
    expect(localeFromLanguageCode(undefined)).toBe('ru');
    expect(isLocale('kk')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });

  it('puts the connection country into Kazakhstan, the CIS or the world', () => {
    expect(regionFromCountry('KZ')).toBe('kz');
    expect(regionFromCountry('ru')).toBe('cis');
    expect(regionFromCountry('UZ')).toBe('cis');
    expect(regionFromCountry('US')).toBe('world');
    expect(regionFromCountry(null)).toBe('world');
  });

  it('treats only all-zone questions as available everywhere', () => {
    expect(isEverywhere(['kz', 'cis', 'world'])).toBe(true);
    expect(isEverywhere(['kz', 'cis'])).toBe(false);
  });
});
