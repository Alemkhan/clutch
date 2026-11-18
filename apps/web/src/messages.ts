import { defineMessages } from './i18n/messages';

export const m = defineMessages({
  ru: {
    loading: 'Запускаем Clutch…',
    telegramSlow: 'Telegram отвечает медленно. Игра уже доступна.',
    telegramFailed: 'Не удалось подключить Telegram. Игра доступна в обычном режиме.',
  },
  en: {
    loading: 'Starting Clutch…',
    telegramSlow: 'Telegram is responding slowly. The game is already available.',
    telegramFailed: "Couldn't connect to Telegram. The game works in regular mode.",
  },
  kk: {
    loading: 'Clutch іске қосылуда…',
    telegramSlow: 'Telegram баяу жауап береді. Ойын қазірдің өзінде қолжетімді.',
    telegramFailed: 'Telegram-ға қосылу мүмкін болмады. Ойын әдеттегі режимде қолжетімді.',
  },
});
