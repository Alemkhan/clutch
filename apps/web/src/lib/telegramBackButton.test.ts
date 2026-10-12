import { describe, expect, it, vi } from 'vitest';
import {
  TelegramBackButtonController,
  telegramBackAction,
  type TelegramBackButtonAdapter,
} from './telegramBackButton';

function createAdapter() {
  let listener: (() => void) | null = null;
  const adapter: TelegramBackButtonAdapter = {
    canMount: vi.fn(() => true),
    mount: vi.fn(),
    onClick: vi.fn((next) => {
      listener = next;
      return () => { listener = null; };
    }),
    show: vi.fn(),
    hide: vi.fn(),
    unmount: vi.fn(),
  };
  return { adapter, press: () => listener?.() };
}

describe('Telegram BackButton mapping', () => {
  it('maps only safe non-gameplay phases to navigation', () => {
    expect(telegramBackAction('home')).toBe('hidden');
    expect(telegramBackAction('profile')).toBe('home');
    expect(telegramBackAction('lastStand')).toBe('home');
    expect(telegramBackAction('myRuns')).toBe('home');
    expect(telegramBackAction('training')).toBe('home');
    expect(telegramBackAction('solo')).toBe('home');
    // В активном забеге соло кнопка скрыта.
    expect(telegramBackAction('solo', true)).toBe('hidden');
  });

  it('updates visibility and routes clicks through the latest action', () => {
    const { adapter, press } = createAdapter();
    const navigate = vi.fn();
    const controller = new TelegramBackButtonController(adapter, navigate);

    controller.mount();
    expect(adapter.hide).toHaveBeenCalledTimes(1);
    controller.setAction('home');
    expect(adapter.show).toHaveBeenCalledTimes(1);
    press();
    expect(navigate).toHaveBeenCalledWith('home');

    controller.setAction('hidden');
    press();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('removes its listener and safely tolerates repeated cleanup', () => {
    const { adapter, press } = createAdapter();
    const navigate = vi.fn();
    const controller = new TelegramBackButtonController(adapter, navigate);
    controller.setAction('home');
    controller.mount();

    controller.dispose();
    controller.dispose();
    press();

    expect(navigate).not.toHaveBeenCalled();
    expect(adapter.hide).toHaveBeenCalledTimes(1);
    expect(adapter.unmount).toHaveBeenCalledTimes(1);
  });

  it('cleans up a partial mount when listener binding throws', () => {
    const { adapter } = createAdapter();
    vi.mocked(adapter.onClick).mockImplementationOnce(() => {
      throw new Error('listener failed');
    });
    const controller = new TelegramBackButtonController(adapter, vi.fn());

    expect(() => controller.mount()).not.toThrow();
    expect(adapter.hide).toHaveBeenCalledTimes(1);
    expect(adapter.unmount).toHaveBeenCalledTimes(1);
  });
});

describe('Telegram BackButton in the solo run', () => {
  it('is visible on safe solo screens and hidden while playing', () => {
    expect(telegramBackAction('solo')).toBe('home');
    expect(telegramBackAction('solo', false)).toBe('home');
    expect(telegramBackAction('solo', true)).toBe('hidden');
  });
});
