import { prepareShareMessage } from './api';
import { canShareMessage, shareMessageViaTelegram } from './telegram';

/**
 * Эффект для executeShare: карточка результата уходит в чат сообщением с кнопкой «Играть».
 * Нет shareMessage (старый клиент, не Telegram) или сервер не подготовил сообщение — 'failed',
 * и executeShare отправляет обычную ссылку на то же превью.
 */
export function preparedMessageShare(previewUrl: string): () => Promise<'shared' | 'cancelled' | 'failed'> {
  return async () => {
    if (!canShareMessage()) return 'failed';
    try {
      const { id } = await prepareShareMessage(previewUrl);
      return await shareMessageViaTelegram(id);
    } catch {
      return 'failed';
    }
  };
}
