// Пробная отправка ежедневного виджета «Вопрос дня» - того же, что шлёт cron (apps/api/src/notifications).
//
//   npx vite-node scripts/telegram/widget-try.ts -- --dry-run [YYYY-MM-DD]   → собрать и проверить лимиты
//   npx vite-node scripts/telegram/widget-try.ts -- <chat_id> [YYYY-MM-DD]   → отправить (нужен TELEGRAM_BOT_TOKEN)
//
// Токен берётся только из переменной окружения и никуда не пишется. Бот может написать лишь тому,
// кто уже нажал Start в его чате.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { dailyKey } from '../../packages/shared/src/index';
import { DAILY_STOP_PAYLOAD, DAILY_WIDGET_CAPTION, dailyWidgetHtml } from '../../apps/api/src/notifications/daily';
import { dailyWidgetQuestion, WIDGET_MAX_ZLIB_BYTES } from '../../apps/api/src/notifications/dailyWidget';
import { miniAppLink } from '../../apps/api/src/notifications/outbid';
import { widgetPayload } from '../../apps/api/src/notifications/telegram';

const MINI_APP_LINK = 'https://t.me/playclutchbot?startapp';
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const dryRun = args.includes('--dry-run');
const dateKey = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? dailyKey(Date.now());
const chatId = args.find((arg) => /^-?\d+$/.test(arg));

const env = { TELEGRAM_MINI_APP_LINK: MINI_APP_LINK };
const html = dailyWidgetHtml(env, dateKey);
const question = dailyWidgetQuestion(dateKey);
if (!html || !question) {
  console.error('Нет подходящего вопроса или виджет не влез в лимит HTML');
  process.exit(1);
}
const packed = zlib.deflateSync(Buffer.from(html, 'utf8'), { level: 9 }).length;
console.log(`${dateKey}: ${question.questionId} - ${question.prompt}`);
console.log(`HTML: ${Buffer.byteLength(html)} байт, после zlib: ${packed} из ${WIDGET_MAX_ZLIB_BYTES}`);

if (dryRun || !chatId) {
  const out = path.resolve('scripts/telegram/.preview-widget.html');
  fs.writeFileSync(out, html);
  console.log(`Сборка без отправки: ${path.relative(process.cwd(), out)}${chatId ? '' : '\nДля отправки укажи chat_id.'}`);
  process.exit(0);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Задай TELEGRAM_BOT_TOKEN в окружении (токен production-бота из BotFather)');
  process.exit(1);
}
const stopUrl = miniAppLink(MINI_APP_LINK, DAILY_STOP_PAYLOAD)!;
// Тот же запрос, что шлёт cron, но ответ Telegram печатается целиком: в проде он не логируется.
const payload = widgetPayload(chatId, html, DAILY_WIDGET_CAPTION, [[{ text: 'Отключить ежедневные сообщения', url: stopUrl }]]);
const response = await fetch(`https://api.telegram.org/bot${token}/sendWidget`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
const body = await response.json().catch(() => null) as { ok?: boolean; description?: string; result?: { message_id?: number } } | null;
if (response.ok && body?.ok) console.log(`Отправлено, message_id ${body.result?.message_id ?? '?'}`);
else {
  console.error(`Telegram отказал: HTTP ${response.status} - ${body?.description ?? 'без описания'}`);
  process.exit(1);
}
