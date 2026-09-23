import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  SKILL_REWARDS,
  generateMatch,
  isAnswerCorrect,
  resultFromDistance,
  type AsyncMatchRound,
  type AsyncMatchRoundInput,
  type CompleteAsyncMatchRequest,
  type CompleteAsyncMatchResponse,
  type Opponent,
  type Question,
  type StartAsyncMatchRequest,
  type StartAsyncMatchResponse,
} from '@clutch/shared';

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ENVIRONMENT: string;
}

interface RunRow {
  id: string;
  player_id: string;
  display_name: string;
  questions_json: string;
  rounds_json: string | null;
  progress: number;
  correct_count: number;
  status: 'in_progress' | 'completed';
}

interface TelegramUserPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

const app = new Hono<{ Bindings: Env }>();
const categories = new Set(['geography', 'history', 'languages']);

app.use('/api/*', cors());

function isStartRequest(value: unknown): value is StartAsyncMatchRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return typeof body.playerId === 'string'
    && body.playerId.length > 0
    && body.playerId.length <= 128
    && typeof body.displayName === 'string'
    && body.displayName.trim().length > 0
    && body.displayName.length <= 64
    && typeof body.category === 'string'
    && categories.has(body.category)
    && (body.telegramInitData === undefined
      || (typeof body.telegramInitData === 'string' && body.telegramInitData.length <= 8192));
}

async function hmacSha256(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function validateTelegramInitData(
  raw: string,
  botToken: string,
): Promise<TelegramUserPayload | null> {
  const params = new URLSearchParams(raw);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  const userJson = params.get('user');
  if (!receivedHash || !Number.isInteger(authDate) || !userJson || !botToken) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const encoder = new TextEncoder();
  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const calculatedHash = bytesToHex(await hmacSha256(secretKey, dataCheckString));
  if (!equalHex(calculatedHash, receivedHash.toLowerCase())) return null;

  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 300 || now - authDate > 86_400) return null;

  try {
    const user = JSON.parse(userJson) as TelegramUserPayload;
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string') return null;
    return user;
  } catch {
    return null;
  }
}

function isRoundInput(value: unknown): value is AsyncMatchRoundInput {
  if (!value || typeof value !== 'object') return false;
  const round = value as Record<string, unknown>;
  return typeof round.questionId === 'string'
    && typeof round.selectedAnswer === 'string'
    && typeof round.responseTimeMs === 'number'
    && Number.isFinite(round.responseTimeMs)
    && round.responseTimeMs >= 0
    && (round.skillDistance === undefined
      || (typeof round.skillDistance === 'number'
        && Number.isFinite(round.skillDistance)
        && round.skillDistance >= 0
        && round.skillDistance <= 1));
}

function correctFor(question: Question, selectedAnswer: string): boolean {
  if (question.answerType === 'open_answer') {
    return isAnswerCorrect(selectedAnswer, question.correctAnswers ?? []).correct;
  }
  return selectedAnswer === question.correctOptionId;
}

function botOpponent(questions: Question[]): Opponent {
  const rewards = [18, 12, 0, 25, 18, 0, 18, 12, 25, 18];
  return {
    id: 'clutch_bot',
    displayName: 'Alex',
    rounds: questions.map((question, index) => {
      const progressAwarded = rewards[index % rewards.length];
      return {
        questionId: question.id,
        correct: progressAwarded > 0,
        responseTimeMs: 2400 + (index % 4) * 500,
        skillScore: progressAwarded / 25,
        progressAwarded,
      };
    }),
  };
}

function ghostOpponent(row: RunRow, rounds: AsyncMatchRound[]): Opponent {
  return {
    id: row.id,
    displayName: row.display_name,
    rounds: rounds.map((round) => ({
      questionId: round.questionId,
      correct: round.correct,
      responseTimeMs: round.responseTimeMs,
      skillScore: round.progressAwarded / 25,
      progressAwarded: round.progressAwarded,
    })),
  };
}

app.get('/', (c) => {
  return c.json({
    name: 'Clutch API',
    status: 'ok',
    tagline: 'Knowledge earns the attempt. Skill wins the game.',
  });
});

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
  });
});

app.get('/api/tournaments/:slug', async (c) => {
  const slug = c.req.param('slug');
  return c.json({
    slug,
    message: 'Tournament endpoint ready. Connect D1 to return real data.',
  });
});

app.post('/api/async-matches', async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isStartRequest(body)) {
    return c.json({ error: 'Invalid playerId, displayName, or category.' }, 400);
  }

  let playerId = body.playerId;
  let displayName = body.displayName.trim();
  if (body.telegramInitData) {
    const telegramUser = await validateTelegramInitData(body.telegramInitData, c.env.TELEGRAM_BOT_TOKEN);
    if (!telegramUser) return c.json({ error: 'Invalid or expired Telegram initData.' }, 401);
    playerId = `telegram:${telegramUser.id}`;
    displayName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ')
      || telegramUser.username
      || displayName;
  }

  let ghost = await c.env.DB.prepare(`
    SELECT id, player_id, display_name, questions_json, rounds_json, progress, correct_count, status
    FROM match_runs
    WHERE category = ?1
      AND status = 'completed'
      AND player_id <> ?2
      AND id NOT IN (
        SELECT opponent_run_id FROM match_runs
        WHERE player_id = ?2 AND opponent_run_id IS NOT NULL
      )
    ORDER BY completed_at DESC
    LIMIT 1
  `).bind(body.category, playerId).first<RunRow>();

  if (!ghost) {
    ghost = await c.env.DB.prepare(`
      SELECT id, player_id, display_name, questions_json, rounds_json, progress, correct_count, status
      FROM match_runs
      WHERE category = ?1 AND status = 'completed' AND player_id <> ?2
      ORDER BY completed_at DESC
      LIMIT 1
    `).bind(body.category, playerId).first<RunRow>();
  }

  const questions = ghost
    ? JSON.parse(ghost.questions_json) as Question[]
    : generateMatch(10, 0.3, body.category);
  const storedRounds = ghost?.rounds_json
    ? JSON.parse(ghost.rounds_json) as AsyncMatchRound[]
    : null;
  const opponent = ghost && storedRounds ? ghostOpponent(ghost, storedRounds) : botOpponent(questions);
  const matchId = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO match_runs (
      id, player_id, display_name, category, questions_json, opponent_run_id, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    matchId,
    playerId,
    displayName,
    body.category,
    JSON.stringify(questions),
    ghost?.id ?? null,
    Date.now(),
  ).run();

  const response: StartAsyncMatchResponse = {
    matchId,
    questions,
    opponent,
    opponentSource: ghost ? 'player' : 'bot',
  };
  return c.json(response, 201);
});

app.post('/api/async-matches/:id/complete', async (c) => {
  const matchId = c.req.param('id');
  const body = await c.req.json<CompleteAsyncMatchRequest>().catch(() => null);
  if (!body || !Array.isArray(body.rounds) || body.rounds.length === 0 || !body.rounds.every(isRoundInput)) {
    return c.json({ error: 'Invalid rounds.' }, 400);
  }

  const run = await c.env.DB.prepare(`
    SELECT id, player_id, display_name, questions_json, rounds_json, progress, correct_count, status
    FROM match_runs WHERE id = ?1
  `).bind(matchId).first<RunRow>();
  if (!run) return c.json({ error: 'Match not found.' }, 404);

  if (run.status === 'completed' && run.rounds_json) {
    const response: CompleteAsyncMatchResponse = {
      matchId,
      rounds: JSON.parse(run.rounds_json) as AsyncMatchRound[],
      playerProgress: run.progress,
      correctCount: run.correct_count,
    };
    return c.json(response);
  }

  const questions = JSON.parse(run.questions_json) as Question[];
  if (body.rounds.length > questions.length) {
    return c.json({ error: 'Too many rounds.' }, 400);
  }

  let progress = 0;
  let correctCount = 0;
  const rounds: AsyncMatchRound[] = [];

  for (let index = 0; index < body.rounds.length; index++) {
    const submitted = body.rounds[index];
    const question = questions[index];
    if (!question || submitted.questionId !== question.id) {
      return c.json({ error: `Unexpected question at round ${index + 1}.` }, 400);
    }

    const correct = correctFor(question, submitted.selectedAnswer);
    if (correct) correctCount++;
    const distance = correct && submitted.skillDistance !== undefined
      ? submitted.skillDistance
      : undefined;
    const skillResult = distance === undefined ? undefined : resultFromDistance(distance);
    const progressAwarded = skillResult ? SKILL_REWARDS[skillResult] : 0;
    progress = Math.min(100, progress + progressAwarded);
    rounds.push({
      questionId: question.id,
      correct,
      responseTimeMs: Math.round(Math.min(submitted.responseTimeMs, 60_000)),
      skillResult,
      progressAwarded,
      playerProgressAfter: progress,
    });
  }

  await c.env.DB.prepare(`
    UPDATE match_runs
    SET rounds_json = ?2, progress = ?3, correct_count = ?4,
        status = 'completed', completed_at = ?5
    WHERE id = ?1 AND status = 'in_progress'
  `).bind(matchId, JSON.stringify(rounds), progress, correctCount, Date.now()).run();

  const response: CompleteAsyncMatchResponse = {
    matchId,
    rounds,
    playerProgress: progress,
    correctCount,
  };
  return c.json(response);
});

app.get('/api/leaderboard', async (c) => {
  const category = c.req.query('category') ?? 'geography';
  if (!categories.has(category)) return c.json({ error: 'Invalid category.' }, 400);
  const result = await c.env.DB.prepare(`
    SELECT display_name AS displayName, MAX(progress) AS progress,
           MAX(correct_count) AS correctCount, MAX(completed_at) AS completedAt
    FROM match_runs
    WHERE category = ?1 AND status = 'completed'
    GROUP BY player_id, display_name
    ORDER BY progress DESC, correctCount DESC, completedAt ASC
    LIMIT 50
  `).bind(category).all();
  return c.json({ category, entries: result.results });
});

export default app;
