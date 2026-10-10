import { LAST_STAND_MAX_ROUNDS } from '@clutch/shared';

/**
 * Last Stand client logic: pure, no DOM, callers pass `nowMs`. The server owns the rules and
 * deliberately never sends category membership, so the client only mirrors what it reports.
 */

export type LastStandScaleName = 'wide' | 'regional' | 'narrow';
export type LastStandAnswerStatus = 'accepted' | 'occupied' | 'invalid' | 'eliminated' | 'cleared';
export type LastStandEliminationReason = 'timeout' | 'exhausted';

export interface LastStandRoundInfo {
  index: number;
  scale: LastStandScaleName;
  titleRu: string;
  timeMs: number;
}

export type LastStandOpponentSource = 'bot' | 'player';

export interface LastStandOpponent {
  displayName: string;
  source: LastStandOpponentSource;
}

export const LAST_STAND_SOURCE_LABELS: Record<LastStandOpponentSource, string> = {
  player: 'Запись игрока',
  bot: 'Бот',
};

export interface LastStandStartResponse {
  runId: string;
  dateKey: string;
  opponents: LastStandOpponent[];
  round: LastStandRoundInfo;
}

export interface LastStandRevealEntry {
  displayName: string;
  answerRu: string;
  atMs: number;
}

export interface LastStandAnswerResponse {
  status: LastStandAnswerStatus;
  reason: LastStandEliminationReason | null;
  deadlineMs: number;
  reveal: LastStandRevealEntry[] | null;
  survived: number;
  round: LastStandRoundInfo | null;
}

export interface LastStandLeaderboardEntry {
  displayName: string;
  survived: number;
  completedAt: string | number;
}

export interface LastStandLeaderboardResponse {
  dateKey: string;
  entries: LastStandLeaderboardEntry[];
}

export const LAST_STAND_TOTAL_ROUNDS = LAST_STAND_MAX_ROUNDS;

// ---------- response validation (server JSON is untrusted input) ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fail(what: string): never {
  throw new Error(`Invalid Last Stand response: ${what}`);
}

function parseRound(value: unknown): LastStandRoundInfo {
  if (!isRecord(value)) return fail('round');
  const { index, scale, titleRu, timeMs } = value;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return fail('round.index');
  if (scale !== 'wide' && scale !== 'regional' && scale !== 'narrow') return fail('round.scale');
  if (typeof titleRu !== 'string' || titleRu.trim() === '') return fail('round.titleRu');
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs) || timeMs <= 0) return fail('round.timeMs');
  return { index, scale, titleRu, timeMs };
}

export function parseStartResponse(value: unknown): LastStandStartResponse {
  if (!isRecord(value)) return fail('start');
  const { runId, dateKey, opponents } = value;
  if (typeof runId !== 'string' || runId === '') return fail('runId');
  if (typeof dateKey !== 'string') return fail('dateKey');
  if (!Array.isArray(opponents)) return fail('opponents');
  const names = opponents.map((opponent: unknown) => {
    if (!isRecord(opponent) || typeof opponent.displayName !== 'string') return fail('opponent');
    if (opponent.source !== 'bot' && opponent.source !== 'player') return fail('opponent.source');
    return { displayName: opponent.displayName, source: opponent.source as LastStandOpponentSource };
  });
  return { runId, dateKey, opponents: names, round: parseRound(value.round) };
}

export function parseAnswerResponse(value: unknown): LastStandAnswerResponse {
  if (!isRecord(value)) return fail('answer');
  const { status, reason, deadlineMs, reveal, survived, round } = value;
  if (
    status !== 'accepted' && status !== 'occupied' && status !== 'invalid'
    && status !== 'eliminated' && status !== 'cleared'
  ) return fail('status');
  if (reason !== null && reason !== undefined && reason !== 'timeout' && reason !== 'exhausted') return fail('reason');
  if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs)) return fail('deadlineMs');
  if (typeof survived !== 'number' || !Number.isInteger(survived) || survived < 0) return fail('survived');

  let parsedReveal: LastStandRevealEntry[] | null = null;
  if (reveal !== null && reveal !== undefined) {
    if (!Array.isArray(reveal)) return fail('reveal');
    parsedReveal = reveal.map((entry: unknown) => {
      if (
        !isRecord(entry)
        || typeof entry.displayName !== 'string'
        || typeof entry.answerRu !== 'string'
        || typeof entry.atMs !== 'number'
        || !Number.isFinite(entry.atMs)
      ) return fail('reveal entry');
      return { displayName: entry.displayName, answerRu: entry.answerRu, atMs: entry.atMs };
    });
  }

  const hasRound = round !== null && round !== undefined;
  const terminal = status === 'eliminated' || status === 'cleared';
  if (terminal && hasRound) return fail('terminal status with a round');
  if (!terminal && !hasRound) return fail('missing round');
  if (status === 'eliminated' && !reason) return fail('eliminated without reason');

  return {
    status,
    reason: (reason ?? null) as LastStandEliminationReason | null,
    deadlineMs,
    reveal: parsedReveal,
    survived,
    round: hasRound ? parseRound(round) : null,
  };
}

export function parseLeaderboardResponse(value: unknown): LastStandLeaderboardResponse {
  if (!isRecord(value) || typeof value.dateKey !== 'string' || !Array.isArray(value.entries)) {
    return fail('leaderboard');
  }
  const entries = value.entries.map((entry: unknown) => {
    if (
      !isRecord(entry)
      || typeof entry.displayName !== 'string'
      || typeof entry.survived !== 'number'
      || !Number.isFinite(entry.survived)
    ) return fail('leaderboard entry');
    const completedAt = typeof entry.completedAt === 'string' || typeof entry.completedAt === 'number'
      ? entry.completedAt
      : '';
    return { displayName: entry.displayName, survived: entry.survived, completedAt };
  });
  return { dateKey: value.dateKey, entries };
}

// ---------- run state ----------

export type LastStandStage = 'intro' | 'loading' | 'error' | 'round' | 'reveal' | 'final';
export type LastStandNotice = 'occupied' | 'invalid' | null;

export interface RevealSnapshot {
  entries: (LastStandRevealEntry & { source?: LastStandOpponentSource })[];
  /** The player's own accepted answer, if the round was survived. */
  player: { answer: string; atMs: number } | null;
}

export interface LastStandState {
  stage: LastStandStage;
  runId: string | null;
  dateKey: string | null;
  opponents: LastStandOpponent[];
  round: LastStandRoundInfo | null;
  /** Wall-clock ms at which the current round started on this device. */
  roundStartedAtMs: number;
  /** Server deadline, ms from round start. */
  deadlineMs: number;
  notice: LastStandNotice;
  noticeSeq: number;
  sendError: string | null;
  survived: number;
  reveal: RevealSnapshot | null;
  pendingRound: LastStandRoundInfo | null;
  outcome: 'eliminated' | 'cleared' | null;
  reason: LastStandEliminationReason | null;
  error: string | null;
  /** Last answer sent in the current round; used to show the player's own row in the reveal. */
  lastSent: { answer: string; atMs: number } | null;
}

export function createLastStandState(): LastStandState {
  return {
    stage: 'intro',
    runId: null,
    dateKey: null,
    opponents: [],
    round: null,
    roundStartedAtMs: 0,
    deadlineMs: 0,
    notice: null,
    noticeSeq: 0,
    sendError: null,
    survived: 0,
    reveal: null,
    pendingRound: null,
    outcome: null,
    reason: null,
    error: null,
    lastSent: null,
  };
}

export function beginLastStandStart(): LastStandState {
  return { ...createLastStandState(), stage: 'loading' };
}

export function lastStandStartFailed(state: LastStandState, message: string): LastStandState {
  return { ...state, stage: 'error', error: message };
}

export function lastStandStarted(response: LastStandStartResponse, nowMs: number): LastStandState {
  return {
    ...createLastStandState(),
    stage: 'round',
    runId: response.runId,
    dateKey: response.dateKey,
    opponents: response.opponents,
    round: response.round,
    roundStartedAtMs: nowMs,
    deadlineMs: response.round.timeMs,
  };
}

export function recordSentAnswer(state: LastStandState, answer: string, atMs: number): LastStandState {
  return { ...state, lastSent: { answer, atMs }, sendError: null };
}

export function lastStandSendFailed(state: LastStandState, message: string): LastStandState {
  return state.stage === 'round' ? { ...state, sendError: message } : state;
}

/** Applies one server answer. Handles all five statuses; the caller must ignore stale responses. */
export function applyLastStandAnswer(
  state: LastStandState,
  response: LastStandAnswerResponse,
  nowMs: number,
): LastStandState {
  if (state.stage !== 'round') return state;

  switch (response.status) {
    case 'occupied':
      return {
        ...state,
        notice: 'occupied',
        noticeSeq: state.noticeSeq + 1,
        sendError: null,
        deadlineMs: Math.max(state.deadlineMs, response.deadlineMs),
      };
    case 'invalid':
      // Not an elimination: same round, same deadline.
      return { ...state, notice: 'invalid', noticeSeq: state.noticeSeq + 1, sendError: null };
    default: {
      // accepted / eliminated / cleared: the round is over.
      const playerAnswer = response.status === 'eliminated' ? null : state.lastSent;
      const base: LastStandState = {
        ...state,
        notice: null,
        sendError: null,
        survived: response.survived,
        reveal: response.reveal && response.reveal.length > 0
          ? { entries: labelReveal(response.reveal, state.opponents), player: playerAnswer }
          : null,
        pendingRound: response.round,
        outcome: response.status === 'accepted' ? null : response.status,
        reason: response.reason,
        lastSent: null,
      };
      if (base.reveal) return { ...base, stage: 'reveal' };
      return advanceFromReveal({ ...base, stage: 'reveal' }, nowMs);
    }
  }
}

/** Leaves the reveal: next round after `accepted`, final screen otherwise. */
export function advanceFromReveal(state: LastStandState, nowMs: number): LastStandState {
  if (state.stage !== 'reveal') return state;
  if (state.pendingRound) {
    return {
      ...state,
      stage: 'round',
      round: state.pendingRound,
      roundStartedAtMs: nowMs,
      deadlineMs: state.pendingRound.timeMs,
      pendingRound: null,
      reveal: null,
      notice: null,
      sendError: null,
      lastSent: null,
    };
  }
  return { ...state, stage: 'final' };
}

export function lastStandAbsoluteDeadline(
  state: Pick<LastStandState, 'roundStartedAtMs' | 'deadlineMs'>,
): number {
  return state.roundStartedAtMs + state.deadlineMs;
}

// ---------- one submission at a time ----------

export interface LastStandSubmission {
  answer: string;
  /** ms from round start; never below the deadline for a late/expired submission. */
  atMs: number;
  expired: boolean;
}

export interface LastStandTiming {
  startedAtMs: number;
  deadlineAtMs: number;
}

/**
 * One request in flight, at most one submission past the deadline. Reusable within a round,
 * unlike QuestionSubmissionGate: `occupied` and `invalid` leave the round open.
 */
export class LastStandSubmitGate {
  private inFlight = false;
  private expiredSent = false;

  begin(answer: string, nowMs: number, timing: LastStandTiming): LastStandSubmission | null {
    if (this.inFlight) return null;
    const expired = nowMs >= timing.deadlineAtMs;
    const text = answer.trim();
    if (!expired && text === '') return null;
    if (expired && this.expiredSent) return null;

    this.inFlight = true;
    if (expired) this.expiredSent = true;
    const elapsed = Math.max(0, Math.round(nowMs - timing.startedAtMs));
    const deadlineElapsed = timing.deadlineAtMs - timing.startedAtMs;
    return {
      answer: text,
      atMs: expired ? Math.max(elapsed, deadlineElapsed) : elapsed,
      expired,
    };
  }

  /** Called when the request settled. Reopens the gate (a network error must be retryable). */
  release(): void {
    this.inFlight = false;
    this.expiredSent = false;
  }

  get busy(): boolean {
    return this.inFlight;
  }
}

// ---------- presentation helpers ----------

export function roundLabel(index: number): string {
  return `Круг ${Math.min(index + 1, LAST_STAND_TOTAL_ROUNDS)} из ${LAST_STAND_TOTAL_ROUNDS}`;
}

export function eliminationText(reason: LastStandEliminationReason | null): string {
  if (reason === 'timeout') return 'Время вышло, ответа не было.';
  if (reason === 'exhausted') return 'Свободных стран не осталось: все варианты заняли соперники.';
  return 'Ты выбыл.';
}

export function survivedText(survived: number): string {
  const mod100 = survived % 100;
  const mod10 = survived % 10;
  const word = mod100 >= 11 && mod100 <= 14
    ? 'кругов'
    : mod10 === 1 ? 'круг' : mod10 >= 2 && mod10 <= 4 ? 'круга' : 'кругов';
  return `${survived} ${word} из ${LAST_STAND_TOTAL_ROUNDS}`;
}

export function formatAnswerTime(atMs: number): string {
  return `${(Math.max(0, atMs) / 1000).toFixed(1).replace('.', ',')} с`;
}

export interface RevealRow {
  key: string;
  displayName: string;
  answer: string;
  atMs: number;
  isPlayer: boolean;
  /** Honest source label of an opponent (bot or recorded player); null for the player. */
  sourceLabel: string | null;
  /** Earliest answer in the round. */
  fastest: boolean;
}

/** Rows ordered by answer time (earlier first). The player's row exists only if they answered in time. */
export function buildRevealRows(snapshot: RevealSnapshot, playerName = 'Ты'): RevealRow[] {
  const rows: Omit<RevealRow, 'fastest'>[] = snapshot.entries.map((entry, i) => ({
    key: `o${i}`,
    displayName: entry.displayName,
    answer: entry.answerRu,
    atMs: entry.atMs,
    isPlayer: false,
    sourceLabel: entry.source ? LAST_STAND_SOURCE_LABELS[entry.source] : null,
  }));
  if (snapshot.player) {
    rows.push({
      key: 'me',
      displayName: playerName,
      answer: snapshot.player.answer,
      atMs: snapshot.player.atMs,
      isPlayer: true,
      sourceLabel: null,
    });
  }
  rows.sort((a, b) => a.atMs - b.atMs);
  const first = rows[0]?.atMs;
  return rows.map((row) => ({ ...row, fastest: row.atMs === first }));
}

export interface RankedLeaderboardEntry extends LastStandLeaderboardEntry {
  place: number;
}

/** Most survived rounds first; equal scores share a place and keep the server order. */
export function rankLeaderboard(entries: readonly LastStandLeaderboardEntry[]): RankedLeaderboardEntry[] {
  const sorted = entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => b.entry.survived - a.entry.survived || a.i - b.i)
    .map(({ entry }) => entry);
  let place = 0;
  let previous: number | null = null;
  return sorted.map((entry, i) => {
    if (entry.survived !== previous) {
      place = i + 1;
      previous = entry.survived;
    }
    return { ...entry, place };
  });
}

export function lastStandErrorMessage(kind: 'start' | 'send' | 'leaderboard', status?: number): string {
  if (status === 401 || status === 403) {
    return 'Не удалось подтвердить сессию. Вернись в Telegram или обнови страницу.';
  }
  if (kind === 'start') return 'Не удалось начать забег. Проверь соединение и попробуй ещё раз.';
  if (kind === 'send') return 'Ответ не отправился. Проверь соединение и нажми «Отправить» ещё раз.';
  return 'Не удалось загрузить таблицу дня. Попробуй ещё раз.';
}

/** Attaches the start-time source (bot / recorded player) to each revealed answer by display name. */
export function labelReveal(
  reveal: readonly LastStandRevealEntry[],
  opponents: readonly LastStandOpponent[],
): RevealSnapshot['entries'] {
  const used = new Set<number>();
  return reveal.map((entry) => {
    const index = opponents.findIndex((o, i) => !used.has(i) && o.displayName === entry.displayName);
    if (index >= 0) used.add(index);
    return { ...entry, source: index >= 0 ? opponents[index].source : undefined };
  });
}
