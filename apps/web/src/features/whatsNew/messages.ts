import { CLANS_FROM, type Locale } from '@clutch/shared';
import { defineMessages } from '../../i18n/messages';

export const m = defineMessages({
  ru: { close: 'Понятно, играть', clansTitle: 'Новое в Clutch: кланы', clansAction: 'Занять своё эмодзи', later: 'Позже' },
  en: { close: 'Got it, play', clansTitle: 'New in Clutch: clans', clansAction: 'Claim my emoji', later: 'Later' },
  kk: { close: 'Түсінікті, ойнаймыз', clansTitle: 'Clutch-та жаңа: кландар', clansAction: 'Өз эмодзиімді алу', later: 'Кейін' },
});

export interface WhatsNewItem {
  icon: string;
  title: string;
  text: string;
  /** День, с которого пункт показывается (свой выпуск «Что нового»); без него — релиз WHATS_NEW_RELEASE. */
  since?: string;
}

/** Тексты «Что нового» по языкам; версия релиза живёт в WhatsNew.tsx. */
export const WHATS_NEW_TEXT: Record<Locale, { title: string; items: readonly WhatsNewItem[] }> = {
  ru: {
    title: 'Что нового в Clutch',
    items: [
      { icon: '🦆', since: CLANS_FROM, title: 'Кланы-эмодзи', text: 'Займи своё эмодзи — каждое существует один раз. Заражай друзей ссылкой и сражайся в недельной войне кланов. Один клан навсегда.' },
      { icon: '🌍', title: 'Три языка', text: 'Clutch теперь на русском, казахском и английском — вопросы, ответы и бот. Язык меняется в профиле.' },
      { icon: '🎨', title: 'Новый вид', text: 'Тёмный дизайн без вспышек, объёмные кнопки и зверьки-аватары у каждого игрока.' },
      { icon: '🔥', title: 'Серия дней', text: 'Играй забег дня каждый день — огонёк на главной растёт. Пропуск сбрасывает серию.' },
      { icon: '⭐', title: 'Уровни и достижения', text: 'Опыт за верные ответы и финиши, 14 достижений в профиле. Нажми на любое — узнаешь, как его получить.' },
      { icon: '🔨', title: 'Молоток стал сложнее', text: 'Зоны уже, маркер быстрее, серия ударов сжимает зоны сильнее. Точность снова решает.' },
      { icon: '🔔', title: 'Напоминание одной кнопкой', text: 'После забега можно включить сообщение о новом наборе — и не дать серии сгореть.' },
      { icon: '🟩', title: 'Результат сеткой', text: '«Поделиться» отправляет номер дня и сетку кругов, как в Wordle.' },
      { icon: '🏴', title: 'Честные «Другие флаги»', text: 'Подписи на гербах скрыты в вопросе, оригинал — после ответа.' },
      { icon: '📚', title: 'Без однообразия', text: 'Вопросы одной темы больше не идут подряд, и в наборе не больше трёх на тему.' },
    ],
  },
  en: {
    title: "What's new in Clutch",
    items: [
      { icon: '🦆', since: CLANS_FROM, title: 'Emoji clans', text: 'Claim your emoji — each one exists only once. Infect friends with your link and fight in the weekly clan war. One clan forever.' },
      { icon: '🌍', title: 'Three languages', text: 'Clutch now speaks Russian, Kazakh and English — questions, answers and the bot. Change it in your profile.' },
      { icon: '🎨', title: 'A new look', text: 'A calm dark design, chunky buttons and critter avatars for every player.' },
      { icon: '🔥', title: 'Day streak', text: 'Play the daily run every day and the flame on the home screen grows. Skip a day and the streak resets.' },
      { icon: '⭐', title: 'Levels and achievements', text: 'XP for right answers and finishes, 14 achievements in your profile. Tap any to see how to unlock it.' },
      { icon: '🔨', title: 'Hammer got harder', text: 'Narrower zones, faster marker, and strike streaks shrink zones more. Precision matters again.' },
      { icon: '🔔', title: 'One-tap reminder', text: "After a run you can turn on a message about the new set so your streak doesn't burn." },
      { icon: '🟩', title: 'Results as a grid', text: '“Share” sends the day number and a grid of your rounds, like Wordle.' },
      { icon: '🏴', title: 'Fair “Other flags”', text: 'Labels on coats of arms are hidden in the question; the original shows after you answer.' },
      { icon: '📚', title: 'More variety', text: 'Questions on one topic no longer come back to back, and a set has at most three per topic.' },
    ],
  },
  kk: {
    title: 'Clutch-та не жаңа',
    items: [
      { icon: '🦆', since: CLANS_FROM, title: 'Эмодзи-кландар', text: 'Өз эмодзиіңді ал — әрқайсысы бір-ақ рет болады. Достарыңды сілтемемен шақырып, апталық кландар соғысында жеңіске жет. Бір клан мәңгілікке.' },
      { icon: '🌍', title: 'Үш тіл', text: 'Clutch енді қазақ, орыс және ағылшын тілдерінде — сұрақтар, жауаптар және бот. Тілді профильде ауыстыруға болады.' },
      { icon: '🎨', title: 'Жаңа көрініс', text: 'Көзге жайлы күңгірт дизайн, көлемді батырмалар және әр ойыншыға аң-аватар.' },
      { icon: '🔥', title: 'Күндер сериясы', text: 'Күн жарысын күн сайын ойна — басты беттегі от өседі. Бір күн өткізсең, серия нөлденеді.' },
      { icon: '⭐', title: 'Деңгейлер мен жетістіктер', text: 'Дұрыс жауаптар мен мәреге жеткенің үшін тәжірибе, профильде 14 жетістік. Кез келгенін бассаң, қалай алуға болатынын білесің.' },
      { icon: '🔨', title: 'Балға қиындады', text: 'Аймақтар тарырақ, маркер жылдамырақ, соққылар сериясы аймақтарды көбірек қысады. Дәлдік қайтадан шешеді.' },
      { icon: '🔔', title: 'Бір батырмамен еске салу', text: 'Жарыстан кейін жаңа жинақ туралы хабарды қосып, серияның үзілуіне жол бермеуге болады.' },
      { icon: '🟩', title: 'Нәтиже тор түрінде', text: '«Бөлісу» күн нөмірі мен айналымдар торын жібереді, Wordle сияқты.' },
      { icon: '🏴', title: 'Әділ «Басқа жалаулар»', text: 'Елтаңбалардағы жазулар сұрақта жасырылады, түпнұсқасы — жауаптан кейін.' },
      { icon: '📚', title: 'Біркелкіліксіз', text: 'Бір тақырыптағы сұрақтар енді қатарынан келмейді, жинақта бір тақырыпқа үштен көп емес.' },
    ],
  },
};
