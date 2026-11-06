import type { Env } from '../env';
import { miniAppLink, telegramChatId } from './outbid';
import { sendTelegramMessage } from './telegram';

const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERY_BATCH_SIZE = 20;

interface Campaign { id: string; message: string; scheduled_at: number }
interface Recipient { player_id: string }

export interface AnnouncementSummary {
  campaigns: number;
  candidates: number;
  sent: number;
  blocked: number;
  failed: number;
}

/** Claims stay recorded after ambiguous network failures, so retries cannot duplicate a message. */
export async function sendScheduledAnnouncements(env: Env, now = Date.now()): Promise<AnnouncementSummary> {
  const summary: AnnouncementSummary = { campaigns: 0, candidates: 0, sent: 0, blocked: 0, failed: 0 };
  const url = miniAppLink(env.TELEGRAM_MINI_APP_LINK, 'home');
  if (!env.TELEGRAM_BOT_TOKEN || !url) return summary;
  const campaigns = await env.DB.prepare(`SELECT id, message, scheduled_at FROM announcement_campaigns
    WHERE scheduled_at <= ?1 ORDER BY scheduled_at, id LIMIT 5`).bind(now).all<Campaign>();
  summary.campaigns = campaigns.results.length;
  for (const campaign of campaigns.results) {
    // Freeze eligibility at the scheduled time, including the window's upper bound.
    const recipients = await env.DB.prepare(`WITH activity AS (
      SELECT player_id, created_at AS active_at FROM match_runs
      UNION ALL SELECT player_id, created_at FROM tiebreaker_answers
      UNION ALL SELECT player_id, created_at FROM wiki_path_runs
      UNION ALL SELECT player_id, updated_at FROM player_notification_prefs
    ) SELECT DISTINCT a.player_id FROM activity a
      WHERE a.player_id LIKE 'telegram:%' AND a.active_at >= ?1 AND a.active_at <= ?2
        AND NOT EXISTS (SELECT 1 FROM announcement_deliveries d
          WHERE d.player_id = a.player_id AND (d.campaign_id = ?3 OR d.status = 'blocked'))
        AND NOT EXISTS (SELECT 1 FROM daily_notification_deliveries d
          WHERE d.player_id = a.player_id AND d.status = 'blocked')
      ORDER BY a.player_id LIMIT ?4`)
      .bind(campaign.scheduled_at - ACTIVE_WINDOW_MS, campaign.scheduled_at, campaign.id, DELIVERY_BATCH_SIZE)
      .all<Recipient>();
    summary.candidates += recipients.results.length;
    // Sequential requests keep a batch comfortably within Telegram's broadcast rate limit.
    for (const recipient of recipients.results) {
      const chatId = telegramChatId(recipient.player_id);
      const claim = await env.DB.prepare(`INSERT OR IGNORE INTO announcement_deliveries
        (campaign_id, player_id, status, created_at, updated_at) VALUES (?1, ?2, 'claimed', ?3, ?3)`)
        .bind(campaign.id, recipient.player_id, now).run();
      if (Number(claim.meta?.changes ?? 0) !== 1) continue;
      const result = chatId
        ? await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, campaign.message, [[{ text: 'Открыть Clutch', url }]])
        : { status: 'failed' as const };
      await env.DB.prepare(`UPDATE announcement_deliveries SET status = ?3, updated_at = ?4
        WHERE campaign_id = ?1 AND player_id = ?2`)
        .bind(campaign.id, recipient.player_id, result.status, now).run();
      summary[result.status] += 1;
    }
  }
  return summary;
}
