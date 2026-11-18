import { DEFAULT_LOCALE, isLocale, type CategoryId, type Locale } from '@clutch/shared';
import type { ShareOutcome } from './cardLayout';

/**
 * Тексты карточек и страниц шаринга на языке игрока. Язык приходит параметром `l` ссылки
 * (ru|en|kk): его ставит клиент, а ссылку открывает уже получатель, поэтому заголовок
 * X-Clutch-Locale здесь не годится. Неизвестный или пустой `l` — русский.
 */
export function shareLocale(raw: string | undefined | null): Locale {
  const value = raw?.trim().toLowerCase();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Статичная картинка на языке: русская — исходный файл, остальные — рядом с суффиксом языка
 * (`/og.png` → `/og.en.png`, `/share/win.png` → `/share/win.kk.png`). Файлы собираются из
 * scripts/share-cards.
 */
export function localizedAsset(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return path;
  return path.replace(/(\.[a-z0-9]+)$/u, `.${locale}$1`);
}

function ruPlural(count: number, forms: readonly [string, string, string]): string {
  const tens = Math.abs(count) % 100;
  const ones = Math.abs(count) % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (ones === 1) return forms[0];
  if (ones >= 2 && ones <= 4) return forms[1];
  return forms[2];
}

const commaMultiplier = (value: number): string => {
  if (value >= 1000) return `×${Math.round(value).toLocaleString('ru-RU').replace(/\s/g, ' ')}`;
  return `×${value.toFixed(1).replace('.', ',')}`;
};

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];

export interface ShareDictionary {
  htmlLang: Locale;
  openInTelegram: string;
  playInTelegram: string;
  playClutch: string;
  opponentFallback: string;
  categories: Record<CategoryId, string>;
  /** «17 окт», «Oct 17», «17 қазан». */
  date: (month: number, day: number) => string;
  rounds: (count: number) => string;
  /** «100% за 5 кругов». */
  result: (progress: number, rounds: string) => string;
  /** Подпись под крупным процентом: «за 5 кругов». */
  inRounds: (rounds: string) => string;
  runKicker: string;
  inviteKicker: (name: string | null) => string;
  callFaster: string;
  callReach: string;
  callInvite: string;
  tilesCaption: string;
  runTitle: (result: string, category: string) => string;
  inviteTitle: (name: string | null, result: string) => string;
  runDescription: string;
  guess: {
    mode: string;
    kickerBest: string;
    kickerMiss: string;
    kickerPercentile: string;
    bigBest: string;
    underBest: string;
    underMiss: string;
    underPercentile: string;
    missLabel: (multiplier: string) => string;
    answer: string;
    myGuess: string;
    call: string;
    titleBest: (number: number) => string;
    titleMiss: (number: number, multiplier: string) => string;
    titlePercentile: (number: number, percentile: number) => string;
    description: string;
  };
  multiplier: (value: number) => string;
  brand: { caption: string; line1: string; line2: string; side1: string; side2: string; call: string };
  outcome: {
    headline: Record<ShareOutcome, string>;
    me: string;
    hint: string;
    call: string;
    description: string;
    title: (outcome: ShareOutcome, p: number, q: number, name: string | null) => string;
  };
}

const ru: ShareDictionary = {
  htmlLang: 'ru',
  openInTelegram: 'Открыть в Telegram',
  playInTelegram: 'Играть в Telegram',
  playClutch: 'Играть в Clutch',
  opponentFallback: 'Соперник',
  categories: {
    general: 'Общие знания',
    geography: 'География',
    history: 'Другие флаги',
    languages: 'Языки',
    kz_history: 'История Казахстана',
  },
  date: (month, day) => `${day} ${RU_MONTHS[month - 1]}`,
  rounds: (count) => `${count} ${ruPlural(count, ['круг', 'круга', 'кругов'])}`,
  result: (progress, rounds) => `${progress}% за ${rounds}`,
  inRounds: (rounds) => `за ${rounds}`,
  runKicker: 'Мой результат дня',
  inviteKicker: (name) => (name ? `${name} зовёт на дуэль` : 'Тебя зовут на дуэль'),
  callFaster: 'Сможешь быстрее?',
  callReach: 'Дойдёшь до 100%?',
  callInvite: 'Обгонишь эту запись?',
  tilesCaption: 'Круг — верный ответ и удар молотком',
  runTitle: (result, category) => `${result} · ${category}`,
  inviteTitle: (name, result) => (name ? `${name} зовёт на дуэль: ${result}` : `Дуэль в Clutch: обгони ${result}`),
  runDescription: 'Ответь верно — получи удар молотком. Точнее удар — быстрее до 100%. Сегодня у всех один набор вопросов.',
  guess: {
    mode: 'На глазок',
    kickerBest: 'Ближе всех за день',
    kickerMiss: 'Мой промах',
    kickerPercentile: 'Мой ответ точнее, чем у',
    bigBest: 'Лучший',
    underBest: 'ответ дня',
    underMiss: 'от правильного ответа',
    underPercentile: 'игроков',
    missLabel: (multiplier) => `промах ${multiplier}`,
    answer: 'ответ',
    myGuess: 'моя догадка',
    call: 'Угадаешь точнее?',
    titleBest: (number) => `На глазок #${number}: лучший ответ дня`,
    titleMiss: (number, multiplier) => `На глазок #${number}: промах ${multiplier}`,
    titlePercentile: (number, percentile) => `На глазок #${number}: точнее ${percentile}% игроков`,
    description: 'Вопрос дня без вариантов: угадай число. Чем меньше промах, тем выше в таблице.',
  },
  multiplier: commaMultiplier,
  brand: {
    caption: 'Викторина на каждый день',
    line1: 'Ответь верно.',
    line2: 'Попади в центр.',
    side1: 'Точнее удар —',
    side2: 'быстрее до 100%',
    call: 'Одни вопросы для всех',
  },
  outcome: {
    headline: { win: 'Я вытащил клатч!', loss: 'Почти получилось!', tie: 'Ничья' },
    me: 'Я',
    hint: 'у всех один набор вопросов',
    call: 'Сыграешь лучше?',
    description: 'Ответь верно — получи попытку. Забей точнее — выиграй матч. Сегодня у всех один набор вопросов.',
    title: (outcome, p, q, name) => {
      if (name) {
        if (outcome === 'win') return `Обыграл ${name}: ${p}% против ${q}%`;
        if (outcome === 'loss') return `Уступил ${name}: ${p}% против ${q}%`;
        return `Ничья с ${name}: ${p}:${q}`;
      }
      if (outcome === 'tie') return `Ничья: ${p}:${q}`;
      return `Мой результат: ${p}% против ${q}%`;
    },
  },
};

const en: ShareDictionary = {
  htmlLang: 'en',
  openInTelegram: 'Open in Telegram',
  playInTelegram: 'Play in Telegram',
  playClutch: 'Play Clutch',
  opponentFallback: 'Opponent',
  categories: {
    general: 'General knowledge',
    geography: 'Geography',
    history: 'Other flags',
    languages: 'Languages',
    kz_history: 'History of Kazakhstan',
  },
  date: (month, day) => `${EN_MONTHS[month - 1]} ${day}`,
  rounds: (count) => `${count} ${count === 1 ? 'round' : 'rounds'}`,
  result: (progress, rounds) => `${progress}% in ${rounds}`,
  inRounds: (rounds) => `in ${rounds}`,
  runKicker: 'My result today',
  inviteKicker: (name) => (name ? `${name} challenges you` : 'You’re invited to a duel'),
  callFaster: 'Can you do it faster?',
  callReach: 'Can you reach 100%?',
  callInvite: 'Can you beat this score?',
  tilesCaption: 'Round = right answer + hammer hit',
  runTitle: (result, category) => `${result} · ${category}`,
  inviteTitle: (name, result) => (name ? `${name} challenges you to a duel: ${result}` : `Clutch duel: beat ${result}`),
  runDescription: 'Answer right to earn a hammer hit. The more precise the hit, the faster you reach 100%. Everyone gets the same questions today.',
  guess: {
    mode: 'Guesstimate',
    kickerBest: 'Closest of the day',
    kickerMiss: 'My miss',
    kickerPercentile: 'My answer was closer than',
    bigBest: 'Best',
    underBest: 'answer of the day',
    underMiss: 'off the right answer',
    underPercentile: 'of players',
    missLabel: (multiplier) => `miss ${multiplier}`,
    answer: 'answer',
    myGuess: 'my guess',
    call: 'Can you guess closer?',
    titleBest: (number) => `Guesstimate #${number}: best answer of the day`,
    titleMiss: (number, multiplier) => `Guesstimate #${number}: miss ${multiplier}`,
    titlePercentile: (number, percentile) => `Guesstimate #${number}: closer than ${percentile}% of players`,
    description: 'Question of the day with no options: guess the number. The smaller your miss, the higher you rank.',
  },
  multiplier: (value) => (value >= 1000 ? `×${Math.round(value).toLocaleString('en-US')}` : `×${value.toFixed(1)}`),
  brand: {
    caption: 'A quiz for every day',
    line1: 'Answer right.',
    line2: 'Hit the center.',
    side1: 'Sharper hit —',
    side2: 'faster to 100%',
    call: 'Same questions for all',
  },
  outcome: {
    headline: { win: 'I pulled off the clutch!', loss: 'So close!', tie: 'It’s a tie' },
    me: 'Me',
    hint: 'same questions for everyone',
    call: 'Can you do better?',
    description: 'Answer right to earn a shot. Hit more precisely to win the match. Everyone gets the same questions today.',
    title: (outcome, p, q, name) => {
      if (name) {
        if (outcome === 'win') return `Beat ${name}: ${p}% vs ${q}%`;
        if (outcome === 'loss') return `Lost to ${name}: ${p}% vs ${q}%`;
        return `Tie with ${name}: ${p}:${q}`;
      }
      if (outcome === 'tie') return `Tie: ${p}:${q}`;
      return `My result: ${p}% vs ${q}%`;
    },
  },
};

const kk: ShareDictionary = {
  htmlLang: 'kk',
  openInTelegram: 'Telegram-да ашу',
  playInTelegram: 'Telegram-да ойна',
  playClutch: 'Clutch ойнау',
  opponentFallback: 'Қарсылас',
  categories: {
    general: 'Жалпы білім',
    geography: 'География',
    history: 'Басқа жалаулар',
    languages: 'Тілдер',
    kz_history: 'Қазақстан тарихы',
  },
  date: (month, day) => `${day} ${KK_MONTHS[month - 1]}`,
  // Қазақшада сан есімнен кейін зат есім өзгермейді: «1 айналым», «5 айналым».
  rounds: (count) => `${count} айналым`,
  result: (progress, rounds) => `${rounds} ішінде ${progress}%`,
  inRounds: (rounds) => `${rounds} ішінде`,
  runKicker: 'Менің бүгінгі нәтижем',
  inviteKicker: (name) => (name ? `${name} дуэльге шақырады` : 'Сені дуэльге шақырады'),
  callFaster: 'Жылдамырақ өте аласың ба?',
  callReach: '100%-ға жете аласың ба?',
  callInvite: 'Бұл нәтижені оза аласың ба?',
  tilesCaption: 'Айналым — дұрыс жауап пен балға соққысы',
  runTitle: (result, category) => `${result} · ${category}`,
  inviteTitle: (name, result) => (name ? `${name} дуэльге шақырады: ${result}` : `Clutch дуэлі: ${result} нәтижесін оз`),
  runDescription: 'Дұрыс жауап бер — балға соққысын ал. Соққы дәл болса, 100%-ға тезірек жетесің. Бүгін барлығына бір сұрақтар жинағы.',
  guess: {
    mode: 'Көзмөлшер',
    kickerBest: 'Күннің ең жақын жауабы',
    kickerMiss: 'Менің қателігім',
    kickerPercentile: 'Менің жауабым',
    bigBest: 'Үздік',
    underBest: 'күннің жауабы',
    underMiss: 'дұрыс жауаптан',
    underPercentile: 'ойыншыдан дәлірек',
    missLabel: (multiplier) => `қателік ${multiplier}`,
    answer: 'жауап',
    myGuess: 'менің болжамым',
    call: 'Дәлірек табасың ба?',
    titleBest: (number) => `Көзмөлшер #${number}: күннің ең үздік жауабы`,
    titleMiss: (number, multiplier) => `Көзмөлшер #${number}: қателік ${multiplier}`,
    titlePercentile: (number, percentile) => `Көзмөлшер #${number}: ойыншылардың ${percentile}%-ынан дәлірек`,
    description: 'Нұсқасыз күн сұрағы: санды тап. Қателігің неғұрлым аз болса, кестеде соғұрлым жоғарысың.',
  },
  multiplier: commaMultiplier,
  brand: {
    caption: 'Күн сайынғы викторина',
    line1: 'Дұрыс жауап бер.',
    line2: 'Ортаға дәл тигіз.',
    side1: 'Соққы дәл болса —',
    side2: '100%-ға тезірек',
    call: 'Барлығына бір сұрақтар',
  },
  outcome: {
    headline: { win: 'Клатч менікі!', loss: 'Аз қалды!', tie: 'Тең түстік' },
    me: 'Мен',
    hint: 'барлығына бір сұрақтар жинағы',
    call: 'Жақсырақ ойнай аласың ба?',
    description: 'Дұрыс жауап бер — соққы ал. Дәлірек соқ — матчты ұт. Бүгін барлығына бір сұрақтар жинағы.',
    title: (outcome, p, q, name) => {
      if (name) {
        if (outcome === 'win') return `${name} ойыншысын ұттым: ${p}% қарсы ${q}%`;
        if (outcome === 'loss') return `${name} ойыншысына жеңілдім: ${p}% қарсы ${q}%`;
        return `${name} ойыншысымен тең: ${p}:${q}`;
      }
      if (outcome === 'tie') return `Тең: ${p}:${q}`;
      return `Менің нәтижем: ${p}% қарсы ${q}%`;
    },
  },
};

export const SHARE_TEXT: Readonly<Record<Locale, ShareDictionary>> = { ru, en, kk };

export function shareText(locale: Locale): ShareDictionary {
  return SHARE_TEXT[locale];
}
