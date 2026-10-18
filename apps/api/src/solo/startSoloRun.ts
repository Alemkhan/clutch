import {
  DAILY_RULES_VERSION,
  DUEL_RULES_VERSION,
  FREE_RULES_VERSION,
  FRIEND_RULES_VERSION,
  PRACTICE_RULES_VERSION,
  SOLO_TARGET_PROGRESS,
  dailyKey,
  duelRoundCap,
  isSoloMode,
  type MiniGameId,
  isPracticeLevelId,
  practiceQuestionSet,
  toPublicQuestion,
  type PracticeLevelId,
  type Question,
  type SoloMode,
  type StartAsyncMatchRequest,
  type StartSoloRunResponse,
} from '@clutch/shared';
import type { RequestIdentity } from '../auth/identity';
import { readJsonBody } from '../http/jsonBody';
import {
  consumeInvite,
  findInvite,
  inviteUnavailableReason,
  isOpenInvite,
  isSoloInvite,
  releaseInvite,
  type InviteRow,
} from '../notifications/repository';
import { dailyMiniGameId, pickMiniGameId } from './miniGame';
import { PRACTICE_BOT_PROFILES, createBotOpponent } from './bots';
import { dailySet, freeSet, matchmakeDuel, type PickedSet } from './matchmaking';
import { claimRecord, findRecordRun, type GhostMatch } from './repository';
import { createSoloRun, findActiveSoloRun, findDailyAttempt } from './soloRepository';
import { buildSoloSnapshot } from './soloSnapshot';
import { authenticate, openSoloRun, type AppContext } from './soloShared';
import { isStartRequest } from './validation';

type Category = StartAsyncMatchRequest['category'];

/** Разобранное тело старта. `botLevel` приходит как есть: его допустимость решает выбор режима. */
interface StartRequest {
  displayName: string;
  category: Category;
  mode: SoloMode;
  botLevel: unknown;
  rematchInviteId: string | undefined;
}

/**
 * Как начинается забег.
 * - practice: бот вместо записи игрока, вне соревнования (PRACTICE_RULES_VERSION);
 * - daily: забег дня — общий набор дня, в таблицу идёт первая попытка;
 * - free: свободная игра — свежий набор, вне таблицы, без соперника;
 * - duel: дуэль — запись другого игрока на её наборе, либо свежий набор, который сам ждёт соперника;
 * - rematch: дуэль по приглашению на реванш (адресовано игроку);
 * - friend: открытое приглашение «Позвать друга», соперник — сама запись автора на её наборе.
 */
type StartMode =
  | { kind: 'practice'; level: PracticeLevelId }
  | { kind: 'daily' | 'free' | 'duel'; category: Category }
  | { kind: 'rematch'; category: Category; invite: InviteRow }
  | { kind: 'friend'; category: Category; invite: InviteRow; record: GhostMatch };

type MatchedMode = Exclude<StartMode, { kind: 'practice' }>;

const RULES_BY_KIND: Readonly<Record<MatchedMode['kind'], string>> = {
  daily: DAILY_RULES_VERSION,
  free: FREE_RULES_VERSION,
  duel: DUEL_RULES_VERSION,
  rematch: DUEL_RULES_VERSION,
  friend: FRIEND_RULES_VERSION,
};

export async function handleStartSoloRun(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'solo-start');
  if (identity instanceof Response) return identity;
  const request = await readStartRequest(c);
  if (request instanceof Response) return request;
  const now = Date.now();
  const runId = crypto.randomUUID();

  const mode = await resolveStartMode(c, identity, request, now);
  if (mode instanceof Response) return mode;
  if (mode.kind === 'practice') return startPracticeRun(c, identity, request, mode.level, runId, now);

  if (mode.kind === 'daily') {
    // Забег дня один: начатый продолжается, законченный второй раз не выдаётся.
    const { questionSetId } = dailySet(mode.category, now);
    const attempt = await findDailyAttempt(c.env.DB, identity.playerId, questionSetId);
    if (attempt?.status === 'completed') {
      return c.json({ error: 'The run of the day is already played.', reason: 'daily_played' }, 409);
    }
    if (attempt) {
      const resumed = await resumeRun(c, identity, attempt.id);
      if (resumed) return resumed;
    }
  } else if (mode.kind === 'free' || mode.kind === 'duel') {
    // Незаконченный забег режима продолжается, а не заменяется новым: иначе брошенная дуэль
    // навсегда держала бы запись соперника, а свободная игра плодила бы пустые строки.
    // Реванш и дружеская ссылка идут своей дорогой: у них свой набор и своё приглашение.
    const active = await findActiveSoloRun(c.env.DB, identity.playerId, mode.category, RULES_BY_KIND[mode.kind]);
    if (active) {
      const resumed = await resumeRun(c, identity, active.id);
      if (resumed) return resumed;
    }
  }
  return startMatchedRun(c, identity, request, mode, runId, now);
}

async function readStartRequest(c: AppContext): Promise<StartRequest | Response> {
  const parsed = await readJsonBody(c.req.raw, 1024);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  if (!isStartRequest(parsed.value)) {
    return c.json({ error: 'Invalid displayName or category.' }, 400);
  }
  const mode = (parsed.value as { mode?: unknown }).mode ?? 'daily';
  if (!isSoloMode(mode)) return c.json({ error: 'Invalid mode.' }, 400);
  return {
    displayName: parsed.value.displayName,
    category: parsed.value.category,
    mode,
    botLevel: (parsed.value as { botLevel?: unknown }).botLevel,
    rematchInviteId: parsed.value.rematchInviteId,
  };
}

/** Выбирает режим старта или возвращает готовый ответ-ошибку (приглашение не найдено, чужое, просрочено). */
async function resolveStartMode(
  c: AppContext,
  identity: RequestIdentity,
  request: StartRequest,
  now: number,
): Promise<StartMode | Response> {
  if (request.botLevel !== undefined) {
    if (!isPracticeLevelId(request.botLevel) || request.rematchInviteId) {
      return c.json({ error: 'Invalid botLevel.' }, 400);
    }
    return { kind: 'practice', level: request.botLevel };
  }
  if (!request.rematchInviteId) return { kind: request.mode, category: request.category };

  // Реванш: приглашение должно быть адресовано игроку, не потрачено, не просрочено и из соло.
  // Категория берётся из приглашения, набор — подбором дуэли (новый, не сыгранный получателем).
  // «Позвать друга» — открытое приглашение без адресата: его гасит первый, кто начал забег, и играет
  // против самой записи автора на её наборе. Эта запись зарезервирована и в общем подборе не участвует.
  const invite = await findInvite(c.env.DB, request.rematchInviteId);
  if (!invite) return c.json({ error: 'Rematch invite not found.' }, 404);
  const friend = isOpenInvite(invite);
  if (!friend && invite.recipient_player_id !== identity.playerId) {
    return c.json({ error: 'Rematch invite not found.' }, 404);
  }
  let record: GhostMatch | null = null;
  if (friend) {
    record = await findRecordRun(c.env.DB, invite.challenger_run_id, [DUEL_RULES_VERSION, FREE_RULES_VERSION]);
    if (record?.row.player_id === identity.playerId) {
      return c.json({ error: 'This is your own invite.', reason: 'own' }, 403);
    }
  }
  const reason = inviteUnavailableReason(invite, now);
  if (reason || (friend && !record)) {
    return c.json({ error: 'Rematch invite is no longer available.', reason: reason ?? 'expired' }, 410);
  }
  if (!isSoloInvite(invite)) {
    return c.json({ error: 'Rematch invite is no longer available.', reason: 'expired' }, 410);
  }
  const category = invite.category as Category;
  return record ? { kind: 'friend', category, invite, record } : { kind: 'rematch', category, invite };
}

/** Тренировка с ботом: свой набор, бот вместо записи, вне соревнования. */
async function startPracticeRun(
  c: AppContext,
  identity: RequestIdentity,
  request: StartRequest,
  level: PracticeLevelId,
  runId: string,
  now: number,
): Promise<Response> {
  // Свой набор, НЕ из дневного банка: иначе тренировка показывала бы набор забега дня.
  const { questionSetId, questions } = practiceQuestionSet(request.category, runId, now);
  const bot = createBotOpponent(questions, PRACTICE_BOT_PROFILES[level]);
  // Соперник — бот, а не запись человека: игра случайная, поровну.
  const miniGameId = pickMiniGameId(null);
  await createSoloRun(c.env.DB, {
    id: runId,
    playerId: identity.playerId,
    displayName: identity.displayName || request.displayName.trim(),
    category: request.category,
    questionSetId,
    miniGameId,
    questions,
    paceRunId: null,
    pace: bot,
    practice: true,
    now,
  });
  // Бот не запись игрока: тренировка доигрывается до общего потолка кругов.
  return c.json(startResponse(runId, questions, bot, PRACTICE_RULES_VERSION, miniGameId, false, null), 201);
}

/**
 * Продолжение незаконченного забега; null — продолжить не вышло (забег другой версии игры).
 * Отдаём снимок (с уже сыгранными кругами), а не «свежий» старт: иначе клиент начал бы с круга 0
 * и повторно отвечал на круги, которые сервер уже записал.
 */
async function resumeRun(c: AppContext, identity: RequestIdentity, runId: string): Promise<Response | null> {
  const loaded = await openSoloRun(c, identity, runId);
  if (loaded instanceof Response) return null;
  const snapshot = await buildSoloSnapshot(c, loaded);
  if (snapshot instanceof Response) return snapshot;
  const response: StartSoloRunResponse = { ...snapshot, resumed: true };
  return c.json(response, 201);
}

/** Набор и соперник нового забега по режиму; запись-соперник дуэли захватывается атомарно. */
async function pickSetAndOpponent(
  c: AppContext,
  identity: RequestIdentity,
  mode: MatchedMode,
  runId: string,
  now: number,
): Promise<PickedSet> {
  if (mode.kind === 'daily') return dailySet(mode.category, now);
  if (mode.kind === 'free') return freeSet(c.env.DB, mode.category, identity.playerId, runId, now);
  if (mode.kind === 'friend') {
    const { record } = mode;
    return { ghost: record, questionSetId: record.questionSetId, questions: record.questions, bankExhausted: false };
  }
  const picked = await matchmakeDuel(c.env.DB, mode.category, identity.playerId, runId, now);
  // Матч — это пара. Запись забирается атомарно: при одновременных стартах ровно один игрок
  // получает её, остальные играют её набор без соперника, а их забеги сами становятся записями.
  if (picked.ghost && !await claimRecord(c.env.DB, picked.ghost.row.id, runId, now)) {
    return { ...picked, ghost: null };
  }
  return picked;
}

/** Забег дня, свободная игра, дуэль, реванш или дружеский: подбор, погашение приглашения, строка, ответ. */
async function startMatchedRun(
  c: AppContext,
  identity: RequestIdentity,
  request: StartRequest,
  mode: MatchedMode,
  runId: string,
  now: number,
): Promise<Response> {
  const { ghost, questionSetId, questions, bankExhausted } = await pickSetAndOpponent(c, identity, mode, runId, now);
  const invite = mode.kind === 'rematch' || mode.kind === 'friend' ? mode.invite : null;
  // Забег дня — одна игра на всех в эти сутки; против записи — её игра; иначе случайная.
  const miniGameId = mode.kind === 'daily' ? dailyMiniGameId(mode.category, dailyKey(now)) : pickMiniGameId(ghost);
  if (invite && !await consumeInvite(c.env.DB, invite.id, identity.playerId, runId)) {
    return c.json({ error: 'Rematch invite is no longer available.', reason: 'taken' }, 410);
  }
  const rulesVersion = RULES_BY_KIND[mode.kind];
  try {
    await createSoloRun(c.env.DB, {
      id: runId,
      playerId: identity.playerId,
      displayName: identity.displayName || request.displayName.trim(),
      category: mode.category,
      questionSetId,
      miniGameId,
      questions,
      paceRunId: ghost?.row.id ?? null,
      pace: ghost?.opponent ?? null,
      friend: mode.kind === 'friend',
      rulesVersion,
      now,
    });
  } catch (error) {
    if (invite) await releaseInvite(c.env.DB, invite.id).catch(() => undefined);
    throw error;
  }
  const pace = ghost?.opponent ?? null;
  return c.json(startResponse(runId, questions, pace, rulesVersion, miniGameId, bankExhausted, pace), 201);
}

function startResponse(
  runId: string,
  questions: readonly Question[],
  pace: StartSoloRunResponse['pace'],
  rulesVersion: StartSoloRunResponse['rulesVersion'],
  miniGameId: MiniGameId,
  bankExhausted: boolean,
  /** Запись соперника, по которой считается потолок кругов; у тренировки нет. */
  record: StartSoloRunResponse['pace'],
): StartSoloRunResponse {
  return {
    runId,
    questions: questions.map(toPublicQuestion),
    pace,
    target: SOLO_TARGET_PROGRESS,
    roundCap: duelRoundCap(record),
    rulesVersion,
    miniGameId,
    bankExhausted,
  };
}
