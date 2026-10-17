import { CURRENT_SOLO_RUN_CONDITIONS, type CreateRematchInviteResponse } from '@clutch/shared';
import type { Context, Hono } from 'hono';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { REMATCH_INVITE_ID } from '../solo/validation';
import { newInviteId, sendRematchOffer } from '../notifications/outbid';
import {
  findInvite,
  findInviteForPair,
  insertInviteOnce,
  isSoloInvite,
  inviteUnavailableReason,
  isOpenInvite,
  isOutbidEnabled,
  setOutbidEnabled,
  type InviteRow,
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

/** Идентификатор забега из пути маршрута `/api/solo-runs/:id/rematch`. */
const runIdParam = (c: AppContext): string => c.req.param('id') ?? '';

export function registerRematchRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/solo-runs/:id/rematch', handleCreateRematch);
  app.get('/api/rematch/:id', handleRematchPreview);
  app.get('/api/notifications/outbid', handleGetOutbid);
  app.put('/api/notifications/outbid', handlePutOutbid);
}

interface ChallengerRun {
  player_id: string;
  display_name: string;
  category: string;
  status: string;
  rules_version: string | null;
  opponent_run_id: string | null;
  solo_outcome: string | null;
  progress: number;
}

interface OpponentRecord {
  player_id: string;
  progress: number;
}

/** Зачётный забег вызывающего против записи человека (`opponent_run_id` непуст), любой исход. */
type OpponentRun = ChallengerRun & { opponent_run_id: string };

async function loadOpponentRun(c: AppContext, identity: RequestIdentity, runId: string): Promise<OpponentRun | Response> {
  const run = await c.env.DB.prepare(`
    SELECT player_id, display_name, category, status, rules_version, opponent_run_id, solo_outcome, progress
    FROM match_runs WHERE id = ?1
  `).bind(runId).first<ChallengerRun>();
  // Чужой забег неотличим от несуществующего.
  if (!run || run.player_id !== identity.playerId) return c.json({ error: 'Run not found.' }, 404);
  if (run.rules_version !== CURRENT_SOLO_RUN_CONDITIONS.rulesVersion || run.status !== 'completed') {
    return c.json({ error: 'Only a finished counted solo run can call a rematch.', reason: 'not_solo' }, 409);
  }
  // Звать можно владельца записи, против которой сыгран забег, при любом исходе (победа, поражение,
  // ничья): проигравший как раз хочет отыграться. Без записи-соперника (без темпа, бот) звать некого.
  if (!run.opponent_run_id || !['player', 'opponent', 'tie'].includes(run.solo_outcome ?? '')) {
    return c.json({ error: 'This run has no human opponent record to call.', reason: 'no_opponent' }, 409);
  }
  return run as OpponentRun;
}

async function loadOpponentRecord(
  c: AppContext,
  identity: RequestIdentity,
  run: OpponentRun,
): Promise<OpponentRecord | Response> {
  const record = await c.env.DB.prepare('SELECT player_id, progress FROM match_runs WHERE id = ?1')
    .bind(run.opponent_run_id)
    .first<OpponentRecord>();
  if (!record) return c.json({ error: 'The record is no longer available.', reason: 'expired' }, 410);
  if (record.player_id === identity.playerId) {
    return c.json({ error: 'This is your own record.', reason: 'own' }, 403);
  }
  return record;
}

/** Приглашение пары «запись — забег»: существующее или только что вставленное. */
async function findOrCreateInvite(
  c: AppContext,
  runId: string,
  run: OpponentRun,
  record: OpponentRecord,
): Promise<{ invite: InviteRow | null; fresh: boolean }> {
  let invite = await findInviteForPair(c.env.DB, run.opponent_run_id, runId);
  const fresh = !invite;
  if (!invite) {
    await insertInviteOnce(c.env.DB, {
      id: newInviteId(),
      recipientPlayerId: record.player_id,
      recipientRunId: run.opponent_run_id,
      challengerRunId: runId,
      category: run.category,
      recipientProgress: record.progress,
      challengerProgress: run.progress,
    });
    // Параллельное нажатие могло успеть первым: UNIQUE пары оставил одну строку, читаем её.
    invite = await findInviteForPair(c.env.DB, run.opponent_run_id, runId);
  }
  return { invite, fresh };
}

/**
 * «Позвать на реванш»: приглашение создаёт живое нажатие игрока, сыгравшего против записи (любой исход), и только оно.
 * Раньше строку в `rematch_invites` создавало уведомление об исходе, то есть вызов приходил от
 * системы — у получателя это выглядело как вызов, которого никто не посылал (DEC-09).
 * Повторное нажатие возвращает то же приглашение; погашенное или просроченное заново не выдаётся.
 */
async function handleCreateRematch(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'rematch-offer');
  if (identity instanceof Response) return identity;
  const runId = runIdParam(c);
  const now = Date.now();

  const run = await loadOpponentRun(c, identity, runId);
  if (run instanceof Response) return run;
  const record = await loadOpponentRecord(c, identity, run);
  if (record instanceof Response) return record;

  const { invite, fresh } = await findOrCreateInvite(c, runId, run, record);
  if (!invite) return c.json({ error: 'Rematch invite could not be created.' }, 500);
  const reason = inviteUnavailableReason(invite, now);
  if (reason) return c.json({ error: 'The rematch for this run is no longer available.', reason }, 409);

  // Сообщение уходит один раз, на создании: повторное нажатие соперника не звонит получателю снова.
  if (fresh) {
    await sendRematchOffer(c.env, {
      recipientPlayerId: record.player_id,
      recipientRunId: run.opponent_run_id,
      challengerRunId: runId,
      inviteId: invite.id,
      challengerName: run.display_name,
    });
  }
  const response: CreateRematchInviteResponse = { inviteId: invite.id, expiresAt: invite.expires_at };
  return c.json(response, 201);
}

// Preview for the "rematch with ..." screen. An invite that is not addressed to the caller is
// indistinguishable from a missing one. An open friend invite has no addressee: anyone but the
// author sees it until someone starts a run from it.
async function handleRematchPreview(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'rematch');
  if (identity instanceof Response) return identity;
  const id = c.req.param('id') ?? '';
  if (!REMATCH_INVITE_ID.test(id)) return c.json({ error: 'Rematch invite not found.' }, 404);
  const invite = await findInvite(c.env.DB, id);
  if (!invite) return c.json({ error: 'Rematch invite not found.' }, 404);
  const friend = isOpenInvite(invite);
  if (!friend && invite.recipient_player_id !== identity.playerId) {
    return c.json({ error: 'Rematch invite not found.' }, 404);
  }
  const challenger = await c.env.DB.prepare('SELECT display_name, player_id FROM match_runs WHERE id = ?1')
    .bind(invite.challenger_run_id)
    .first<{ display_name: string; player_id: string }>();
  if (!challenger) return c.json({ error: 'Rematch invite is no longer available.' }, 410);
  if (friend && challenger.player_id === identity.playerId) {
    return c.json({ error: 'This is your own invite.', reason: 'own' }, 403);
  }
  // Приглашение от забега не соло-версии (легаси-строка) принять нечем: для игрока оно как истёкшее.
  const reason = inviteUnavailableReason(invite, Date.now()) ?? (isSoloInvite(invite) ? null : 'expired');
  if (reason) return c.json({ error: 'Rematch invite is no longer available.', reason }, 410);
  return c.json({
    inviteId: invite.id,
    category: invite.category,
    /** Открытая ссылка «Позвать друга», а не реванш по записи соперника. */
    friend,
    challengerName: challenger.display_name,
    challengerProgress: invite.challenger_progress,
    yourProgress: invite.recipient_progress,
    expiresAt: invite.expires_at,
  });
}

async function handleGetOutbid(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'notifications');
  if (identity instanceof Response) return identity;
  return c.json({ enabled: await isOutbidEnabled(c.env.DB, identity.playerId) });
}

async function handlePutOutbid(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'notifications');
  if (identity instanceof Response) return identity;
  const parsed = await readJsonBody(c.req.raw, 256);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  const body = parsed.value as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== 'boolean') return c.json({ error: 'Invalid enabled flag.' }, 400);
  await setOutbidEnabled(c.env.DB, identity.playerId, body.enabled);
  return c.json({ enabled: body.enabled });
}
