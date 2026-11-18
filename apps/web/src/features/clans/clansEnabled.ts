import { clansActive } from '@clutch/shared';

/**
 * Показывать ли кланы: с дня запуска (CLANS_FROM), а в dev-сборке — всегда, чтобы их можно было
 * смотреть заранее. Сервер закрывает их так же, так что часы устройства ничего не открывают.
 */
export function clansEnabled(now: number = Date.now()): boolean {
  return Boolean(import.meta.env.DEV) || clansActive(now);
}
