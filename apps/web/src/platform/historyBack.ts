import type { TelegramBackAction } from './telegramBackButton';

/**
 * Системная «Назад» вне Telegram: кнопка Android в приложении (Capacitor, TWA) и «назад» в мобильном
 * браузере. Telegram даёт свою BackButton; здесь её роль играет одна запись в истории браузера.
 *
 * - Раздел, из которого «Назад» ведёт на главную: в истории лежит наша запись; нажатие снимает её,
 *   и вызывается тот же переход, что у Telegram-кнопки.
 * - Идёт забег (blocking): нажатие ничего не делает, запись возвращается — иначе Android закрыл бы
 *   приложение и забег потерялся бы.
 * - Главная: записи нет, «Назад» работает как обычно (выход из приложения).
 */
export interface HistoryAdapter {
  push(): void;
  back(): void;
  onPop(listener: () => void): () => void;
}

export const browserHistoryAdapter: HistoryAdapter = {
  push: () => window.history.pushState({ clutchBack: true }, ''),
  back: () => window.history.back(),
  onPop: (listener) => {
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  },
};

export class HistoryBackController {
  private action: TelegramBackAction = 'hidden';
  private blocking = false;
  /** Наша запись сейчас лежит в истории. */
  private armed = false;
  /** Следующий popstate вызван нами (снятие лишней записи), а не игроком. */
  private ignoreNextPop = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly history: HistoryAdapter,
    private readonly navigate: (action: Exclude<TelegramBackAction, 'hidden'>) => void,
  ) {}

  mount(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.history.onPop(() => this.handlePop());
    this.sync();
  }

  setState(action: TelegramBackAction, blocking: boolean): void {
    this.action = action;
    this.blocking = blocking;
    this.sync();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private sync(): void {
    if (!this.unsubscribe) return;
    const wanted = this.action !== 'hidden' || this.blocking;
    if (wanted && !this.armed) {
      this.history.push();
      this.armed = true;
    } else if (!wanted && this.armed) {
      // Игрок ушёл на главную кнопками приложения: лишняя запись заставила бы жать «Назад» дважды.
      this.armed = false;
      this.ignoreNextPop = true;
      this.history.back();
    }
  }

  private handlePop(): void {
    if (this.ignoreNextPop) {
      this.ignoreNextPop = false;
      return;
    }
    this.armed = false;
    if (this.blocking) {
      this.history.push();
      this.armed = true;
      return;
    }
    if (this.action !== 'hidden') this.navigate(this.action);
  }
}
