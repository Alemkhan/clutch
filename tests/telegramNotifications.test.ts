/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendTelegramMessage } from '../apps/api/src/notifications/telegram';

const BOT_TOKEN = '123456:secret-bot-token';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const send = () => sendTelegramMessage(BOT_TOKEN, '42', 'Тест', []);

describe('Telegram notification adapter diagnostics', () => {
  it('returns sent when Telegram accepts the message', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    await expect(send()).resolves.toEqual({ status: 'sent' });
  });

  it('keeps blocked separate from other delivery failures', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      '{"ok":false,"description":"Forbidden: bot was blocked by the user"}',
      { status: 403 },
    ));

    await expect(send()).resolves.toEqual({
      status: 'blocked',
      reasonCode: 'bot_blocked',
      httpStatus: 403,
    });
  });

  it('reduces Telegram non-2xx bodies to bounded operational classes', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(
        '{"ok":false,"error_code":400,"description":"Bad Request: chat not found; token '
          + BOT_TOKEN + '; message from Алем"}',
        { status: 400 },
      ))
      .mockResolvedValueOnce(new Response('upstream included private response data', { status: 503 }));

    const badChat = await send();
    const upstream = await send();
    expect(badChat).toEqual({ status: 'failed', reasonCode: 'chat_not_found', httpStatus: 400 });
    expect(upstream).toEqual({ status: 'failed', reasonCode: 'server_error', httpStatus: 503 });
    expect(JSON.stringify([badChat, upstream])).not.toContain(BOT_TOKEN);
    expect(JSON.stringify([badChat, upstream])).not.toContain('Алем');
    expect(JSON.stringify([badChat, upstream])).not.toContain('private response data');
  });

  it('classifies network failures without exposing the thrown message', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError(
      `request to https://api.telegram.org/bot${BOT_TOKEN}/sendMessage failed with initData=private`,
    ));

    const result = await send();
    expect(result).toEqual({ status: 'failed', reasonCode: 'network_error' });
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(result)).not.toContain('initData');
  });
});
