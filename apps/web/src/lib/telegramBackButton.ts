import {
  hideBackButton,
  mountBackButton,
  onBackButtonClick,
  showBackButton,
  unmountBackButton,
} from '@telegram-apps/sdk-react';
import type { Phase } from './gameSession';
import type { MatchSource } from './matchmaking';

export type TelegramBackAction = 'hidden' | 'home' | 'categories';

export function telegramBackAction(
  phase: Phase,
  matchSource: MatchSource,
): TelegramBackAction {
  if (phase === 'profile' || phase === 'training' || phase === 'categories' || phase === 'result') return 'home';
  if (phase === 'matchmaking') return matchSource === 'challenge' ? 'home' : 'categories';
  return 'hidden';
}

export interface TelegramBackButtonAdapter {
  canMount(): boolean;
  mount(): void;
  onClick(listener: () => void): () => void;
  show(): void;
  hide(): void;
  unmount(): void;
}

export const telegramBackButtonAdapter: TelegramBackButtonAdapter = {
  canMount: () => mountBackButton.isAvailable() && onBackButtonClick.isAvailable(),
  mount: () => mountBackButton(),
  onClick: (listener) => onBackButtonClick(listener),
  show: () => { if (showBackButton.isAvailable()) showBackButton(); },
  hide: () => { if (hideBackButton.isAvailable()) hideBackButton(); },
  unmount: () => unmountBackButton(),
};

export class TelegramBackButtonController {
  private action: TelegramBackAction = 'hidden';
  private mounted = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly adapter: TelegramBackButtonAdapter,
    private readonly navigate: (action: Exclude<TelegramBackAction, 'hidden'>) => void,
  ) {}

  mount(): void {
    if (this.mounted) return;
    try {
      if (!this.adapter.canMount()) return;
      this.adapter.mount();
      this.mounted = true;
      this.unsubscribe = this.adapter.onClick(() => {
        if (this.action !== 'hidden') this.navigate(this.action);
      });
    } catch {
      this.dispose();
      return;
    }
    this.syncVisibility();
  }

  setAction(action: TelegramBackAction): void {
    this.action = action;
    this.syncVisibility();
  }

  dispose(): void {
    if (!this.mounted) return;
    try { this.unsubscribe?.(); } catch { /* SDK cleanup is best effort. */ }
    this.unsubscribe = null;
    try { this.adapter.hide(); } catch { /* SDK cleanup is best effort. */ }
    try { this.adapter.unmount(); } catch { /* SDK cleanup is best effort. */ }
    this.mounted = false;
  }

  private syncVisibility(): void {
    if (!this.mounted) return;
    try {
      if (this.action === 'hidden') this.adapter.hide();
      else this.adapter.show();
    } catch {
      // Navigation remains usable through the app UI when Telegram rejects a command.
    }
  }
}
