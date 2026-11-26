import type { Locale } from '@clutch/shared';

/** «2 дня», «5 дней», «21 день», «11 дней». */
function ruDays(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  const word = tens >= 11 && tens <= 14 ? 'дней' : ones === 1 ? 'день' : ones >= 2 && ones <= 4 ? 'дня' : 'дней';
  return `${count} ${word}`;
}

const commaMultiplier = (value: number): string => `×${value.toFixed(1).replace('.', ',')}`;

const ru = {
  streakDays: ruDays,
  formatMultiplier: commaMultiplier,
  opponentFallback: 'Соперник',
  categoryNames: {
    general: 'Общие знания',
    geography: 'География',
    history: 'Другие флаги',
    languages: 'Языки',
    kz_history: 'История Казахстана',
  } as Record<string, string>,
  categoryFallback: 'Категория',
  // daily
  dailyHeader: 'Новый день в Clutch',
  dailyStreak: (days: string) => `🔥 Серия ${days} подряд. Сыграй забег дня сегодня, чтобы её не прервать.`,
  dailyTiebreaker: (n: number) => `👁 «На глазок» #${n} уже вышел.`,
  dailyWikiPath: (start: string, target: string): string => `🔗 Вики-путь: ${start} → ${target}.`,
  btnTiebreaker: 'На глазок',
  btnWikiPath: 'Вики-путь',
  btnDailyRun: '🔥 Забег дня',
  btnDailyStop: 'Отключить ежедневные сообщения',
  // outbid / top ten
  btnStop: 'Не присылать такие сообщения',
  btnRematch: 'Сыграть реванш',
  btnPlayMore: 'Сыграть ещё набор',
  btnOpenApp: 'Открыть Clutch',
  rematchOffer: (name: string) => `${name} зовёт на реванш: вопросы будут новые.`,
  tbVerdictWon: 'победа ваша',
  tbVerdictLost: (name: string) => `${name} оказался ближе`,
  tbBoth: (own: string, other: string, verdict: string) => `Ничья по забегу, но «На глазок» ${own} против ${other}: ${verdict}.`,
  tbOnlyYou: (verdict: string) => `Ничья по забегу, но «На глазок» ответили только вы: ${verdict}.`,
  tbOnlyThem: (name: string, verdict: string) => `Ничья по забегу, но «На глазок» ответил только ${name}: ${verdict}.`,
  soloWon: (name: string) => `Ваша запись устояла: ${name} не смог её обойти.`,
  soloLost: (name: string) => `${name} обошёл вашу запись.`,
  soloTie: (name: string) => `Ничья с ${name}: результаты сравнялись.`,
  friendlySuffix: 'Дружеская игра, не в зачёт.',
  duelWon: (name: string) => `${name} сыграл вашу запись по ссылке и не смог её обойти.`,
  duelLost: (name: string) => `${name} обошёл вашу запись по ссылке.`,
  duelTie: (name: string) => `Ничья с ${name} на вашей записи.`,
  outOfTopReasonGuess: ': при равных кругах прикидка «На глазок» точнее',
  outOfTop: (name: string, board: string, reason: string) =>
    `${name} выбил вас из первой десятки таблицы дня «${board}»${reason}. Сыграйте ещё набор, чтобы вернуться.`,
};

export type NotificationDict = typeof ru;

const en = {
  streakDays: (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`,
  formatMultiplier: (value: number) => `×${value.toFixed(1)}`,
  opponentFallback: 'Opponent',
  categoryNames: {
    general: 'General knowledge',
    geography: 'Geography',
    history: 'Other flags',
    languages: 'Languages',
    kz_history: 'History of Kazakhstan',
  } as Record<string, string>,
  categoryFallback: 'Category',
  dailyHeader: 'A new day in Clutch',
  dailyStreak: (days: string) => `🔥 ${days} streak. Play the Daily run today to keep it going.`,
  dailyTiebreaker: (n: number) => `👁 “Guesstimate” #${n} is out.`,
  dailyWikiPath: (_start: string, _target: string): string => "🔗 Today's Wiki path is ready.",
  btnTiebreaker: 'Guesstimate',
  btnWikiPath: 'Wiki path',
  btnDailyRun: '🔥 Daily run',
  btnDailyStop: 'Turn off daily messages',
  btnStop: "Don't send messages like this",
  btnRematch: 'Play the rematch',
  btnPlayMore: 'Play another set',
  btnOpenApp: 'Open Clutch',
  rematchOffer: (name: string) => `${name} challenges you to a rematch with new questions.`,
  tbVerdictWon: 'you win',
  tbVerdictLost: (name: string) => `${name} was closer`,
  tbBoth: (own: string, other: string, verdict: string) => `The run was a draw, but on “Guesstimate” it was ${own} vs ${other}: ${verdict}.`,
  tbOnlyYou: (verdict: string) => `The run was a draw, but only you made a Guesstimate: ${verdict}.`,
  tbOnlyThem: (name: string, verdict: string) => `The run was a draw, but only ${name} made a Guesstimate: ${verdict}.`,
  soloWon: (name: string) => `Your record held: ${name} couldn't beat it.`,
  soloLost: (name: string) => `${name} beat your record.`,
  soloTie: (name: string) => `A draw with ${name}: the results are equal.`,
  friendlySuffix: "Friendly game, doesn't count.",
  duelWon: (name: string) => `${name} played your record via your link and couldn't beat it.`,
  duelLost: (name: string) => `${name} beat your record via your link.`,
  duelTie: (name: string) => `A draw with ${name} on your record.`,
  outOfTopReasonGuess: ': with equal rounds, their Guesstimate was closer',
  outOfTop: (name: string, board: string, reason: string) =>
    `${name} knocked you out of the top ten of the Daily leaderboard “${board}”${reason}. Play another set to get back in.`,
} satisfies NotificationDict;

const kk = {
  streakDays: (count: number) => `${count} күн`,
  formatMultiplier: commaMultiplier,
  opponentFallback: 'Қарсылас',
  categoryNames: {
    general: 'Жалпы білім',
    geography: 'География',
    history: 'Басқа жалаулар',
    languages: 'Тілдер',
    kz_history: 'Қазақстан тарихы',
  } as Record<string, string>,
  categoryFallback: 'Санат',
  dailyHeader: 'Clutch-та жаңа күн',
  dailyStreak: (days: string) => `🔥 Қатарынан ${days}. Серияны үзбеу үшін бүгін күн жарысын ойнаңыз.`,
  dailyTiebreaker: (n: number) => `👁 «Көзмөлшер» #${n} шықты.`,
  dailyWikiPath: (_start: string, _target: string): string => '🔗 Бүгінгі Уики-жол дайын.',
  btnTiebreaker: 'Көзмөлшер',
  btnWikiPath: 'Уики-жол',
  btnDailyRun: '🔥 Күн жарысы',
  btnDailyStop: 'Күнделікті хабарларды өшіру',
  btnStop: 'Мұндай хабарларды жібермеу',
  btnRematch: 'Реванш ойнау',
  btnPlayMore: 'Тағы бір жиынтық ойнау',
  btnOpenApp: 'Clutch-ты ашу',
  rematchOffer: (name: string) => `${name} реваншқа шақырады: сұрақтар жаңа болады.`,
  tbVerdictWon: 'жеңіс сіздікі',
  tbVerdictLost: (name: string) => `${name} жақынырақ болды`,
  tbBoth: (own: string, other: string, verdict: string) => `Жарыс тең аяқталды, бірақ «Көзмөлшер» ${own} мен ${other}: ${verdict}.`,
  tbOnlyYou: (verdict: string) => `Жарыс тең аяқталды, бірақ «Көзмөлшерге» тек сіз жауап бердіңіз: ${verdict}.`,
  tbOnlyThem: (name: string, verdict: string) => `Жарыс тең аяқталды, бірақ «Көзмөлшерге» тек ${name} жауап берді: ${verdict}.`,
  soloWon: (name: string) => `Сіздің рекордыңыз сақталды: ${name} оны баса алмады.`,
  soloLost: (name: string) => `${name} сіздің рекордыңызды басып озды.`,
  soloTie: (name: string) => `${name} екеуіңіз тең: нәтижелер бірдей.`,
  friendlySuffix: 'Достық ойын, есепке алынбайды.',
  duelWon: (name: string) => `${name} сілтеме арқылы сіздің рекордыңызды ойнады, бірақ баса алмады.`,
  duelLost: (name: string) => `${name} сілтеме арқылы сіздің рекордыңызды басып озды.`,
  duelTie: (name: string) => `${name} екеуіңіз сіздің рекордыңызда тең түстіңіз.`,
  outOfTopReasonGuess: ': айналымдар тең болғанда «Көзмөлшер» дәлірек болды',
  outOfTop: (name: string, board: string, reason: string) =>
    `${name} сізді «${board}» күн кестесінің алғашқы ондығынан ығыстырды${reason}. Қайта оралу үшін тағы бір жиынтық ойнаңыз.`,
} satisfies NotificationDict;

export const NOTIFICATION_TEXT: Record<Locale, NotificationDict> = { ru, en, kk };
