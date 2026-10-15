import { isBestAnswerOfDay, type TiebreakerAnsweredView } from '@clutch/shared';
import { chooseShareStrategy, executeShare, type ShareEffects, type ShareResult } from './share';
import { formatMultiplier } from './tiebreakerView';

/**
 * Текст «Поделиться результатом» в духе Wordle: номер вопроса, промах и, если есть, место среди
 * ответивших. Своего числа и правильного ответа в тексте нет: иначе ссылка выдаёт вопрос тем,
 * кто ещё не отвечал. Перцентиль — только когда сервер его прислал; при «лучшем ответе» — вместо него.
 */
export function buildTiebreakerShareText(
  number: number,
  answered: Pick<TiebreakerAnsweredView, 'multiplier' | 'percentile'>,
): string {
  const parts = [`На глазок #${number}`, `промах ${formatMultiplier(answered.multiplier)}`];
  if (isBestAnswerOfDay(answered.percentile)) parts.push('лучший ответ дня');
  else if (answered.percentile !== null) parts.push(`точнее ${answered.percentile}%`);
  return parts.join(' · ');
}

/**
 * Куда зовёт ссылка: бот приложения (VITE_TELEGRAM_BOT_LINK), а без него — адрес самой страницы.
 * Страница /api/share для этого не годится: она рисует карточку матча (проценты и исход).
 */
export function resolveGameLink(botLink: string | undefined, origin: string): string {
  const link = botLink?.trim();
  return link || origin;
}

export interface TiebreakerShareEnvironment {
  telegramShare: boolean;
  nativeShare: boolean;
  effects: ShareEffects;
}

/** Выбор способа и отправка: Telegram → navigator.share → копирование в буфер. */
export function shareTiebreakerResult(
  number: number,
  answered: Pick<TiebreakerAnsweredView, 'multiplier' | 'percentile'>,
  url: string,
  env: TiebreakerShareEnvironment,
): Promise<ShareResult> {
  return executeShare(
    chooseShareStrategy({ telegramShare: env.telegramShare, nativeShare: env.nativeShare }),
    { text: buildTiebreakerShareText(number, answered), url },
    env.effects,
  );
}
