/// <reference types="@cloudflare/workers-types" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendScheduledAnnouncements } from '../apps/api/src/notifications/announcements';
import { createTestD1, type TestD1 } from './helpers/testD1';

const DUE = Date.parse('2026-11-06T06:00:00Z');
const databases: TestD1[] = [];
function setup() {
  const db = createTestD1();
  databases.push(db);
  return { db, env: { DB: db.binding, TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp' } };
}
function active(db: TestD1, playerId: string, at = DUE - 1000) {
  db.sqlite.prepare(`INSERT INTO player_notification_prefs (player_id, outbid_enabled, daily_enabled, updated_at)
    VALUES (?, 0, 0, ?)`).run(playerId, at);
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true }))));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.sqlite.close();
});

describe('scheduled announcements', () => {
  it('processes all 73 launch recipients in one paced cron pass', async () => {
    const { db, env } = setup();
    for (let id = 1; id <= 73; id += 1) active(db, `telegram:${id}`);
    vi.useFakeTimers();
    const delivery = sendScheduledAnnouncements(env, DUE);
    await vi.runAllTimersAsync();
    expect(await delivery).toMatchObject({ candidates: 73, sent: 73 });
    expect(fetch).toHaveBeenCalledTimes(73);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM announcement_deliveries').get()).toEqual({ count: 73 });
  });

  it('sends the approved message when due, independently of daily preferences, once per player', async () => {
    const { db, env } = setup();
    active(db, 'telegram:42');
    expect(await sendScheduledAnnouncements(env, DUE - 1)).toMatchObject({ candidates: 0, sent: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(await sendScheduledAnnouncements(env, DUE)).toMatchObject({ candidates: 1, sent: 1 });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.chat_id).toBe('42');
    expect(body.text).toBe('🏁 В Clutch появилась новая функция "Вызов друзьям"\nЗакончил забег? Нажми "Вызвать друзей", кинь ссылку в чат и соревнуйся с друзьями на одинаковом наборе вопросов.\nКто дойдёт до 100% с лучшим результатом?\nСегодняшние задания уже ждут внутри 👀');
    expect(body.reply_markup.inline_keyboard).toEqual([[{ text: 'Открыть Clutch', url: 'https://t.me/testbot?startapp=home' }]]);
    expect(await sendScheduledAnnouncements(env, DUE + 15 * 60 * 1000)).toMatchObject({ sent: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('excludes old activity, guests, future activity and known blocked recipients', async () => {
    const { db, env } = setup();
    active(db, 'telegram:1', DUE - 31 * 86400000);
    active(db, 'guest:2');
    active(db, 'telegram:3', DUE + 1);
    active(db, 'telegram:4');
    db.sqlite.prepare(`INSERT INTO daily_notification_deliveries
      (player_id, date_key, status, created_at, updated_at) VALUES ('telegram:4', '2026-11-05', 'blocked', 1, 1)`).run();
    expect(await sendScheduledAnnouncements(env, DUE + 1000)).toMatchObject({ candidates: 0, sent: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent cron passes and keeps failed deliveries claimed for future passes', async () => {
    const { db, env } = setup();
    active(db, 'telegram:42');
    vi.mocked(fetch).mockResolvedValue(new Response('unavailable', { status: 500 }));
    await Promise.all([sendScheduledAnnouncements(env, DUE), sendScheduledAnnouncements(env, DUE)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.sqlite.prepare('SELECT status FROM announcement_deliveries').get()).toEqual({ status: 'failed' });
    await sendScheduledAnnouncements(env, DUE + 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('records blocked recipients and excludes them from later campaigns', async () => {
    const { db, env } = setup();
    active(db, 'telegram:42');
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 403 }));
    expect(await sendScheduledAnnouncements(env, DUE)).toMatchObject({ blocked: 1 });
    db.sqlite.prepare(`INSERT INTO announcement_campaigns VALUES ('later', 'Next', ?, ?)`).run(DUE + 1, DUE);
    expect(await sendScheduledAnnouncements(env, DUE + 1000)).toMatchObject({ candidates: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
