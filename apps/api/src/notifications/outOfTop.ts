import { CURRENT_SOLO_RUN_CONDITIONS, dayStartMs } from '@clutch/shared';
import type { Env } from '../env';
import { soloBoardTop, type BoardPlace } from '../solo/soloRepository';
import { cleanName, miniAppLink, STOP_PAYLOAD, telegramChatId } from './outbid';
import { isOutbidEnabled, setOutbidEnabled } from './repository';
import { sendTelegramMessage } from './telegram';

/**
 * R25, шаг 2: «выбили из первой десятки таблицы дня». Известие уходит тому, кто был в десятке
 * (место <= 10) и перестал быть, не чаще одного раза в игровые сутки. Те же правила согласия, что у
 * остальных известий: только `telegram:`, уважение к отписке (`outbid_enabled`), кнопка отписки.
 */

export const TOP_TEN = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const DISPLAY_NAMES: Record<string, string> = {
  general: 'Общие знания',
  geography: 'География',
  history: 'Другие флаги',
  languages: 'Языки',
};
/** Payload без отдельного экрана: клиент его не знает и просто открывает Mini App. */
export const PLAY_PAYLOAD = 'play';

/** Верх таблицы по категориям (места <= 10), снятый до или после события. */
export type TopTenSnapshot = Map<string, BoardPlace[]>;

export async function snapshotTopTen(
  db: D1Database,
  categories: readonly string[],
  dateKey: string,
): Promise<TopTenSnapshot> {
  const from = dayStartMs(dateKey);
  const entries = await Promise.all(categories.map(async (category) => [
    category,
    await soloBoardTop(db, category, CURRENT_SOLO_RUN_CONDITIONS.rulesVersion, from, from + DAY_MS, dateKey, TOP_TEN),
  ] as const));
  return new Map(entries);
}

/** Категории, где у игрока есть зачётный забег до цели в эти сутки: только там ответ мог сдвинуть места. */
export async function categoriesWithBoardRun(db: D1Database, playerId: string, dateKey: string): Promise<string[]> {
  const from = dayStartMs(dateKey);
  const rows = await db.prepare(`
    SELECT DISTINCT category FROM match_runs
    WHERE player_id = ?1 AND status = 'completed' AND rules_version = ?2 AND reached_target = 1
      AND solo_score IS NOT NULL AND completed_at >= ?3 AND completed_at < ?4
  `).bind(playerId, CURRENT_SOLO_RUN_CONDITIONS.rulesVersion, from, from + DAY_MS).all<{ category: string }>();
  return rows.results.map((row) => row.category);
}

/** Текст известия. `byGuess` — вытеснили при равных кругах, решила прикидка. */
export function outOfTopTenText(triggerName: string, category: string, byGuess: boolean): string {
  const board = DISPLAY_NAMES[category] ?? 'Категория';
  const reason = byGuess ? ': при равных кругах прикидка «На глазок» точнее' : '';
  return `${cleanName(triggerName)} выбил вас из первой десятки таблицы дня «${board}»${reason}. Сыграйте ещё набор, чтобы вернуться.`;
}

/** Кого вытеснили: были в десятке до, нет в ней после. Сам инициатор вытесненным быть не может. */
export function findBumped(before: readonly BoardPlace[], after: readonly BoardPlace[], triggerPlayerId: string): BoardPlace[] {
  const stillIn = new Set(after.map((row) => row.playerId));
  return before.filter((row) => row.playerId !== triggerPlayerId && !stillIn.has(row.playerId));
}

/**
 * Рассылка по снимкам до/после. Не бросает: вызывается из waitUntil, ответ игроку уже ушёл.
 * Строка `top_ten_notices` вставляется до отправки, поэтому гонка двух завершений даёт одно сообщение.
 */
export async function notifyBumpedFromTopTen(
  env: Env,
  input: { triggerPlayerId: string; triggerName: string; dateKey: string; before: TopTenSnapshot; after: TopTenSnapshot },
): Promise<void> {
  try {
    if (!env.TELEGRAM_BOT_TOKEN) return;
    for (const [category, beforeRows] of input.before) {
      const afterRows = input.after.get(category) ?? [];
      const trigger = afterRows.find((row) => row.playerId === input.triggerPlayerId);
      for (const bumped of findBumped(beforeRows, afterRows, input.triggerPlayerId)) {
        const chatId = telegramChatId(bumped.playerId);
        if (!chatId) continue;
        try {
          await sendOne(env, input.dateKey, chatId, bumped, trigger?.displayName ?? input.triggerName, category,
            trigger !== undefined && trigger.soloScore === bumped.soloScore && trigger.roundsPlayed === bumped.roundsPlayed);
        } catch {
          console.error({ event: 'telegram_notification_handler', kind: 'top_ten', reasonCode: 'unexpected_error' });
        }
      }
    }
  } catch {
    console.error({ event: 'telegram_notification_handler', kind: 'top_ten', reasonCode: 'unexpected_error' });
  }
}

async function sendOne(
  env: Env,
  dateKey: string,
  chatId: string,
  bumped: BoardPlace,
  triggerName: string,
  category: string,
  byGuess: boolean,
): Promise<void> {
  if (!(await isOutbidEnabled(env.DB, bumped.playerId))) return;
  const playUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, PLAY_PAYLOAD);
  const stopUrl = miniAppLink(env.TELEGRAM_MINI_APP_LINK, STOP_PAYLOAD);
  // Без ссылок кнопок не собрать; слать текст без отписки нельзя.
  if (!playUrl || !stopUrl) return;
  const claimed = await env.DB.prepare(`
    INSERT INTO top_ten_notices (player_id, date_key, created_at) VALUES (?1, ?2, ?3)
    ON CONFLICT (player_id, date_key) DO NOTHING
  `).bind(bumped.playerId, dateKey, Date.now()).run();
  if ((claimed.meta.changes ?? 0) !== 1) return;
  const result = await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN as string,
    chatId,
    outOfTopTenText(triggerName, category, byGuess),
    [
      [{ text: 'Сыграть ещё набор', url: playUrl }],
      [{ text: 'Не присылать такие сообщения', url: stopUrl }],
    ],
  );
  if (result.status !== 'sent') {
    console.error({
      event: 'telegram_notification_delivery',
      kind: 'top_ten',
      deliveryStatus: result.status,
      reasonCode: result.reasonCode,
    });
  }
  if (result.status === 'blocked') await setOutbidEnabled(env.DB, bumped.playerId, false);
}
