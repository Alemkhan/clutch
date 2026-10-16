import {
  CURRENT_HAMMER_MINI_GAME,
  CURRENT_SOLO_RUN_CONDITIONS,
  FRIEND_RULES_VERSION,
  PRACTICE_RULES_VERSION,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  isMiniGameId,
  type MiniGameId,
  isPracticeLevelId,
  practiceQuestionSet,
  toPublicQuestion,
  type PracticeLevelId,
  type Question,
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
import { pickMiniGameId } from './miniGame';
import { PRACTICE_BOT_PROFILES, createBotOpponent } from './bots';
import { matchmake } from './matchmaking';
import { claimRecord, findRecordRun, findRun, type GhostMatch } from './repository';
import { createSoloRun, findActiveSoloRun } from './soloRepository';
import { authenticate, parsePace, type AppContext } from './soloShared';
import { isStartRequest, parseQuestions } from './validation';

type Category = StartAsyncMatchRequest['category'];

/** Разобранное тело старта. `botLevel` приходит как есть: его допустимость решает выбор режима. */
interface StartRequest {
  displayName: string;
  category: Category;
  botLevel: unknown;
  rematchInviteId: string | undefined;
}

/**
 * Как начинается забег.
 * - practice: бот вместо записи игрока, вне соревнования (PRACTICE_RULES_VERSION);
 * - rematch: приглашение адресовано игроку, соперник подбирается обычным подбором;
 * - friend: открытое приглашение «Позвать друга», соперник — сама запись автора на её наборе;
 * - regular: обычный старт, возможно с продолжением незаконченного забега.
 */
type StartMode =
  | { kind: 'practice'; level: PracticeLevelId }
  | { kind: 'regular'; category: Category }
  | { kind: 'rematch'; category: Category; invite: InviteRow }
  | { kind: 'friend'; category: Category; invite: InviteRow; record: GhostMatch };

/** Набор и соперник нового забега. */
interface StartPick {
  ghost: GhostMatch | null;
  questionSetId: string;
  questions: Question[];
  bankExhausted: boolean;
}

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

  // Незаконченный забег продолжается, а не заменяется новым. Иначе повторный старт создавал
  // новую строку, брошенный забег навсегда занимал набор, игрок уезжал на следующий набор дня
  // и терял запись соперника, которая осталась на прежнем. Реванш и дружеская ссылка идут
  // своей дорогой: у них свой набор и своё приглашение.
  if (mode.kind === 'regular') {
    const resumed = await resumeActiveRun(c, identity, mode.category);
    if (resumed) return resumed;
  }
  return startMatchedRun(c, identity, request, mode, runId, now);
}

async function readStartRequest(c: AppContext): Promise<StartRequest | Response> {
  const parsed = await readJsonBody(c.req.raw, 1024);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  if (!isStartRequest(parsed.value)) {
    return c.json({ error: 'Invalid displayName or category.' }, 400);
  }
  return {
    displayName: parsed.value.displayName,
    category: parsed.value.category,
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
  if (!request.rematchInviteId) return { kind: 'regular', category: request.category };

  // Реванш: приглашение должно быть адресовано игроку, не потрачено, не просрочено и из соло.
  // Категория берётся из приглашения, набор — обычным подбором (новый, не сыгранный получателем).
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
    record = await findRecordRun(c.env.DB, invite.challenger_run_id, CURRENT_SOLO_RUN_CONDITIONS.rulesVersion);
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
  // Свой набор, НЕ из дневного банка: иначе тренировка показывала бы зачётные наборы
  // и помечала их сыгранными, то есть позволяла пройти день с ботами и сыграть зачёт
  // уже зная вопросы. См. practiceQuestionSet.
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
  return c.json(startResponse(runId, questions, bot, PRACTICE_RULES_VERSION, miniGameId, false), 201);
}

/** Продолжение незаконченного забега игрока в категории; null — продолжать нечего. */
async function resumeActiveRun(c: AppContext, identity: RequestIdentity, category: Category): Promise<Response | null> {
  const active = await findActiveSoloRun(c.env.DB, identity.playerId, category);
  if (!active) return null;
  const existing = await findRun(c.env.DB, active.id);
  const storedQuestions = existing && parseQuestions(existing.questions_json);
  if (!existing || !storedQuestions) return null;
  return c.json(startResponse(
    existing.id,
    storedQuestions,
    parsePace(existing.opponent_json),
    existing.rules_version ?? CURRENT_SOLO_RUN_CONDITIONS.rulesVersion,
    isMiniGameId(existing.mini_game_id) ? existing.mini_game_id : CURRENT_HAMMER_MINI_GAME.id,
    false,
  ), 201);
}

/** Подбор набора по соло-пулу (только забеги, дошедшие до цели) и атомарный захват записи-соперника. */
async function pickSetAndOpponent(
  c: AppContext,
  identity: RequestIdentity,
  mode: Exclude<StartMode, { kind: 'practice' }>,
  runId: string,
  now: number,
): Promise<StartPick> {
  const record = mode.kind === 'friend' ? mode.record : null;
  const picked = record
    ? { ghost: record, questionSetId: record.questionSetId, questions: record.questions, bankExhausted: false }
    : await matchmake(
      c.env.DB,
      mode.category,
      identity.playerId,
      now,
      { rulesVersion: CURRENT_SOLO_RUN_CONDITIONS.rulesVersion, reachedTargetOnly: true },
    );
  // Матч — это пара. Запись забирается атомарно: при одновременных стартах ровно один игрок
  // получает её, остальные играют без соперника, а их забеги сами становятся ждущими записями.
  // Запись по ссылке «Позвать друга» уже закреплена приглашением, её захватывать не нужно.
  let { ghost } = picked;
  if (ghost && !record && !await claimRecord(c.env.DB, ghost.row.id, runId, now)) {
    ghost = null;
  }
  return { ghost, questionSetId: picked.questionSetId, questions: picked.questions, bankExhausted: picked.bankExhausted };
}

/** Обычный, реванш или дружеский старт: подбор, погашение приглашения, строка забега, ответ. */
async function startMatchedRun(
  c: AppContext,
  identity: RequestIdentity,
  request: StartRequest,
  mode: Exclude<StartMode, { kind: 'practice' }>,
  runId: string,
  now: number,
): Promise<Response> {
  const { ghost, questionSetId, questions, bankExhausted } = await pickSetAndOpponent(c, identity, mode, runId, now);
  const invite = mode.kind === 'regular' ? null : mode.invite;
  // Играем в ту же игру, что и записанный соперник; без записи — случайная.
  const miniGameId = pickMiniGameId(ghost);
  const friendDuel = mode.kind === 'friend';
  if (invite && !await consumeInvite(c.env.DB, invite.id, identity.playerId, runId)) {
    return c.json({ error: 'Rematch invite is no longer available.', reason: 'taken' }, 410);
  }
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
      friend: friendDuel,
      now,
    });
  } catch (error) {
    if (invite) await releaseInvite(c.env.DB, invite.id).catch(() => undefined);
    throw error;
  }
  const rulesVersion = friendDuel ? FRIEND_RULES_VERSION : CURRENT_SOLO_RUN_CONDITIONS.rulesVersion;
  return c.json(startResponse(runId, questions, ghost?.opponent ?? null, rulesVersion, miniGameId, bankExhausted), 201);
}

function startResponse(
  runId: string,
  questions: readonly Question[],
  pace: StartSoloRunResponse['pace'],
  rulesVersion: StartSoloRunResponse['rulesVersion'],
  miniGameId: MiniGameId,
  bankExhausted: boolean,
): StartSoloRunResponse {
  return {
    runId,
    questions: questions.map(toPublicQuestion),
    pace,
    target: SOLO_TARGET_PROGRESS,
    roundCap: SOLO_ROUND_CAP,
    rulesVersion,
    miniGameId,
    bankExhausted,
  };
}
