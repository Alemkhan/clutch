import { describe, expect, it } from 'vitest';
import { parseLaunchPayload, readLaunchIntent } from './launchIntent';

const id = 'rm_AAAAAAAAAAAAAAAAAAAAAA';

describe('launch intent', () => {
  it('recognises only rematch ids and the unsubscribe payload', () => {
    expect(parseLaunchPayload(id)).toEqual({ type: 'rematch', inviteId: id });
    expect(parseLaunchPayload('unsub')).toEqual({ type: 'unsubscribe' });
    expect(parseLaunchPayload('daily_off')).toEqual({ type: 'daily-unsubscribe' });
    expect(parseLaunchPayload('daily_guess')).toEqual({ type: 'daily-tiebreaker' });
    expect(parseLaunchPayload('daily_wiki')).toEqual({ type: 'daily-wiki-path' });
    for (const bad of [null, undefined, '', 'rm_short', `${id}x`, 'telegram:42', 'rm_AAAAAAAAAAAAAAAAAAAAA!']) {
      expect(parseLaunchPayload(bad)).toBeNull();
    }
  });

  it('reads the Telegram launch hash and a plain query', () => {
    expect(readLaunchIntent({ hash: `#tgWebAppData=x&tgWebAppStartParam=${id}`, search: '' }))
      .toEqual({ type: 'rematch', inviteId: id });
    expect(readLaunchIntent({ hash: '', search: '?tgWebAppStartParam=unsub' })).toEqual({ type: 'unsubscribe' });
    expect(readLaunchIntent({ hash: '', search: '?tgWebAppStartParam=daily_wiki' })).toEqual({ type: 'daily-wiki-path' });
    expect(readLaunchIntent({ hash: '#tgWebAppData=x', search: '' })).toBeNull();
  });
});

it('recognises group challenge links and rejects malformed payloads', () => {
  const challengeId = 'gc_AAAAAAAAAAAAAAAAAAAAAA';
  expect(parseLaunchPayload(challengeId)).toEqual({ type: 'group-challenge', challengeId });
  expect(readLaunchIntent({ hash: '', search: `?startapp=${challengeId}` })).toEqual({ type: 'group-challenge', challengeId });
  for (const bad of ['gc_short', challengeId + 'x', 'gc_AAAAAAAAAAAAAAAAAAAAA!']) expect(parseLaunchPayload(bad)).toBeNull();
});
