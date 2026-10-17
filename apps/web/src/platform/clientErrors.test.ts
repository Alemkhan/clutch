import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAnalyticsEvent = vi.fn();
vi.mock('./api', () => ({ logAnalyticsEvent: (...args: unknown[]) => logAnalyticsEvent(...args) }));

import {
  CLIENT_ERROR_LIMIT,
  installClientErrorHandlers,
  reportClientError,
  resetClientErrorsForTest,
  sanitizeErrorMessage,
  setClientErrorScreen,
} from './clientErrors';

beforeEach(() => {
  logAnalyticsEvent.mockReset();
  resetClientErrorsForTest();
});

describe('client error reporting', () => {
  it('cuts everything after a question mark and caps the message at 64 characters', () => {
    expect(sanitizeErrorMessage('Failed https://x.app/api?token=secret')).toBe('Failed https://x.app/api');
    expect(sanitizeErrorMessage(new Error('a'.repeat(100)))).toHaveLength(64);
    expect(sanitizeErrorMessage('')).toBe('unknown');
  });

  it('sends kind, message and screen within the payload limits', () => {
    setClientErrorScreen('home');
    reportClientError('error', new Error('boom'));
    expect(logAnalyticsEvent).toHaveBeenCalledWith('client_error', { kind: 'error', message: 'boom', screen: 'home' });
  });

  it('does not send opaque cross-origin "Script error." without a stack, but always sends render errors', () => {
    reportClientError('error', 'Script error.');
    reportClientError('error', '');
    expect(logAnalyticsEvent).not.toHaveBeenCalled();
    reportClientError('render', 'Script error.');
    expect(logAnalyticsEvent).toHaveBeenCalledTimes(1);
    reportClientError('error', new Error('real failure'));
    expect(logAnalyticsEvent).toHaveBeenCalledTimes(2);
  });

  it('sends the same message once', () => {
    reportClientError('error', 'same');
    reportClientError('rejection', 'same');
    expect(logAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  it('sends at most the page limit of distinct errors', () => {
    for (let i = 0; i < CLIENT_ERROR_LIMIT + 3; i += 1) reportClientError('error', `e${i}`);
    expect(logAnalyticsEvent).toHaveBeenCalledTimes(CLIENT_ERROR_LIMIT);
  });

  it('never throws, even when sending fails', () => {
    logAnalyticsEvent.mockImplementation(() => { throw new Error('network'); });
    expect(() => reportClientError('render', 'x')).not.toThrow();
  });

  it('listens to window error and unhandledrejection', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    } as unknown as Window;
    const off = installClientErrorHandlers(target);
    listeners.get('error')?.({ error: new Error('boom'), message: 'boom' });
    listeners.get('unhandledrejection')?.({ reason: 'nope' });
    expect(logAnalyticsEvent).toHaveBeenCalledWith('client_error', { kind: 'error', message: 'boom' });
    expect(logAnalyticsEvent).toHaveBeenCalledWith('client_error', { kind: 'rejection', message: 'nope' });
    off();
    expect(listeners.size).toBe(0);
  });
});
