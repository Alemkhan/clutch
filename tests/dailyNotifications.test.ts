/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../apps/api/src/index';
import { sendDailyChallengeDigests, setDailyDigestEnabled } from '../apps/api/src/notifications/daily';
import { createTestD1, type TestD1 } from './helpers/testD1';

const databases: TestD1[] = [];
const NOW = Date.parse('2026-10-21T12:00:00Z');
const allowRateLimiter: RateLimit = { limit: async () => ({ success: true }) };

function database(): TestD1 {
  const db = createTestD1();
  databases.push(db);
  db.sqlite.prepare(`INSERT INTO tiebreaker_questions
    (id, prompt, card_prompt, unit, answer, source_url, as_of_date, active_date, explanation_json, created_at)
    VALUES ('guess-1', 'Сколько?', 'Сколько?', 'раз', 10, 'https://example.com', '2026', '2026-10-21', '{}', 1)`).run();
  return db;
}

function env(db: TestD1) {
  return {
    DB: db.binding,
    API_RATE_LIMITER: allowRateLimiter,
    TELEGRAM_BOT_TOKEN: 'test',
    SESSION_SIGNING_SECRET: 'test-session-signing-secret-at-least-32-characters',
    ENVIRONMENT: 'test',
    TELEGRAM_MINI_APP_LINK: 'https://t.me/testbot?startapp',
  };
}

function telegramAuthorization(id: number): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(NOW / 1000)),
    user: JSON.stringify({ id, first_name: 'Игрок' }),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('test').digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return `tma ${params.toString()}`;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.sqlite.close();
});

describe('daily challenge notifications', () => {
  it('are opt-in and expose a Telegram-only preference endpoint', async () => {
    const db = database();
    const authorization = telegramAuthorization(42);
    const initial = await app.request('/api/notifications/daily', { headers: { authorization } }, env(db));
    expect(await initial.json()).toEqual({ enabled: false });

    const enabled = await app.request('/api/notifications/daily', {
      method: 'PUT', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    }, env(db));
    expect(await enabled.json()).toEqual({ enabled: true });
    expect(db.sqlite.prepare("SELECT daily_enabled FROM player_notification_prefs WHERE player_id = 'telegram:42'").get())
      .toEqual({ daily_enabled: 1 });
  });

  it('sends one combined message after 17:00 Almaty and never duplicates the day', async () => {
    const db = database();
    await setDailyDigestEnabled(db.binding, 'telegram:42', true, NOW);
    const first = await sendDailyChallengeDigests(env(db), NOW);
    expect(first).toMatchObject({ candidates: 1, sent: 1, blocked: 0, failed: 0, skipped: false });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.text).toContain('«На глазок» #1');
    expect(body.text).toContain('Абай Кунанбаев → Альберт Эйнштейн');
    expect(body.reply_markup.inline_keyboard.flat().map((button: { url: string }) => button.url)).toEqual([
      'https://t.me/testbot?startapp=daily_guess',
      'https://t.me/testbot?startapp=daily_wiki',
      'https://t.me/testbot?startapp=daily_off',
    ]);

    const second = await sendDailyChallengeDigests(env(db), NOW + 15 * 60 * 1000);
    expect(second).toMatchObject({ candidates: 0, sent: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.sqlite.prepare('SELECT status FROM daily_notification_deliveries').get()).toEqual({ status: 'sent' });
  });

  it('does not send before the configured hour', async () => {
    const db = database();
    await setDailyDigestEnabled(db.binding, 'telegram:42', true, NOW);
    const summary = await sendDailyChallengeDigests(env(db), Date.parse('2026-10-21T11:59:00Z'));
    expect(summary.skipped).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
