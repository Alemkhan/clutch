import type { Context, Hono } from 'hono';
import {
  CLAN_FOUNDER_INACTIVE_DAYS,
  CLAN_INVITE_CODE,
  CLAN_INVITE_PREFIX,
  clanKeyToSlug,
  clanPlayerPoints,
  clanSlugToKey,
  clanWarScore,
  clanWeek,
  clansActive,
  DAILY_RULES_VERSION,
  dailyKey,
  DAY_BOUNDARY_OFFSET_MINUTES,
  normalizeClanEmoji,
  type ClanBoardEntry,
  type ClanBoardResponse,
  type ClanCheckResponse,
  type ClanDetailResponse,
  type ClanMeResponse,
  type ClanMemberView,
  type ClanView,
} from '@clutch/shared';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';
import { miniAppLink } from '../notifications/outbid';

type AppContext = Context<{ Bindings: Env }>;

const DAY_MS = 24 * 60 * 60 * 1000;
const BOARD_SIZE = 50;
const MEMBER_LIST_LIMIT = 500;
const FALLBACK_NAME = 'Игрок';

interface ClanRow {
  emoji_key: string;
  emoji: string;
  founder_player_id: string;
  original_founder_player_id: string;
  created_at: number;
}

interface MemberRow {
  player_id: string;
  emoji_key: string;
  invited_by: string | null;
  invite_code: string;
  display_name: string;
  joined_at: number;
}

interface RunRow {
  player_id: string;
  emoji_key: string;
  progress: number;
  reached_target: number | null;
  solo_score: number | null;
  created_at: number;
}

// ---- Чтение ----

export const findMember = (db: D1Database, playerId: string) =>
  db.prepare('SELECT * FROM clan_members WHERE player_id = ?1').bind(playerId).first<MemberRow>();

const findClan = (db: D1Database, key: string) =>
  db.prepare('SELECT * FROM clans WHERE emoji_key = ?1').bind(key).first<ClanRow>();

const memberCount = async (db: D1Database, key: string) =>
  (await db.prepare('SELECT COUNT(*) AS count FROM clan_members WHERE emoji_key = ?1').bind(key).first<{ count: number }>())?.count ?? 0;

/** Эмодзи клана для каждого из игроков - для аватаров в таблицах. */
export async function clanEmojiByPlayer(db: D1Database, playerIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(playerIds)].slice(0, 100);
  if (!unique.length) return new Map();
  const placeholders = unique.map((_, index) => `?${index + 1}`).join(', ');
  const { results } = await db.prepare(`SELECT m.player_id, c.emoji FROM clan_members m JOIN clans c ON c.emoji_key = m.emoji_key
    WHERE m.player_id IN (${placeholders})`).bind(...unique).all<{ player_id: string; emoji: string }>();
  return new Map(results.map((row) => [row.player_id, row.emoji]));
}

/** Начало игровых суток (Алматы), в которые игрок вступил: SQL-выражение от колонки времени. */
const JOIN_DAY_START = (column: string) => `(${column} - ((${column} + ${DAY_BOUNDARY_OFFSET_MINUTES * 60_000}) % ${DAY_MS}))`;

/**
 * Забеги дня участников за окно: с суток вступления, чтобы новичок не приносил клану старые очки,
 * а сегодняшний забег (без него эмодзи не занять) засчитывался. `key` - один клан; null - все.
 */
async function runsInWindow(db: D1Database, key: string | null, fromMs: number, toMs: number): Promise<RunRow[]> {
  const { results } = await db.prepare(`
    SELECT m.player_id, m.emoji_key, r.progress, r.reached_target, r.solo_score, r.created_at
    FROM clan_members m JOIN match_runs r ON r.player_id = m.player_id
    WHERE (?1 IS NULL OR m.emoji_key = ?1)
      AND r.rules_version = ?2 AND r.status = 'completed'
      AND r.created_at >= ?3 AND r.created_at < ?4 AND r.created_at >= ${JOIN_DAY_START('m.joined_at')}
  `).bind(key, DAILY_RULES_VERSION, fromMs, toMs).all<RunRow>();
  return results;
}

/** Очки каждого игрока: по одному лучшему забегу дня за игровые сутки. */
function pointsByPlayer(runs: readonly RunRow[]): Map<string, number> {
  const byPlayer = new Map<string, Parameters<typeof clanPlayerPoints>[0][number][]>();
  for (const run of runs) {
    const list = byPlayer.get(run.player_id) ?? [];
    list.push({ dayKey: dailyKey(run.created_at), progress: run.progress, reachedTarget: run.reached_target === 1, soloScore: run.solo_score });
    byPlayer.set(run.player_id, list);
  }
  return new Map([...byPlayer].map(([playerId, list]) => [playerId, clanPlayerPoints(list)]));
}

interface BoardRow extends ClanBoardEntry { key: string; createdAt: number }

/** Таблица войны за неделю: все кланы, места по очкам, при равенстве - больше участников, раньше основан. */
async function weekBoard(db: D1Database, now: number): Promise<{ week: ReturnType<typeof clanWeek>; rows: BoardRow[] }> {
  const week = clanWeek(now);
  const [clans, counts, runs] = await Promise.all([
    db.prepare('SELECT emoji_key, emoji, created_at FROM clans').all<Pick<ClanRow, 'emoji_key' | 'emoji' | 'created_at'>>(),
    db.prepare('SELECT emoji_key, COUNT(*) AS count FROM clan_members GROUP BY emoji_key').all<{ emoji_key: string; count: number }>(),
    runsInWindow(db, null, week.startMs, week.endMs),
  ]);
  const membersOf = new Map(counts.results.map((row) => [row.emoji_key, row.count]));
  const clanOfPlayer = new Map(runs.map((run) => [run.player_id, run.emoji_key]));
  const memberPoints = new Map<string, number[]>();
  for (const [playerId, points] of pointsByPlayer(runs)) {
    const key = clanOfPlayer.get(playerId)!;
    memberPoints.set(key, [...(memberPoints.get(key) ?? []), points]);
  }
  const rows: BoardRow[] = clans.results.map((clan) => ({
    key: clan.emoji_key,
    createdAt: clan.created_at,
    rank: 0,
    emoji: clan.emoji,
    slug: clanKeyToSlug(clan.emoji_key),
    members: membersOf.get(clan.emoji_key) ?? 0,
    score: clanWarScore(memberPoints.get(clan.emoji_key) ?? []),
  }));
  rows.sort((a, b) => b.score - a.score || b.members - a.members || a.createdAt - b.createdAt);
  rows.forEach((row, index) => { row.rank = index + 1; });
  return { week, rows };
}

/**
 * Основатель, не игравший забег дня месяц, уступает клан самому активному за этот месяц.
 * Проверка ленивая - при открытии клана; «нулевой пациент» при этом не меняется.
 */
async function ensureActiveFounder(db: D1Database, clan: ClanRow, now: number): Promise<ClanRow> {
  const cutoff = now - CLAN_FOUNDER_INACTIVE_DAYS * DAY_MS;
  const founder = await db.prepare(`SELECT m.joined_at,
      (SELECT MAX(created_at) FROM match_runs WHERE player_id = m.player_id AND rules_version = ?2) AS last_run
    FROM clan_members m WHERE m.player_id = ?1 AND m.emoji_key = ?3`)
    .bind(clan.founder_player_id, DAILY_RULES_VERSION, clan.emoji_key).first<{ joined_at: number; last_run: number | null }>();
  if (founder && Math.max(founder.joined_at, founder.last_run ?? 0) >= cutoff) return clan;
  const points = pointsByPlayer(await runsInWindow(db, clan.emoji_key, cutoff, now + 1));
  points.delete(clan.founder_player_id);
  let successor: string | null = null;
  let best = -1;
  for (const [playerId, value] of points) {
    if (value > best) { best = value; successor = playerId; }
  }
  // Ушедший из игры основатель (удалил аккаунт) без активных участников - клан переходит
  // к самому раннему из оставшихся, чтобы у клана был основатель.
  if (!successor && !founder) {
    successor = (await db.prepare('SELECT player_id FROM clan_members WHERE emoji_key = ?1 ORDER BY joined_at LIMIT 1')
      .bind(clan.emoji_key).first<{ player_id: string }>())?.player_id ?? null;
  }
  if (!successor) return clan;
  await db.prepare('UPDATE clans SET founder_player_id = ?2 WHERE emoji_key = ?1 AND founder_player_id = ?3')
    .bind(clan.emoji_key, successor, clan.founder_player_id).run();
  return { ...clan, founder_player_id: successor };
}

async function memberName(db: D1Database, playerId: string): Promise<string> {
  return (await db.prepare('SELECT display_name FROM clan_members WHERE player_id = ?1').bind(playerId)
    .first<{ display_name: string }>())?.display_name ?? FALLBACK_NAME;
}

async function clanView(db: D1Database, clan: ClanRow, now: number): Promise<ClanView> {
  const [members, board, founderName] = await Promise.all([
    memberCount(db, clan.emoji_key),
    weekBoard(db, now),
    memberName(db, clan.founder_player_id),
  ]);
  const row = board.rows.find((entry) => entry.key === clan.emoji_key);
  return {
    emoji: clan.emoji,
    slug: clanKeyToSlug(clan.emoji_key),
    members,
    founderName,
    createdAt: clan.created_at,
    week: { weekKey: board.week.weekKey, score: row?.score ?? 0, rank: row && row.score > 0 ? row.rank : null },
  };
}

/** Имя для клана: из Telegram, у гостя - из последнего забега. */
async function currentName(db: D1Database, identity: RequestIdentity): Promise<string> {
  if (identity.displayName) return identity.displayName.slice(0, 64);
  const row = await db.prepare('SELECT display_name FROM match_runs WHERE player_id = ?1 ORDER BY created_at DESC LIMIT 1')
    .bind(identity.playerId).first<{ display_name: string }>();
  return row?.display_name ?? FALLBACK_NAME;
}

async function hasCompletedRun(db: D1Database, playerId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 AS ok FROM match_runs WHERE player_id = ?1 AND status = 'completed' LIMIT 1")
    .bind(playerId).first());
}

export async function clanMe(env: Pick<Env, 'DB' | 'TELEGRAM_MINI_APP_LINK'>, identity: RequestIdentity, now = Date.now()): Promise<ClanMeResponse> {
  const db = env.DB;
  const member = await findMember(db, identity.playerId);
  if (!member) return { clan: null, canFound: await hasCompletedRun(db, identity.playerId) };
  const name = await currentName(db, identity);
  if (name !== member.display_name) {
    await db.prepare('UPDATE clan_members SET display_name = ?2 WHERE player_id = ?1').bind(identity.playerId, name).run();
  }
  const stored = await findClan(db, member.emoji_key);
  if (!stored) return { clan: null, canFound: true };
  const clan = await ensureActiveFounder(db, stored, now);
  const week = clanWeek(now);
  const [view, mine, infected, invitedByName] = await Promise.all([
    clanView(db, clan, now),
    db.prepare(`SELECT r.progress, r.reached_target, r.solo_score, r.created_at, ?1 AS player_id, '' AS emoji_key FROM match_runs r
      WHERE r.player_id = ?1 AND r.rules_version = ?2 AND r.status = 'completed'
        AND r.created_at >= ?3 AND r.created_at < ?4 AND r.created_at >= ${JOIN_DAY_START('?5')}`)
      .bind(identity.playerId, DAILY_RULES_VERSION, week.startMs, week.endMs, member.joined_at).all<RunRow>(),
    db.prepare('SELECT COUNT(*) AS count FROM clan_members WHERE invited_by = ?1').bind(identity.playerId).first<{ count: number }>(),
    member.invited_by ? memberName(db, member.invited_by) : Promise.resolve(null),
  ]);
  return {
    canFound: false,
    clan: {
      ...view,
      isFounder: clan.founder_player_id === identity.playerId,
      youWeekPoints: pointsByPlayer(mine.results).get(identity.playerId) ?? 0,
      infectedByYou: infected?.count ?? 0,
      invitedByName,
      inviteLink: miniAppLink(env.TELEGRAM_MINI_APP_LINK, `${CLAN_INVITE_PREFIX}${member.invite_code}`),
      inviteCode: member.invite_code,
    },
  };
}

async function clanDetail(db: D1Database, clan: ClanRow, viewer: string, now: number): Promise<ClanDetailResponse> {
  const week = clanWeek(now);
  const [view, members, runs] = await Promise.all([
    clanView(db, clan, now),
    db.prepare('SELECT * FROM clan_members WHERE emoji_key = ?1 ORDER BY joined_at, player_id LIMIT ?2')
      .bind(clan.emoji_key, MEMBER_LIST_LIMIT).all<MemberRow>(),
    runsInWindow(db, clan.emoji_key, week.startMs, week.endMs),
  ]);
  const points = pointsByPlayer(runs);
  const ids = new Map(members.results.map((member, index) => [member.player_id, index + 1]));
  const infected = new Map<string, number>();
  for (const member of members.results) {
    if (member.invited_by) infected.set(member.invited_by, (infected.get(member.invited_by) ?? 0) + 1);
  }
  const memberList: ClanMemberView[] = members.results.map((member) => ({
    id: ids.get(member.player_id)!,
    displayName: member.display_name,
    parentId: member.invited_by ? ids.get(member.invited_by) ?? null : null,
    weekPoints: points.get(member.player_id) ?? 0,
    infected: infected.get(member.player_id) ?? 0,
    isFounder: member.player_id === clan.founder_player_id,
    isOriginalFounder: member.player_id === clan.original_founder_player_id,
    isYou: member.player_id === viewer,
  }));
  return { ...view, memberList, isYours: ids.has(viewer) };
}

/** Клан по коду приглашения - для карточки «заражения»: эмодзи, кто зовёт, размер и место. */
export async function clanStanding(db: D1Database, code: string, now = Date.now()) {
  const inviter = await db.prepare(`SELECT m.display_name, c.emoji, c.emoji_key FROM clan_members m
    JOIN clans c ON c.emoji_key = m.emoji_key WHERE m.invite_code = ?1`).bind(code)
    .first<{ display_name: string; emoji: string; emoji_key: string }>();
  if (!inviter) return null;
  const [members, board] = await Promise.all([memberCount(db, inviter.emoji_key), weekBoard(db, now)]);
  const row = board.rows.find((entry) => entry.key === inviter.emoji_key);
  return { emoji: inviter.emoji, inviterName: inviter.display_name, members, rank: row && row.score > 0 ? row.rank : null };
}

// ---- Запись ----

function newInviteCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export type FoundResult = 'founded' | 'taken' | 'already_member' | 'needs_run';

export async function foundClan(db: D1Database, identity: RequestIdentity, emoji: { emoji: string; key: string }, now = Date.now()): Promise<FoundResult> {
  if (await findMember(db, identity.playerId)) return 'already_member';
  if (!(await hasCompletedRun(db, identity.playerId))) return 'needs_run';
  const name = await currentName(db, identity);
  try {
    // Одна транзакция: эмодзи занимается, только если свободно, и участник-основатель пишется,
    // только если основатель - этот игрок. Второй клан тому же игроку не даст ключ участника.
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO clans (emoji_key, emoji, founder_player_id, original_founder_player_id, created_at)
        VALUES (?1, ?2, ?3, ?3, ?4)`).bind(emoji.key, emoji.emoji, identity.playerId, now),
      db.prepare(`INSERT INTO clan_members (player_id, emoji_key, invited_by, invite_code, display_name, joined_at)
        SELECT ?1, ?2, NULL, ?3, ?4, ?5 WHERE (SELECT founder_player_id FROM clans WHERE emoji_key = ?2) = ?1`)
        .bind(identity.playerId, emoji.key, newInviteCode(), name, now),
    ]);
  } catch {
    return (await findMember(db, identity.playerId)) ? 'already_member' : 'taken';
  }
  const member = await findMember(db, identity.playerId);
  if (member?.emoji_key === emoji.key) return 'founded';
  return member ? 'already_member' : 'taken';
}

export type JoinResult = 'joined' | 'already' | 'not_found';

export async function joinClan(db: D1Database, identity: RequestIdentity, code: string, now = Date.now()): Promise<JoinResult> {
  const inviter = await db.prepare('SELECT player_id, emoji_key FROM clan_members WHERE invite_code = ?1').bind(code)
    .first<{ player_id: string; emoji_key: string }>();
  if (!inviter) return 'not_found';
  if (await findMember(db, identity.playerId)) return 'already';
  const name = await currentName(db, identity);
  try {
    await db.prepare(`INSERT INTO clan_members (player_id, emoji_key, invited_by, invite_code, display_name, joined_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(identity.playerId, inviter.emoji_key, inviter.player_id, newInviteCode(), name, now).run();
  } catch {
    return 'already';
  }
  return 'joined';
}

/**
 * Удаление аккаунта: участник уходит из клана, приглашённые им переходят к тому, кто пригласил
 * его самого; основательство - к самому раннему участнику; клан без людей освобождает эмодзи.
 */
export function clanDeletionStatements(db: D1Database, playerId: string, tombstone: string): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE clan_members SET invited_by = (SELECT invited_by FROM clan_members WHERE player_id = ?1)
      WHERE invited_by = ?1`).bind(playerId),
    db.prepare('DELETE FROM clan_members WHERE player_id = ?1').bind(playerId),
    db.prepare(`UPDATE clans SET founder_player_id = COALESCE(
        (SELECT player_id FROM clan_members m WHERE m.emoji_key = clans.emoji_key ORDER BY m.joined_at LIMIT 1), ?2)
      WHERE founder_player_id = ?1`).bind(playerId, tombstone),
    db.prepare('UPDATE clans SET original_founder_player_id = ?2 WHERE original_founder_player_id = ?1').bind(playerId, tombstone),
    db.prepare('DELETE FROM clans WHERE NOT EXISTS (SELECT 1 FROM clan_members m WHERE m.emoji_key = clans.emoji_key)'),
  ];
}

/**
 * Открыты ли кланы для этого запроса. До дня запуска - только в проде: локально и в тестах
 * кланы открыты всегда, чтобы их можно было смотреть и проверять заранее.
 */
export function clansOpen(env: Pick<Env, 'ENVIRONMENT'>, now = Date.now()): boolean {
  return env.ENVIRONMENT !== 'production' || clansActive(now);
}

// ---- Маршруты ----

export function registerClanRoutes(app: Hono<{ Bindings: Env }>): void {
  // До запуска: «клана нет и занять нельзя», остальное - 404, как будто кланов ещё нет.
  const closed = async (c: AppContext, next: () => Promise<void>) => {
    if (clansOpen(c.env)) return next();
    if (c.req.method === 'GET' && c.req.path === '/api/clans/me') return c.json({ clan: null, canFound: false } satisfies ClanMeResponse);
    return c.json({ error: 'Clans are not open yet.', reason: 'not_started' }, 404);
  };
  app.use('/api/clans', closed);
  app.use('/api/clans/*', closed);

  const authenticate = async (c: AppContext): Promise<RequestIdentity | Response> => {
    const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ error: 'Authentication required.' }, 401);
    const limited = await checkRateLimit(c.env.API_RATE_LIMITER, `clans:${identity.playerId}`);
    if (limited === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (limited === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
    return identity;
  };

  app.get('/api/clans/me', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    return c.json(await clanMe(c.env, identity));
  });

  /** Свободно ли эмодзи: для выбора перед тем, как занять. */
  app.get('/api/clans/check', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    const emoji = normalizeClanEmoji(c.req.query('emoji') ?? '');
    if (!emoji) return c.json({ error: 'Not a single emoji.', reason: 'invalid_emoji' }, 400);
    const clan = await findClan(c.env.DB, emoji.key);
    const response: ClanCheckResponse = {
      emoji: clan?.emoji ?? emoji.emoji,
      slug: clanKeyToSlug(emoji.key),
      available: !clan,
      members: clan ? await memberCount(c.env.DB, emoji.key) : 0,
    };
    return c.json(response);
  });

  app.get('/api/clans/board', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    const [{ week, rows }, member] = await Promise.all([weekBoard(c.env.DB, Date.now()), findMember(c.env.DB, identity.playerId)]);
    const strip = ({ key: _key, createdAt: _createdAt, ...entry }: BoardRow): ClanBoardEntry => entry;
    const yours = member ? rows.find((row) => row.key === member.emoji_key) : undefined;
    const response: ClanBoardResponse = {
      weekKey: week.weekKey,
      lastDayKey: week.lastDayKey,
      entries: rows.slice(0, BOARD_SIZE).map(strip),
      you: yours ? strip(yours) : null,
    };
    return c.json(response);
  });

  /** Занять свободное эмодзи и стать основателем. */
  app.post('/api/clans', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 512);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as { emoji?: unknown } | null;
    const emoji = typeof body?.emoji === 'string' ? normalizeClanEmoji(body.emoji) : null;
    if (!emoji) return c.json({ error: 'Not a single emoji.', reason: 'invalid_emoji' }, 400);
    const result = await foundClan(c.env.DB, identity, emoji);
    if (result === 'needs_run') return c.json({ error: 'Finish a run first.', reason: 'needs_run' }, 403);
    if (result === 'already_member') return c.json({ error: 'Already in a clan.', reason: 'already_member' }, 409);
    if (result === 'taken') return c.json({ error: 'Emoji is taken.', reason: 'taken' }, 409);
    return c.json(await clanMe(c.env, identity), 201);
  });

  /** Вступить по ссылке-приглашению. Уже состоящий в клане остаётся в своём - навсегда. */
  app.post('/api/clans/join', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 256);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as { code?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code.replace(CLAN_INVITE_PREFIX, '') : '';
    if (!CLAN_INVITE_CODE.test(code)) return c.json({ error: 'Invalid invite.' }, 400);
    const result = await joinClan(c.env.DB, identity, code);
    if (result === 'not_found') return c.json({ error: 'Invite not found.' }, 404);
    return c.json({ status: result, me: await clanMe(c.env, identity) });
  });

  app.get('/api/clans/:slug', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    const key = clanSlugToKey(c.req.param('slug'));
    const stored = key ? await findClan(c.env.DB, key) : null;
    if (!stored) return c.json({ error: 'Clan not found.' }, 404);
    const now = Date.now();
    const clan = await ensureActiveFounder(c.env.DB, stored, now);
    return c.json(await clanDetail(c.env.DB, clan, identity.playerId, now));
  });
}
