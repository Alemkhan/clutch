import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadingShell } from '../AppBootstrap';
import { observeTelegramInitialization } from './bootstrap';

afterEach(() => {
  vi.useRealTimers();
});

describe('Telegram bootstrap', () => {
  it('renders a visible accessible loading state on the initial mount', () => {
    const html = renderToStaticMarkup(<LoadingShell />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Запускаем Clutch');
  });

  it('settles as ready and cancels the timeout after initialization', async () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    observeTelegramInitialization(Promise.resolve(), onSettle, 2_500);

    await Promise.resolve();
    expect(onSettle).toHaveBeenCalledWith('ready');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it('settles as error when initialization rejects', async () => {
    const onSettle = vi.fn();
    observeTelegramInitialization(Promise.reject(new Error('SDK failed')), onSettle, 2_500);

    await Promise.resolve();
    expect(onSettle).toHaveBeenCalledWith('error');
  });

  it('shows timeout and then reports late initialization completion', async () => {
    vi.useFakeTimers();
    let finishInitialization!: () => void;
    const initialization = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    const onSettle = vi.fn();
    observeTelegramInitialization(initialization, onSettle, 2_500);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(onSettle).toHaveBeenCalledWith('timeout');

    finishInitialization();
    await Promise.resolve();
    expect(onSettle).toHaveBeenNthCalledWith(2, 'ready');
  });

  it('cleans up without publishing a later result', async () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    const cancel = observeTelegramInitialization(new Promise<void>(() => {}), onSettle, 2_500);

    cancel();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(onSettle).not.toHaveBeenCalled();
  });
});
