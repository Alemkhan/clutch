import { describe, expect, it } from 'vitest';
import { parseLaunchPayload, readLaunchIntent } from './launchIntent';

const id = 'rm_AAAAAAAAAAAAAAAAAAAAAA';

describe('launch intent', () => {
  it('recognises only rematch ids and the unsubscribe payload', () => {
    expect(parseLaunchPayload(id)).toEqual({ type: 'rematch', inviteId: id });
    expect(parseLaunchPayload('unsub')).toEqual({ type: 'unsubscribe' });
    for (const bad of [null, undefined, '', 'rm_short', `${id}x`, 'telegram:42', 'rm_AAAAAAAAAAAAAAAAAAAAA!']) {
      expect(parseLaunchPayload(bad)).toBeNull();
    }
  });

  it('reads the Telegram launch hash and a plain query', () => {
    expect(readLaunchIntent({ hash: `#tgWebAppData=x&tgWebAppStartParam=${id}`, search: '' }))
      .toEqual({ type: 'rematch', inviteId: id });
    expect(readLaunchIntent({ hash: '', search: '?tgWebAppStartParam=unsub' })).toEqual({ type: 'unsubscribe' });
    expect(readLaunchIntent({ hash: '#tgWebAppData=x', search: '' })).toBeNull();
  });
});
