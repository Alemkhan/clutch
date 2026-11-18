/// <reference types="@cloudflare/workers-types" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../apps/api/src/env';
import { sendScheduledAnnouncements } from '../apps/api/src/notifications/announcements';
import { sendDailyChallengeDigests, setDailyDigestEnabled } from '../apps/api/src/notifications/daily';
import { notifyBumpedFromTopTen } from '../apps/api/src/notifications/outOfTop';
import { duelResultText, notifySoloResult, sendRematchOffer, soloResultText } from '../apps/api/src/notifications/outbid';
import { createTestD1, type TestD1 } from './helpers/testD1';

const databases: TestD1[] = [];
const PLAYER = 'telegram:42';

function setup(locale: 'en' | 'kk' = 'en') {
  const db = createTestD1();
  databases.push(db);
  db.sqlite.prepare(`INSERT INTO player_settings (player_id, locale, region, region_source, updated_at)
    VALUES (?, ?, 'world', 'auto', 1)`).run(PLAYER, locale);
  const env = {
    DB: db.binding,
    TELEGRAM_BOT_TOKEN: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  } as unknown as Env;
  return { db, env };
}

function lastBody(): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string }>> } } {
  const calls = vi.mocked(fetch).mock.calls;
  return JSON.parse(String(calls[calls.length - 1][1]?.body));
}
const labels = () => lastBody().reply_markup.inline_keyboard.flat().map((button) => button.text);

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true }))));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.sqlite.close();
});

describe('localized Telegram notifications', () => {
  it('daily digest goes out in English without Russian Wiki titles', async () => {
    const { db, env } = setup();
    const now = Date.parse('2026-10-21T12:00:00Z');
    db.sqlite.prepare(`INSERT INTO tiebreaker_questions
      (id, prompt, card_prompt, unit, answer, source_url, as_of_date, active_date, explanation_json, created_at)
      VALUES ('guess-1', 'Сколько?', 'Сколько?', 'раз', 10, 'https://example.com', '2026', '2026-10-21', '{}', 1)`).run();
    await setDailyDigestEnabled(db.binding, PLAYER, true, now);
    vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith('/sendWidget')
      ? new Response(JSON.stringify({ ok: false }), { status: 400 })
      : Response.json({ ok: true }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await sendDailyChallengeDigests(env, now);
    const body = lastBody();
    expect(body.text).toMatch(/^A new day in Clutch/u);
    expect(body.text).toContain('“Guesstimate” #1');
    expect(body.text).not.toMatch(/[А-Яа-яЁё]/u);
    expect(labels()).toContain('Turn off daily messages');
  });

  it('solo result and rematch offer are in English', async () => {
    const { env } = setup();
    await notifySoloResult(env, {
      recipientRun: { id: 'r1', playerId: PLAYER, category: 'general' },
      challengerRunId: 'r2', challengerName: '  ', recipientProgress: 1, challengerProgress: 2, outcome: 'record_lost',
    });
    expect(lastBody().text).toBe('Opponent beat your record.');
    expect(labels()).toEqual(["Don't send messages like this"]);

    await sendRematchOffer(env, {
      recipientPlayerId: PLAYER, recipientRunId: 'r1', challengerRunId: 'r2', inviteId: 'rm_x', challengerName: 'Ann',
    });
    expect(lastBody().text).toBe('Ann challenges you to a rematch with new questions.');
    expect(labels()).toEqual(['Play the rematch', "Don't send messages like this"]);
  });

  it('pure builders format multipliers per locale and keep Russian as default', () => {
    const tiebreak = { recipientMultiplier: 1.4, challengerMultiplier: 2 };
    expect(soloResultText('Ann', 'record_won', tiebreak, 'en')).toBe('The run was a draw, but on “Guesstimate” it was ×1.4 vs ×2.0: you win.');
    expect(soloResultText('Ann', 'record_won', tiebreak)).toBe('Ничья по забегу, но «На глазок» ×1,4 против ×2,0: победа ваша.');
    expect(duelResultText('Ann', 'tie', undefined, 'kk')).toContain('Достық ойын');
  });

  it('out-of-top-ten notice is in English', async () => {
    const { env } = setup();
    const place = (playerId: string, displayName: string) => ({ playerId, displayName, place: 10, soloScore: 5, roundsPlayed: 4 });
    await notifyBumpedFromTopTen(env, {
      triggerPlayerId: 'telegram:7', triggerName: 'Ann', dateKey: '2026-10-21',
      before: new Map([['geography', [place(PLAYER, 'Me')]]]),
      after: new Map([['geography', [{ ...place('telegram:7', 'Ann'), soloScore: 9 }]]]),
    });
    expect(lastBody().text).toBe('Ann knocked you out of the top ten of the Daily leaderboard “Geography”. Play another set to get back in.');
    expect(labels()).toEqual(['Play another set', "Don't send messages like this"]);
  });

  it('announcement button is in English', async () => {
    const { db, env } = setup();
    const due = Date.parse('2026-11-06T06:00:00Z');
    db.sqlite.prepare(`INSERT INTO player_notification_prefs (player_id, outbid_enabled, daily_enabled, updated_at)
      VALUES (?, 0, 0, ?)`).run(PLAYER, due - 1000);
    await sendScheduledAnnouncements(env, due);
    expect(labels()).toEqual(['Open Clutch']);
  });
});
