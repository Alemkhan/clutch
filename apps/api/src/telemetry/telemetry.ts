import type { Context, Hono } from 'hono';
import { ANALYTIC_EVENT_NAMES, QUESTION_REPORT_KINDS } from '@clutch/shared';
import { resolveRequestIdentity, type RequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';

type AppContext = Context<{ Bindings: Env }>;

// Капы равны колонкам миграции 0002. Сверх капа — ошибка, а не обрезание: потерять репорт из-за
// длинного поля честнее, чем хранить непонятно что; честный клиент в капы укладывается.
const REPORT_BODY_MAX_BYTES = 2048;
const QUESTION_ID_MAX = 128;
const RUN_ID_MAX = 64;
const CATEGORY_MAX = 32;
const PLAYER_ANSWER_MAX = 200;
const COMMENT_MAX = 500;

const EVENT_BODY_MAX_BYTES = 2048;
const EVENT_NAME_MAX = 64;
const PAYLOAD_KEYS_MAX = 4;
const PAYLOAD_STRING_MAX = 64;
const PAYLOAD_JSON_MAX = 512;

const REPORT_MODES = new Set(['solo', 'training']);
const REPORT_KINDS = new Set<string>(QUESTION_REPORT_KINDS);
const EVENT_NAMES = new Set<string>(ANALYTIC_EVENT_NAMES);

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

/** Необязательное текстовое поле в капе: null — поля нет, 'invalid' — не строка или пустое, 'too_long' — сверх капа. */
type TextOutcome = string | null | 'invalid' | 'too_long';

function readText(value: unknown, max: number): TextOutcome {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) return 'invalid';
  return value.length <= max ? value : 'too_long';
}

function isTextOutcomeError(outcome: TextOutcome): outcome is 'invalid' | 'too_long' {
  return outcome === 'invalid' || outcome === 'too_long';
}

/** payload — плоский объект ≤ 4 ключей; строки (включая имена ключей) ≤ 64; итоговый JSON ≤ 512 символов. */
function readPayload(value: unknown): { ok: true; json: string | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, json: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'invalid_payload' };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > PAYLOAD_KEYS_MAX) return { ok: false, reason: 'invalid_payload' };
  for (const [key, entry] of entries) {
    if (key.length > PAYLOAD_STRING_MAX) return { ok: false, reason: 'too_long' };
    if (typeof entry === 'string') {
      if (entry.length > PAYLOAD_STRING_MAX) return { ok: false, reason: 'too_long' };
    } else if (typeof entry !== 'boolean' && (typeof entry !== 'number' || !Number.isFinite(entry))) {
      return { ok: false, reason: 'invalid_payload' };
    }
  }
  const json = JSON.stringify(value);
  return json.length <= PAYLOAD_JSON_MAX ? { ok: true, json } : { ok: false, reason: 'too_long' };
}


/** Репорты о проблемах и минимальная аналитика (beta-cut R22, п. 5): приём без влияния на игру. */
export function registerTelemetryRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/reports', handleReport);
  app.post('/api/events', handleEvent);
}

/** Причина отказа для поля, не прошедшего readText: too_long как есть, остальное — общая причина запроса. */
const textFailure = (outcome: 'invalid' | 'too_long', fallback: string): string =>
  outcome === 'too_long' ? 'too_long' : fallback;

interface ReportFields {
  questionId: string;
  runId: string | null;
  category: string | null;
  mode: string;
  kind: string;
  verdict: boolean;
  playerAnswer: string | null;
  comment: string | null;
}

type ReportParse = { ok: true; fields: ReportFields } | { ok: false; reason: string };

function parseReport(body: Record<string, unknown>): ReportParse {
  const questionId = readText(body.questionId, QUESTION_ID_MAX);
  const runId = readText(body.runId, RUN_ID_MAX);
  const category = readText(body.category, CATEGORY_MAX);
  const playerAnswer = readText(body.playerAnswer, PLAYER_ANSWER_MAX);
  const comment = readText(body.comment, COMMENT_MAX);
  if (typeof body.mode !== 'string' || !REPORT_MODES.has(body.mode)) return { ok: false, reason: 'invalid_mode' };
  if (typeof body.kind !== 'string' || !REPORT_KINDS.has(body.kind)) return { ok: false, reason: 'invalid_kind' };
  if (typeof body.verdict !== 'boolean') return { ok: false, reason: 'invalid_report' };
  // questionId обязателен: его отсутствие readText превращает в null.
  if (questionId === null) return { ok: false, reason: 'invalid_report' };
  for (const field of [questionId, runId, category, playerAnswer, comment]) {
    if (isTextOutcomeError(field)) return { ok: false, reason: textFailure(field, 'invalid_report') };
  }
  return {
    ok: true,
    // Ошибочные значения отсеяны циклом выше.
    fields: {
      questionId: questionId as string,
      runId: runId as string | null,
      category: category as string | null,
      mode: body.mode,
      kind: body.kind,
      verdict: body.verdict,
      playerAnswer: playerAnswer as string | null,
      comment: comment as string | null,
    },
  };
}

async function insertReport(c: AppContext, playerId: string, report: ReportFields): Promise<void> {
  await c.env.DB.prepare(`
    INSERT INTO question_reports (
      id, player_id, question_id, run_id, category, mode, kind, verdict, player_answer, comment, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  `).bind(
    crypto.randomUUID(),
    playerId,
    report.questionId,
    report.runId,
    report.category,
    report.mode,
    report.kind,
    report.verdict ? 1 : 0,
    report.playerAnswer,
    report.comment,
    Date.now(),
  ).run();
}

async function handleReport(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'reports');
  if (identity instanceof Response) return identity;
  const parsed = await readJsonBody(c.req.raw, REPORT_BODY_MAX_BYTES);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object') {
    return c.json({ error: 'Invalid report.', reason: 'invalid_report' }, 400);
  }
  const report = parseReport(parsed.value as Record<string, unknown>);
  if (!report.ok) return c.json({ error: 'Invalid report.', reason: report.reason }, 400);

  await insertReport(c, identity.playerId, report.fields);
  return c.json({ ok: true }, 201);
}

interface EventFields {
  event: string;
  runId: string | null;
  questionId: string | null;
  payloadJson: string | null;
}

type EventParse = { ok: true; fields: EventFields } | { ok: false; error: string; reason: string };

function parseEvent(body: Record<string, unknown>): EventParse {
  if (typeof body.event !== 'string' || body.event.length === 0 || body.event.length > EVENT_NAME_MAX
    || !EVENT_NAMES.has(body.event)) {
    return { ok: false, error: 'Unknown analytics event.', reason: 'unknown_event' };
  }
  const runId = readText(body.runId, RUN_ID_MAX);
  const questionId = readText(body.questionId, QUESTION_ID_MAX);
  if (isTextOutcomeError(runId)) {
    return { ok: false, error: 'Invalid event.', reason: textFailure(runId, 'invalid_event') };
  }
  if (isTextOutcomeError(questionId)) {
    return { ok: false, error: 'Invalid event.', reason: textFailure(questionId, 'invalid_event') };
  }
  const payload = readPayload(body.payload);
  if (!payload.ok) return { ok: false, error: 'Invalid event payload.', reason: payload.reason };
  return { ok: true, fields: { event: body.event, runId, questionId, payloadJson: payload.json } };
}

async function handleEvent(c: AppContext): Promise<Response> {
  const identity = await authenticate(c, 'events');
  if (identity instanceof Response) return identity;
  const parsed = await readJsonBody(c.req.raw, EVENT_BODY_MAX_BYTES);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object') {
    return c.json({ error: 'Invalid event.', reason: 'invalid_event' }, 400);
  }
  const event = parseEvent(parsed.value as Record<string, unknown>);
  if (!event.ok) return c.json({ error: event.error, reason: event.reason }, 400);

  const { fields } = event;
  await c.env.DB.prepare(
    'INSERT INTO analytics_events (player_id, event, run_id, question_id, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  ).bind(identity.playerId, fields.event, fields.runId, fields.questionId, fields.payloadJson, Date.now()).run();
  return c.json({ ok: true }, 202);
}
