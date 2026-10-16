/** Что показать игроку, когда круг не дошёл до сервера или сервер его не принял. */
export interface SyncIssue {
  message: string;
  /** true — связь пропала, тот же круг можно отправить снова; false — сервер круг не принимает. */
  canRetry: boolean;
}

export const INVALID_RESPONSE_ISSUE: SyncIssue = {
  message: 'Сервер вернул непонятный ответ. Круг не засчитан.',
  canRetry: false,
};

/** 409, а забег с сервера подтянуть не вышло. */
export const CONFLICT_ISSUE: SyncIssue = {
  message: 'Сервер не принял этот круг. Начни забег заново.',
  canRetry: false,
};

/** Повторы исчерпаны: по сети можно попробовать ещё раз, отказ сервера — нет. */
export function deliveryFailureIssue(transient: boolean): { issue: SyncIssue; reason: 'offline' | 'rejected' } {
  return transient
    ? {
      issue: { message: 'Нет связи с сервером. Прогресс не потерян: проверь соединение и повтори.', canRetry: true },
      reason: 'offline',
    }
    : { issue: { message: 'Сервер не принял этот круг.', canRetry: false }, reason: 'rejected' };
}
