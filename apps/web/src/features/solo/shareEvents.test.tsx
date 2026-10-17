import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAnalyticsEvent = vi.fn();
vi.mock('../../platform/api', () => ({
  logAnalyticsEvent: (...args: unknown[]) => logAnalyticsEvent(...args),
  createFriendInvite: async () => ({ url: 'https://t.me/bot/app?startapp=rm_x' }),
}));
const executeShare = vi.fn();
vi.mock('../../platform/share', () => ({
  chooseShareStrategy: () => 'copy',
  executeShare: (...args: unknown[]) => executeShare(...args),
  buildFriendInvitePayload: (url: string) => ({ text: 't', url }),
}));
vi.mock('../../platform/telegram', () => ({ canShareViaTelegram: () => false, shareViaTelegram: () => false }));
vi.mock('../tiebreaker/tiebreakerShare', () => ({ resolveGameLink: () => 'https://game' }));

import { useFriendInvite } from './useFriendInvite';
import { useSoloShare } from './soloShare';

function capture<T>(hook: () => T): T {
  let value!: T;
  function Probe() {
    value = hook();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return value;
}

beforeEach(() => {
  logAnalyticsEvent.mockReset();
  executeShare.mockReset();
  vi.stubGlobal('window', { location: { origin: 'https://x' } });
  vi.stubGlobal('navigator', {});
});

describe('share funnel events', () => {
  it('result_shared is sent after a successful result share with the reached flag', async () => {
    executeShare.mockResolvedValue('shared');
    capture(useSoloShare).share('text', true);
    await vi.waitFor(() => expect(logAnalyticsEvent).toHaveBeenCalledWith('result_shared', { reached: true }));
  });

  it('result_shared is not sent when sharing failed', async () => {
    executeShare.mockResolvedValue('failed');
    capture(useSoloShare).share('text');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('friend_invite_shared is sent after the invite was shared or copied', async () => {
    executeShare.mockResolvedValue('copied');
    await capture(() => useFriendInvite('run-1')).send();
    expect(logAnalyticsEvent).toHaveBeenCalledWith('friend_invite_shared');
  });

  it('friend_invite_shared is not sent when the share was cancelled', async () => {
    executeShare.mockResolvedValue('cancelled');
    await capture(() => useFriendInvite('run-1')).send();
    expect(logAnalyticsEvent).not.toHaveBeenCalled();
  });
});
