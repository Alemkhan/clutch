import { CURRENT_SOLO_RUN_CONDITIONS, type CreateFriendInviteResponse } from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { findRecordRun } from '../matches/repository';
import { miniAppLink, newInviteId } from '../notifications/outbid';
import {
  findOpenInviteForRun,
  inviteUnavailableReason,
  insertOpenInviteOnce,
} from '../notifications/repository';

type AppContext = Context<{ Bindings: Env }>;

async function authenticate(c: AppContext, scope: string): Promise<RequestIdentity | Response> {
  const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
  if (!identity) return c.json({ error: 'Authentication required.' }, 401);
  const rateLimit = await checkRateLimit(c.env.API_RATE_LIMITER, `${scope}:${identity.playerId}`);
  if (rateLimit === 'limited') {
    c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
    return c.json({ error: 'Too many requests.' }, 429);
  }
  if (rateLimit === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
  return identity;
}

export function registerFriendInviteRoutes(app: Hono<{ Bindings: Env }>): void {
  // «Позвать друга»: открытое приглашение на запись своего завершённого соло-забега. Повторный вызов
  // возвращает то же живое приглашение; погашенное или просроченное заново не выдаётся.
  app.post('/api/solo-runs/:id/invite', async (c) => {
    const identity = await authenticate(c, 'friend-invite');
    if (identity instanceof Response) return identity;
    const runId = c.req.param('id');
    const now = Date.now();

    const owner = await c.env.DB.prepare(`
      SELECT player_id, category, status, rules_version, reached_target, progress
      FROM match_runs WHERE id = ?1
    `).bind(runId).first<{
      player_id: string;
      category: string;
      status: string;
      rules_version: string | null;
      reached_target: number | null;
      progress: number;
    }>();
    // Чужой забег неотличим от несуществующего.
    if (!owner || owner.player_id !== identity.playerId) return c.json({ error: 'Run not found.' }, 404);
    if (owner.rules_version !== CURRENT_SOLO_RUN_CONDITIONS.rulesVersion) {
      return c.json({ error: 'Only a counted solo run can be shared.', reason: 'not_solo' }, 409);
    }
    if (owner.status !== 'completed' || owner.reached_target !== 1) {
      return c.json({ error: 'Only a finished run that reached the target can be shared.', reason: 'not_reached' }, 409);
    }
    if (!await findRecordRun(c.env.DB, runId, CURRENT_SOLO_RUN_CONDITIONS.rulesVersion)) {
      return c.json({ error: 'This run can no longer serve as a record.', reason: 'not_reached' }, 409);
    }

    let invite = await findOpenInviteForRun(c.env.DB, runId);
    if (!invite) {
      await insertOpenInviteOnce(c.env.DB, {
        id: newInviteId(),
        challengerRunId: runId,
        category: owner.category,
        challengerProgress: owner.progress,
        now,
      });
      // Параллельный вызов мог успеть первым: уникальный индекс оставил одну строку, читаем её.
      invite = await findOpenInviteForRun(c.env.DB, runId);
    }
    if (!invite) return c.json({ error: 'Invite could not be created.' }, 500);
    const reason = inviteUnavailableReason(invite, now);
    if (reason) return c.json({ error: 'The invite for this run is no longer available.', reason }, 409);

    const url = miniAppLink(c.env.TELEGRAM_MINI_APP_LINK, invite.id);
    if (!url) return c.json({ error: 'Mini app link is not configured.' }, 503);
    const response: CreateFriendInviteResponse = { inviteId: invite.id, url, expiresAt: invite.expires_at };
    return c.json(response, 201);
  });
}
