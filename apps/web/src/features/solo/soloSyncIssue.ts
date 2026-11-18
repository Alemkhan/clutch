import { messagesFor } from '../../i18n/messages';
import { m } from './messages';
/** Что показать игроку, когда круг не дошёл до сервера или сервер его не принял. */
export interface SyncIssue {
  message: string;
  /** true — связь пропала, тот же круг можно отправить снова; false — сервер круг не принимает. */
  canRetry: boolean;
}

export const INVALID_RESPONSE_ISSUE: SyncIssue = {
  get message() { return messagesFor(m).syncInvalid; },
  canRetry: false,
};

/** 409, а забег с сервера подтянуть не вышло. */
export const CONFLICT_ISSUE: SyncIssue = {
  get message() { return messagesFor(m).syncConflict; },
  canRetry: false,
};

/** Повторы исчерпаны: по сети можно попробовать ещё раз, отказ сервера — нет. */
export function deliveryFailureIssue(transient: boolean): { issue: SyncIssue; reason: 'offline' | 'rejected' } {
  return transient
    ? {
      issue: { message: messagesFor(m).syncOffline, canRetry: true },
      reason: 'offline',
    }
    : { issue: { message: messagesFor(m).syncRejected, canRetry: false }, reason: 'rejected' };
}
