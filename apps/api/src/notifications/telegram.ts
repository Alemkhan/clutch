export interface InlineUrlButton {
  text: string;
  url: string;
}

export type SendResult = 'sent' | 'blocked' | 'failed';

/** Plain text (no parse_mode): player names are untrusted and must not be interpreted as markup. */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  buttons: InlineUrlButton[][],
): Promise<SendResult> {
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
  if (response.ok) return 'sent';
  // 403: the user blocked the bot or never started it; there is nothing to deliver to.
  return response.status === 403 ? 'blocked' : 'failed';
}
