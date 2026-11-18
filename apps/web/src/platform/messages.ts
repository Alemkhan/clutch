import { defineMessages } from '../i18n/messages';

/** rival: «Имя» в кавычках или null — тогда «соперник». */
export const m = defineMessages({
  ru: {
    shareLocal: (p: number, o: number) => `Потренировался в Clutch: ${p}% против ${o}%. Это тренировка, результат не сохранён. Сыграем?`,
    shareWin: (rival: string | null, p: number, o: number) => `Клатч! Обыграл ${rival ?? 'соперником'} в Clutch: ${p}% против ${o}%. Попробуешь лучше?`,
    shareTie: (rival: string | null, p: number, o: number) => `Ничья с ${rival ?? 'соперником'} в Clutch: ${p}% на ${o}%. Кто возьмёт перевес?`,
    shareLoss: (rival: string | null, p: number, o: number) => `Почти! Уступил ${rival ?? 'соперником'} в Clutch: ${p}% против ${o}%. Попробуешь лучше?`,
    friendInvite: 'Обгони мой результат в Clutch',
  },
  en: {
    shareLocal: (p: number, o: number) => `Practiced in Clutch: ${p}% vs ${o}%. Just training, the result isn't saved. Want to play?`,
    shareWin: (rival: string | null, p: number, o: number) => `Clutch! Beat ${rival ?? 'my opponent'} in Clutch: ${p}% vs ${o}%. Can you do better?`,
    shareTie: (rival: string | null, p: number, o: number) => `A tie with ${rival ?? 'my opponent'} in Clutch: ${p}% to ${o}%. Who'll break it?`,
    shareLoss: (rival: string | null, p: number, o: number) => `So close! Lost to ${rival ?? 'my opponent'} in Clutch: ${p}% vs ${o}%. Can you do better?`,
    friendInvite: 'Beat my score in Clutch',
  },
  kk: {
    shareLocal: (p: number, o: number) => `Clutch-та жаттықтым: ${p}% қарсы ${o}%. Бұл жаттығу, нәтиже сақталмады. Ойнаймыз ба?`,
    shareWin: (rival: string | null, p: number, o: number) => `Клатч! Clutch-та ${rival ? `${rival} ойыншысын` : 'қарсыласымды'} ұттым: ${p}% қарсы ${o}%. Сен жақсырақ ойнай аласың ба?`,
    shareTie: (rival: string | null, p: number, o: number) => `Clutch-та ${rival ? `${rival} ойыншысымен` : 'қарсыласыммен'} тең түстім: ${p}% мен ${o}%. Кім басым түседі?`,
    shareLoss: (rival: string | null, p: number, o: number) => `Аз қалды! Clutch-та ${rival ? `${rival} ойыншысына` : 'қарсыласыма'} жеңілдім: ${p}% қарсы ${o}%. Сен жақсырақ ойнай аласың ба?`,
    friendInvite: 'Clutch-тағы нәтижемді озып көр',
  },
});
