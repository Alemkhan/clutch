export interface InlineUrlButton {
  text: string;
  url: string;
}

export type SendStatus = 'sent' | 'blocked' | 'failed';

export type TelegramFailureCode =
  | 'bot_blocked'
  | 'chat_not_found'
  | 'invalid_button_url'
  | 'bad_request'
  | 'unauthorized'
  | 'rate_limited'
  | 'server_error'
  | 'http_error'
  | 'configuration_error'
  | 'timeout'
  | 'network_error'
  | 'unexpected_error';

export type SendResult =
  | { status: 'sent' }
  | {
      status: 'blocked' | 'failed';
      /** Bounded operational class only: never contains Telegram's body or the thrown message. */
      reasonCode: TelegramFailureCode;
      httpStatus?: number;
    };

function classifyTelegramBody(status: number, body: string): TelegramFailureCode {
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status !== 400) return 'http_error';

  // Only known, non-personal Telegram diagnostics cross the adapter boundary.
  const normalized = body.slice(0, 2048).toLowerCase();
  if (normalized.includes('chat not found')) return 'chat_not_found';
  if (normalized.includes('button_url_invalid') || normalized.includes('wrong http url')) {
    return 'invalid_button_url';
  }
  return 'bad_request';
}

function classifyThrown(error: unknown): TelegramFailureCode {
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'timeout';
  }
  if (error instanceof TypeError) return 'network_error';
  return 'unexpected_error';
}

/** Plain text (no parse_mode): player names are untrusted and must not be interpreted as markup. */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  buttons: InlineUrlButton[][],
): Promise<SendResult> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return { status: 'sent' };
    // 403: the user blocked the bot or never started it; there is nothing to deliver to.
    if (response.status === 403) {
      return { status: 'blocked', reasonCode: 'bot_blocked', httpStatus: response.status };
    }
    const body = await response.text().catch(() => '');
    return {
      status: 'failed',
      reasonCode: classifyTelegramBody(response.status, body),
      httpStatus: response.status,
    };
  } catch (error) {
    return { status: 'failed', reasonCode: classifyThrown(error) };
  }
}
