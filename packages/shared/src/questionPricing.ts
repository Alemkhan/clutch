import { SKILL_REWARDS } from './hammerRules';
import type { Question } from './index';
import { SOLO_TARGET_PROGRESS } from './soloRun';

/*
 * Цена вопроса — оценка по формату, а не по конкретной стране: сложности самой
 * сущности («Франция» против «Сан-Томе и Принсипи») в данных нет, в `Country` нет такого поля.
 */

export type QuestionFormat =
  | 'choice_text'
  | 'choice_flag'
  | 'choice_outline'
  | 'open_text'
  | 'open_flag'
  | 'open_outline';

/**
 * Доли верных ответов: замер docs/PLAYTEST_01.md (86 прохождений, 389 ответов) по **географии**.
 * Цена вопроса выводится только из формата, поэтому трудность конкретной записи в неё не входит:
 * «столица Франции» и редкая запись пакета общих знаний стоят одинаково.
 * Пересчитать по настоящим кругам: `npm run calibrate:pricing`.
 */
const CORRECT_RATE: Record<QuestionFormat, number> = {
  choice_text: 105 / 158,
  choice_flag: 77 / 135,
  choice_outline: 16 / 37,
  open_flag: 13 / 24,
  open_text: 9 / 19,
  // 0 из 16: поправка Лапласа 0.5/17, иначе логит ушёл бы в бесконечность.
  open_outline: 0.5 / 17,
};

/**
 * Распределение удара эталонного игрока при верном ответе.
 *
 * **Замер устарел и известно, насколько.** Он сделан до R5d, когда зона идеального попадания была
 * 0.15, а скорость маркера постоянной 0.8. Сейчас зона 0.06, скорость 0.6–1.6, и идеальных ударов
 * примерно 21% вместо 60%. Значит средняя награда ниже заложенной на 12–22%, то есть пар набора
 * занижен, а «1.0 = сыграл как эталон» перестало быть правдой: у эталона сейчас выходит 1.0–1.25.
 *
 * Почему не поправлено: нового замера на людях нет, а подставить оценку вместо замера — обменять
 * известную ошибку на неизвестную. Порядок в таблице это не ломает: внутри набора пар у всех один.
 * Пересчитать, когда наберутся круги: `npm run calibrate:pricing` (он же скажет, хватает ли их).
 */
const SKILL_SHARE = { perfect: 0.6, great: 0.33, good: 0.04, weak: 0.01, miss: 0.02 } as const;

/** Средняя награда за верный ответ по замеру выше: 21.47 очка. */
export const MEAN_REWARD_PER_CORRECT =
  SKILL_SHARE.perfect * SKILL_REWARDS.perfect +
  SKILL_SHARE.great * SKILL_REWARDS.great +
  SKILL_SHARE.good * SKILL_REWARDS.good +
  SKILL_SHARE.weak * SKILL_REWARDS.weak +
  SKILL_SHARE.miss * SKILL_REWARDS.miss;

export function questionFormat(question: Question): QuestionFormat {
  const kind = question.answerType === 'open_answer' ? 'open' : 'choice';
  const media = question.mediaType === 'flag' || question.mediaType === 'outline' ? question.mediaType : 'text';
  return `${kind}_${media}` as QuestionFormat;
}

/** Сложность в логитах; больше — труднее. */
export function questionDifficulty(question: Question): number {
  const rate = CORRECT_RATE[questionFormat(question)];
  return -Math.log(rate / (1 - rate));
}

/** Вероятность верного ответа эталонного игрока. */
function referenceCorrectProbability(question: Question): number {
  return 1 / (1 + Math.exp(questionDifficulty(question)));
}

/**
 * За сколько кругов набор закрыл бы эталонный игрок: номер круга, на котором накопленный
 * ожидаемый прогресс достигает цели. Не закрывается — `questions.length + 1`. Больше — труднее набор.
 */
export function setPar(questions: readonly Question[], target: number = SOLO_TARGET_PROGRESS): number {
  let expected = 0;
  for (let index = 0; index < questions.length; index += 1) {
    expected += referenceCorrectProbability(questions[index]) * MEAN_REWARD_PER_CORRECT;
    if (expected >= target) return index + 1;
  }
  return questions.length + 1;
}

/** Результат относительно пара: меньше — лучше. 1.0 = сыграл как эталон. */
export function soloScore(rounds: number, par: number): number {
  if (!Number.isFinite(rounds) || rounds < 0) {
    throw new RangeError('rounds must be a finite non-negative number');
  }
  if (!Number.isFinite(par) || par <= 0) {
    throw new RangeError('par must be a finite positive number');
  }
  return rounds / par;
}
