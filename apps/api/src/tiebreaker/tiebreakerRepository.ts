import {
  parseTiebreakerExplanation,
  tiebreakerDistribution,
  tiebreakerPercentile,
  type TiebreakAnswer,
  type TiebreakerAnsweredView,
  type TiebreakerExplanation,
} from '@clutch/shared';

/** Строка вопроса целиком: answer и source_url остаются на сервере до ответа игрока. */
export interface TiebreakerQuestionRow {
  id: string;
  /** Порядковый номер: число вопросов с active_date не позже этого. */
  number: number;
  prompt: string;
  /** Короткая формулировка для карточки; null — не задана. */
  cardPrompt: string | null;
  unit: string;
  answer: number;
  sourceUrl: string;
  asOfDate: string;
  /** Сырой JSON разбора; наружу идёт только после разбора и проверки. */
  explanationJson: string;
}

export interface TiebreakerPlayerAnswer {
  guess: number;
  multiplier: number;
}

interface QuestionDbRow {
  id: string;
  number: number;
  prompt: string;
  card_prompt: string | null;
  unit: string;
  answer: number;
  source_url: string;
  as_of_date: string;
  explanation_json: string;
}

/** Вопрос суток по ключу dailyKey(); null — на этот день вопроса нет. */
export async function findQuestionByDate(db: D1Database, dateKey: string): Promise<TiebreakerQuestionRow | null> {
  const row = await db.prepare(
    `SELECT id, prompt, card_prompt, unit, answer, source_url, as_of_date, explanation_json,
      (SELECT COUNT(*) FROM tiebreaker_questions earlier WHERE earlier.active_date <= tiebreaker_questions.active_date) AS number
    FROM tiebreaker_questions WHERE active_date = ?1`,
  ).bind(dateKey).first<QuestionDbRow>();
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    prompt: row.prompt,
    cardPrompt: row.card_prompt,
    unit: row.unit,
    answer: row.answer,
    sourceUrl: row.source_url,
    asOfDate: row.as_of_date,
    explanationJson: row.explanation_json,
  };
}

/** Сколько игроков ответили на вопрос: COUNT по idx_tiebreaker_answers_question, без выборки строк. */
export async function countQuestionAnswers(db: D1Database, questionId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS total FROM tiebreaker_answers WHERE question_id = ?1')
    .bind(questionId).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function findPlayerAnswer(
  db: D1Database,
  playerId: string,
  questionId: string,
): Promise<TiebreakerPlayerAnswer | null> {
  return db.prepare(
    'SELECT guess, multiplier FROM tiebreaker_answers WHERE player_id = ?1 AND question_id = ?2',
  ).bind(playerId, questionId).first<TiebreakerPlayerAnswer>();
}

/**
 * Прикидка игрока за сутки для резолюции ничьей; null — не отвечал или не засчитывается.
 * Засчитываются только Telegram-аккаунты: гость бесплатен, и вторым аккаунтом можно подсмотреть
 * число. Ответ гостя хранится и показывается ему самому (маршруты /api/tiebreaker/* читают
 * `findPlayerAnswer`), но в резолюции он считается «не ответил». Правило живёт только здесь.
 */
export async function findTiebreakAnswer(
  db: D1Database,
  playerId: string,
  dateKey: string,
): Promise<TiebreakAnswer | null> {
  if (!playerId.startsWith('telegram:')) return null;
  const row = await db.prepare(
    'SELECT question_id, multiplier FROM tiebreaker_answers WHERE player_id = ?1 AND date_key = ?2',
  ).bind(playerId, dateKey).first<{ question_id: string; multiplier: number }>();
  return row ? { questionId: row.question_id, multiplier: row.multiplier } : null;
}

/** Вставка без перезаписи: false — игрок уже отвечал (конфликт по PK), сохранённое не тронуто. */
export async function insertPlayerAnswer(
  db: D1Database,
  input: { playerId: string; questionId: string; dateKey: string; guess: number; multiplier: number; now: number },
): Promise<boolean> {
  const result = await db.prepare(`
    INSERT INTO tiebreaker_answers (player_id, question_id, date_key, guess, multiplier, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT (player_id, question_id) DO NOTHING
  `).bind(input.playerId, input.questionId, input.dateKey, input.guess, input.multiplier, input.now).run();
  return (result.meta.changes ?? 0) === 1;
}

/** Разбор из базы; повреждённый не роняет маршрут: null и лог без содержимого. */
function readExplanation(question: TiebreakerQuestionRow): TiebreakerExplanation | null {
  try {
    return parseTiebreakerExplanation(JSON.parse(question.explanationJson));
  } catch {
    console.error('tiebreaker: invalid explanation_json', { questionId: question.id });
    return null;
  }
}

/** Вскрытие для игрока, уже ответившего: свой ответ, правильное число и статистика всех ответов дня. */
export async function buildAnsweredView(
  db: D1Database,
  question: TiebreakerQuestionRow,
  own: TiebreakerPlayerAnswer,
): Promise<TiebreakerAnsweredView> {
  const { results } = await db.prepare(
    'SELECT guess, multiplier FROM tiebreaker_answers WHERE question_id = ?1',
  ).bind(question.id).all<TiebreakerPlayerAnswer>();
  const rows = results ?? [];
  return {
    guess: own.guess,
    multiplier: own.multiplier,
    answer: question.answer,
    sourceUrl: question.sourceUrl,
    asOfDate: question.asOfDate,
    distribution: tiebreakerDistribution(rows.map((row) => row.guess / question.answer)),
    totalAnswers: rows.length,
    percentile: tiebreakerPercentile(own.multiplier, rows.map((row) => row.multiplier)),
    explanation: readExplanation(question),
  };
}
