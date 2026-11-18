import { LOCALE_NAMES, LOCALES, type Locale } from '@clutch/shared';
import { setLocale, suggestedLocale, useLocale } from '../../i18n/locale';
import { defineMessages, useMessages } from '../../i18n/messages';

const m = defineMessages({
  ru: { profileTitle: 'Язык', current: 'сейчас' },
  en: { profileTitle: 'Language', current: 'current' },
  kk: { profileTitle: 'Тіл', current: 'қазір' },
});

/** Казахский первым: основная аудитория — Казахстан. */
const ORDER: readonly Locale[] = ['kk', 'ru', 'en'];

/**
 * Первый вход: язык ещё не выбран. Заголовок сразу на трёх языках — игрок ещё не сказал, какой читает.
 * Предложенный (по языку Telegram) выделен, но выбор за игроком.
 */
export function FirstLaunchLanguage({ onChosen }: { onChosen: () => void }) {
  const suggested = suggestedLocale();
  return (
    <main className="app-shell language-screen">
      <div className="language-card">
        <span className="language-logo" aria-hidden="true">C</span>
        <h1 className="language-title">
          Тілді таңдаңыз
          <span>Выберите язык · Choose your language</span>
        </h1>
        <div className="language-options" role="group" aria-label="Тіл / Язык / Language">
          {ORDER.map((locale) => (
            <button
              key={locale}
              type="button"
              className={`language-option${locale === suggested ? ' suggested' : ''}`}
              lang={locale}
              onClick={() => { setLocale(locale); onChosen(); }}
            >
              {LOCALE_NAMES[locale]}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

/** Выбор языка в профиле. Новый язык применяется перезагрузкой: экраны и вопросы приходят заново. */
export function LanguageSetting({ onChange = () => window.location.reload() }: { onChange?: () => void }) {
  const t = useMessages(m);
  const active = useLocale();
  return (
    <div className="language-setting">
      <h2 className="section-heading">{t.profileTitle}</h2>
      <div className="language-segments" role="radiogroup" aria-label={t.profileTitle}>
        {ORDER.filter((locale) => LOCALES.includes(locale)).map((locale) => (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={locale === active}
            className={`language-segment${locale === active ? ' active' : ''}`}
            lang={locale}
            onClick={() => {
              if (locale === active) return;
              setLocale(locale);
              onChange();
            }}
          >
            {LOCALE_NAMES[locale]}
          </button>
        ))}
      </div>
    </div>
  );
}
