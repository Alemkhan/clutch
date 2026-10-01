import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const available = <T extends (...args: never[]) => unknown>(fn: T, isAvailable = true) => (
    Object.assign(fn, { isAvailable: () => isAvailable })
  );
  return {
    isTMA: vi.fn(() => true),
    init: vi.fn(),
    restoreInitData: vi.fn(),
    retrieveRawInitData: vi.fn(() => undefined),
    initDataUser: vi.fn(() => undefined),
    mountMiniAppSync: available(vi.fn()),
    bindMiniAppCssVars: available(vi.fn()),
    mountViewport: available(vi.fn(() => Promise.resolve())),
    bindViewportCssVars: available(vi.fn()),
    expandViewport: available(vi.fn()),
    miniAppReady: available(vi.fn()),
  };
});

vi.mock('@telegram-apps/sdk-react', () => sdk);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.isTMA.mockReturnValue(true);
  sdk.mountViewport.mockResolvedValue(undefined);
});

describe('initializeTelegram', () => {
  it('keeps one full promise while exposing core readiness before a hung viewport', async () => {
    let finishViewport!: () => void;
    sdk.mountViewport.mockReturnValueOnce(new Promise<void>((resolve) => {
      finishViewport = resolve;
    }));
    const { initializeTelegram, whenTelegramCoreReady } = await import('./telegram');

    const first = initializeTelegram();
    const second = initializeTelegram();

    expect(second).toBe(first);
    await whenTelegramCoreReady();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.miniAppReady).toHaveBeenCalledTimes(1);
    expect(sdk.bindViewportCssVars).not.toHaveBeenCalled();
    let fullInitializationFinished = false;
    void first.then(() => { fullInitializationFinished = true; });
    await Promise.resolve();
    expect(fullInitializationFinished).toBe(false);

    finishViewport();
    await first;
    expect(sdk.bindViewportCssVars).toHaveBeenCalledTimes(1);
  });

  it('resolves promptly outside Telegram and still caches the promise', async () => {
    sdk.isTMA.mockReturnValue(false);
    const { initializeTelegram } = await import('./telegram');

    const first = initializeTelegram();
    expect(initializeTelegram()).toBe(first);
    await first;

    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.mountViewport).not.toHaveBeenCalled();
  });

  it('preserves core initialization when viewport mounting throws synchronously', async () => {
    sdk.mountViewport.mockImplementationOnce(() => {
      throw new Error('unsupported viewport');
    });
    const { initializeTelegram } = await import('./telegram');

    await expect(initializeTelegram()).resolves.toBeUndefined();
    expect(sdk.miniAppReady).toHaveBeenCalledTimes(1);
    expect(sdk.bindViewportCssVars).not.toHaveBeenCalled();
  });
});
