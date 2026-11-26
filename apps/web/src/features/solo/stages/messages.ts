import type { MiniGameId } from '@clutch/shared';
import { defineMessages, plural } from '../../../i18n/messages';

const ruRounds = (n: number) => `${n} ${plural('ru', n, ['круг', 'круга', 'кругов'])}`;
const enRounds = (n: number) => `${n} ${plural('en', n, ['round', 'rounds'])}`;
const kkRounds = (n: number) => `${n} ${plural('kk', n, ['айналым'])}`;

export const m = defineMessages({
  ru: {
    miniGameLabel: 'Мини-игра этой партии',
    miniGameTitle: (id: MiniGameId): string => (id === 'tower_stack' ? 'Башня' : 'Молоток'),
    miniGameRule: (id: MiniGameId): string =>
      id === 'tower_stack'
        ? 'Урони блок ровно на башню: чем точнее совпадение, тем больше прогресса.'
        : 'Останови молоток точно над гвоздём: чем точнее удар, тем больше прогресса.',
    loadingTitle: 'Готовим забег',
    loadingQuestions: 'Загружаем вопросы',
    errorTitle: 'Забег не начался',
    retry: 'Повторить',
    resumeNote: (played: number, progress: number, target: number) =>
      `Продолжаем: сыграно ${ruRounds(played)}, ${progress}% из ${target}%.`,
    restart: 'Начать заново',
    resume: 'Продолжить',
    start: 'Начать',
    closing: 'Закрываем…',
    practiceEyebrow: (name: string) => `Тренировка · ${name}`,
    practiceResumedTitle: 'Продолжаем тренировку',
    allReady: 'Всё готово',
    practiceAgainst: (who: string) => `Против: ${who}. Не засчитывается.`,
    bot: 'бот',
    paceReleased:
      'Соперник отпущен: тебя долго не было, и его запись забрал другой игрок. Забег продолжается один и сам станет записью для следующего.',
    modeDaily: 'Забег дня',
    modeFree: 'Свободная игра',
    modeDuel: 'Дуэль',
    readyVsRecord: (name: string, target: number, finish: number) =>
      `${name}: ${target}% за ${ruRounds(finish)}. Успей быстрее.`,
    readyDaily: (target: number, cap: number) => `Общий набор дня, в таблицу идёт первая попытка. До ${target}% за ${cap} кругов.`,
    readyFree: (target: number, cap: number) => `Новые вопросы, вне таблицы. До ${target}% за ${cap} кругов.`,
    readyDuel: (target: number, cap: number) => `Соперника пока нет: твой забег станет вызовом. До ${target}% за ${cap} кругов.`,
    readyDefault: (target: number, cap: number) => `До ${target}% за ${cap} кругов.`,
    groupChallenge: 'Вызов друзьям',
    friendChallenge: 'Вызов друга',
    run: 'Забег',
    abandonDaily: 'Бросить и выбрать категорию',
    otherCategories: 'Другие категории',
    checkingAnswer: 'Проверяем ответ',
    countingStrike: 'Засчитываем удар',
    exit: 'Выйти',
    abandonFailed: 'Не удалось закрыть забег. Попробуй ещё раз.',
    exitConfirmLabel: 'Подтверждение выхода',
    exitDuel: 'Выйти из дуэли? Это засчитается поражением.',
    exitRun: 'Выйти и закрыть текущий забег?',
    confirmExit: 'Подтвердить выход',
  },
  en: {
    miniGameLabel: "This match's mini-game",
    miniGameTitle: (id: MiniGameId) => (id === 'tower_stack' ? 'Tower' : 'Hammer'),
    miniGameRule: (id: MiniGameId) =>
      id === 'tower_stack'
        ? 'Drop the block right onto the tower: the better the fit, the more progress.'
        : 'Stop the hammer right over the nail: the more precise the hit, the more progress.',
    loadingTitle: 'Getting the run ready',
    loadingQuestions: 'Loading questions',
    errorTitle: "The run didn't start",
    retry: 'Try again',
    resumeNote: (played: number, progress: number, target: number) =>
      `Picking up: ${enRounds(played)} played, ${progress}% of ${target}%.`,
    restart: 'Start over',
    resume: 'Continue',
    start: 'Start',
    closing: 'Closing…',
    practiceEyebrow: (name: string) => `Training · ${name}`,
    practiceResumedTitle: 'Back to training',
    allReady: 'All set',
    practiceAgainst: (who: string) => `Against: ${who}. Doesn't count.`,
    bot: 'bot',
    paceReleased:
      'Opponent released: you were away too long, so another player took their record. The run goes on solo and will become a record for the next player.',
    modeDaily: 'Daily run',
    modeFree: 'Free play',
    modeDuel: 'Duel',
    readyVsRecord: (name: string, target: number, finish: number) =>
      `${name}: ${target}% in ${enRounds(finish)}. Be faster.`,
    readyDaily: (target: number, cap: number) =>
      `Today's shared set, only your first try goes on the leaderboard. Reach ${target}% in ${enRounds(cap)}.`,
    readyFree: (target: number, cap: number) => `Fresh questions, off the leaderboard. Reach ${target}% in ${enRounds(cap)}.`,
    readyDuel: (target: number, cap: number) =>
      `No opponent yet: your run will become the challenge. Reach ${target}% in ${enRounds(cap)}.`,
    readyDefault: (target: number, cap: number) => `Reach ${target}% in ${enRounds(cap)}.`,
    groupChallenge: 'Challenge friends',
    friendChallenge: "A friend's challenge",
    run: 'Run',
    abandonDaily: 'Drop it and pick a category',
    otherCategories: 'Other categories',
    checkingAnswer: 'Checking the answer',
    countingStrike: 'Counting the hit',
    exit: 'Exit',
    abandonFailed: "Couldn't close the run. Try again.",
    exitConfirmLabel: 'Confirm exit',
    exitDuel: 'Leave the duel? It will count as a loss.',
    exitRun: 'Exit and close the current run?',
    confirmExit: 'Confirm exit',
  },
  kk: {
    miniGameLabel: 'Осы ойынның мини-ойыны',
    miniGameTitle: (id: MiniGameId) => (id === 'tower_stack' ? 'Мұнара' : 'Балға'),
    miniGameRule: (id: MiniGameId) =>
      id === 'tower_stack'
        ? 'Блокты дәл мұнараның үстіне түсір: неғұрлым дәл түссе, соғұрлым прогресс көп.'
        : 'Балғаны шегенің дәл үстінде тоқтат: соққы неғұрлым дәл болса, соғұрлым прогресс көп.',
    loadingTitle: 'Жарысты дайындап жатырмыз',
    loadingQuestions: 'Сұрақтар жүктелуде',
    errorTitle: 'Жарыс басталмады',
    retry: 'Қайталау',
    resumeNote: (played: number, progress: number, target: number) =>
      `Жалғастырамыз: ${kkRounds(played)} ойналды, ${target}%-дан ${progress}%.`,
    restart: 'Қайта бастау',
    resume: 'Жалғастыру',
    start: 'Бастау',
    closing: 'Жабылуда…',
    practiceEyebrow: (name: string) => `Жаттығу · ${name}`,
    practiceResumedTitle: 'Жаттығуды жалғастырамыз',
    allReady: 'Бәрі дайын',
    practiceAgainst: (who: string) => `Қарсылас: ${who}. Есепке алынбайды.`,
    bot: 'бот',
    paceReleased:
      'Қарсылас босатылды: сен ұзақ болмадың, оның жазбасын басқа ойыншы алды. Жарыс жалғыз жалғасады және келесі ойыншы үшін жазбаға айналады.',
    modeDaily: 'Күн жарысы',
    modeFree: 'Еркін ойын',
    modeDuel: 'Дуэль',
    readyVsRecord: (name: string, target: number, finish: number) =>
      `${name}: ${kkRounds(finish)} ішінде ${target}%. Одан тез үлгер.`,
    readyDaily: (target: number, cap: number) =>
      `Күннің ортақ жинағы, кестеге тек алғашқы әрекет түседі. ${kkRounds(cap)} ішінде ${target}%-ға жет.`,
    readyFree: (target: number, cap: number) => `Жаңа сұрақтар, кестеден тыс. ${kkRounds(cap)} ішінде ${target}%-ға жет.`,
    readyDuel: (target: number, cap: number) =>
      `Әзірге қарсылас жоқ: сенің жарысың шақыруға айналады. ${kkRounds(cap)} ішінде ${target}%-ға жет.`,
    readyDefault: (target: number, cap: number) => `${kkRounds(cap)} ішінде ${target}%-ға жет.`,
    groupChallenge: 'Достарға шақыру',
    friendChallenge: 'Досыңның шақыруы',
    run: 'Жарыс',
    abandonDaily: 'Тастап, санат таңдау',
    otherCategories: 'Басқа санаттар',
    checkingAnswer: 'Жауапты тексеріп жатырмыз',
    countingStrike: 'Соққыны есептеп жатырмыз',
    exit: 'Шығу',
    abandonFailed: 'Жарысты жабу мүмкін болмады. Қайталап көр.',
    exitConfirmLabel: 'Шығуды растау',
    exitDuel: 'Дуэльден шығасың ба? Бұл жеңіліс болып есептеледі.',
    exitRun: 'Шығып, ағымдағы жарысты жабасың ба?',
    confirmExit: 'Шығуды растау',
  },
});
