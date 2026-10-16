import { resolveQuestionById } from '@clutch/shared';

/** Сколько вопросов в одной сессии отработки ошибок. */
export const TRAINING_SESSION_SIZE = 10;
/** Потолок открытых ошибок на игрока: при переполнении вытесняется самая старая. */
export const MAX_OPEN_MISTAKES = 200;

interface MistakeRow {
  question_id: string;
  owed_count: number;
}

/** Неверный ответ в соло-забеге: +1 к долгу, строка (пере)открывается. */
export async function recordMistake(db: D1Database, playerId: string, questionId: string, now: number): Promise<void> {
  await db.prepare(`
    INSERT INTO player_mistakes (player_id, question_id, owed_count, first_mistake_at, last_mistake_at, resolved_at)
    VALUES (?1, ?2, 1, ?3, ?3, NULL)
    ON CONFLICT (player_id, question_id) DO UPDATE SET
      owed_count = CASE WHEN resolved_at IS NULL THEN owed_count + 1 ELSE 1 END,
      last_mistake_at = ?3,
      resolved_at = NULL
  `).bind(playerId, questionId, now).run();
  // Потолок: лишние самые старые открытые ошибки считаются решёнными, а не удаляются.
  await db.prepare(`
    UPDATE player_mistakes SET resolved_at = ?2
    WHERE player_id = ?1 AND resolved_at IS NULL AND question_id IN (
      SELECT question_id FROM player_mistakes
      WHERE player_id = ?1 AND resolved_at IS NULL
      ORDER BY last_mistake_at DESC, question_id ASC LIMIT -1 OFFSET ?3
    )
  `).bind(playerId, now, MAX_OPEN_MISTAKES).run();
}

/** Верный ответ в отработке: -1 к долгу; на нуле строка помечается решённой. */
export async function payBackMistake(db: D1Database, playerId: string, questionId: string, now: number): Promise<void> {
  await db.prepare(`
    UPDATE player_mistakes
    SET owed_count = owed_count - 1,
        resolved_at = CASE WHEN owed_count - 1 <= 0 THEN ?3 ELSE NULL END
    WHERE player_id = ?1 AND question_id = ?2 AND resolved_at IS NULL AND owed_count > 0
  `).bind(playerId, questionId, now).run();
}

/**
 * Вопросы незавершённых забегов игрока, на которые он ещё не ответил. Ответ на уже сыгранный круг сервер
 * игроку показал, а эти — нет: отдать их в тренировку значит выдать ответ до игры. Брошенный забег
 * остаётся in_progress навсегда, поэтому его сыгранные круги не блокируются, иначе отработка опустела бы.
 */
async function activeRunQuestionIds(db: D1Database, playerId: string): Promise<Set<string>> {
  const result = await db.prepare(`
    SELECT r.questions_json AS questions_json,
           (SELECT COUNT(*) FROM solo_run_rounds s WHERE s.run_id = r.id) AS answered
    FROM match_runs r
    WHERE r.player_id = ?1 AND r.status = 'in_progress'
    ORDER BY r.created_at DESC LIMIT 50
  `).bind(playerId).all<{ questions_json: string; answered: number }>();
  const blocked = new Set<string>();
  for (const row of result.results) {
    let questions: unknown;
    try {
      questions = JSON.parse(row.questions_json);
    } catch {
      continue;
    }
    if (!Array.isArray(questions)) continue;
    questions.slice(Number(row.answered)).forEach((question) => {
      const id = (question as { id?: unknown } | null)?.id;
      if (typeof id === 'string') blocked.add(id);
    });
  }
  return blocked;
}

/**
 * Ошибки, которые можно отработать: открытые, вопрос ещё собирается и он не лежит в непройденной части
 * активного забега. Порядок сессии: больше долг — раньше, при равенстве свежая ошибка раньше.
 */
export async function listTrainableMistakes(db: D1Database, playerId: string): Promise<string[]> {
  const result = await db.prepare(`
    SELECT question_id, owed_count FROM player_mistakes
    WHERE player_id = ?1 AND resolved_at IS NULL AND owed_count > 0
    ORDER BY owed_count DESC, last_mistake_at DESC, question_id ASC
    LIMIT ?2
  `).bind(playerId, MAX_OPEN_MISTAKES).all<MistakeRow>();
  if (result.results.length === 0) return [];
  const blocked = await activeRunQuestionIds(db, playerId);
  return result.results
    .map((row) => row.question_id)
    .filter((id) => !blocked.has(id) && resolveQuestionById(id) !== null);
}
