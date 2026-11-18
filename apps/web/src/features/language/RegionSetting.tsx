import { useEffect, useState } from 'react';
import type { PlayerSettingsResponse, Region } from '@clutch/shared';
import { fetchPlayerSettings, setPlayerRegion } from '../../platform/api';
import { defineMessages, useMessages } from '../../i18n/messages';

const m = defineMessages({
  ru: {
    title: 'Регион вопросов',
    hint: 'Местные вопросы — для своего региона. Набор дня у всех общий.',
    auto: (region: string) => `Авто (${region})`,
    kz: 'Казахстан', cis: 'СНГ', world: 'Мир',
    error: 'Не удалось сохранить. Попробуй ещё раз.',
  },
  en: {
    title: 'Question region',
    hint: 'Local questions are for your region. The daily set is the same for everyone.',
    auto: (region: string) => `Auto (${region})`,
    kz: 'Kazakhstan', cis: 'CIS', world: 'World',
    error: 'Couldn’t save. Try again.',
  },
  kk: {
    title: 'Сұрақтар өңірі',
    hint: 'Жергілікті сұрақтар — өз өңіріңе. Күн жинағы бәріне ортақ.',
    auto: (region: string) => `Авто (${region})`,
    kz: 'Қазақстан', cis: 'ТМД', world: 'Әлем',
    error: 'Сақтау мүмкін болмады. Қайталап көр.',
  },
});

type Choice = Region | 'auto';
const CHOICES: readonly Choice[] = ['auto', 'kz', 'cis', 'world'];

/** Гео-зона в профиле: по умолчанию по стране подключения, можно закрепить вручную. */
export function RegionSetting() {
  const t = useMessages(m);
  const [settings, setSettings] = useState<PlayerSettingsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchPlayerSettings(controller.signal).then((next) => setSettings(next), () => {});
    return () => controller.abort();
  }, []);

  if (!settings) return null;
  const active: Choice = settings.regionSource === 'auto' ? 'auto' : settings.region;
  const label = (choice: Choice) => (choice === 'auto' ? t.auto(t[settings.detectedRegion]) : t[choice]);
  const pick = (choice: Choice) => {
    if (choice === active) return;
    setError(false);
    setPlayerRegion(choice).then(setSettings, () => setError(true));
  };

  return (
    <div className="language-setting">
      <h2 className="section-heading">{t.title}</h2>
      <div className="language-segments region-segments" role="radiogroup" aria-label={t.title}>
        {CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={choice === active}
            className={`language-segment${choice === active ? ' active' : ''}`}
            onClick={() => pick(choice)}
          >
            {label(choice)}
          </button>
        ))}
      </div>
      <p className="profile-tag">{t.hint}</p>
      {error && <p className="profile-setting-error" role="alert">{t.error}</p>}
    </div>
  );
}
