import { isBestAnswerOfDay, type TiebreakerAnsweredView } from '@clutch/shared';
import { chooseShareStrategy, executeShare, type ShareEffects, type ShareResult } from '../../platform/share';
import { formatMultiplier } from './tiebreakerView';
import { messagesFor } from '../../i18n/messages';
import { m } from './messages';

/**
 * Текст «Поделиться результатом» в духе Wordle: номер вопроса, промах и, если есть, место среди
 * ответивших. Своего числа и правильного ответа в тексте нет: иначе ссылка выдаёт вопрос тем,
 * кто ещё не отвечал. Перцентиль — только когда сервер его прислал; при «лучшем ответе» — вместо него.
 */
export function buildTiebreakerShareText(
  number: number,
  answered: Pick<TiebreakerAnsweredView, 'multiplier' | 'percentile'>,
): string {
  const t = messagesFor(m);
  const parts = [`${t.mode} #${number}`, t.shareMiss(formatMultiplier(answered.multiplier))];
  if (isBestAnswerOfDay(answered.percentile)) parts.push(t.shareBest);
  else if (answered.percentile !== null) parts.push(t.shareMoreAccurate(answered.percentile));
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
