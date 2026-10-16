import type { Question, SoloAnswerRequest } from '@clutch/shared';
import type { SoloRoundRow } from './soloRoundsRepository';

const TEXT_MAX = 200;

/** Необязательные диагностические поля ответа: старый клиент их не шлёт. true — формат допустим. */
export function hasValidAnswerDiagnostics(body: Record<string, unknown>): boolean {
  const { selectedText, optionCount, firstOptionId } = body;
  return (selectedText === undefined || (typeof selectedText === 'string' && selectedText.length <= TEXT_MAX))
    && (optionCount === undefined
      || (typeof optionCount === 'number' && Number.isInteger(optionCount) && optionCount >= 0 && optionCount <= 64))
    && (firstOptionId === undefined || (typeof firstOptionId === 'string' && firstOptionId.length <= 128));
}

/**
 * Расхождение между тем, что игрок видел на кнопке (selectedText), и вариантом, id которого пришёл
 * в selectedAnswer. Только наблюдение: верность считается по selectedAnswer, как и раньше.
 */
export function answerOptionMismatch(question: Question, body: SoloAnswerRequest): Record<string, string | number> | null {
  if (question.answerType === 'open_answer' || body.selectedText === undefined) return null;
  const stored = question.options.find((option) => option.id === body.selectedAnswer);
  if (stored && stored.text === body.selectedText) return null;
  const detail: Record<string, string | number> = {
    roundIndex: body.roundIndex,
    selectedAnswer: body.selectedAnswer.slice(0, 64),
    selectedText: body.selectedText,
    storedText: stored?.text.slice(0, TEXT_MAX) ?? '',
    correctOptionId: question.correctOptionId,
  };
  if (body.optionCount !== undefined) detail.clientOptionCount = body.optionCount;
  if (body.firstOptionId !== undefined) detail.clientFirstOptionId = body.firstOptionId;
  return detail;
}

/**
 * Повтор ответа на уже записанный круг, но с другим ответом: сервер вернёт записанный вердикт,
 * а клиент покажет свой выбор рядом с чужой верностью. Так выглядит двойная отправка из двух копий.
 */
export function answerReplayConflict(
  stored: SoloRoundRow,
  body: SoloAnswerRequest,
  now: number,
): Record<string, string | number> | null {
  if (stored.selected_answer === body.selectedAnswer) return null;
  return {
    roundIndex: body.roundIndex,
    selectedAnswer: body.selectedAnswer.slice(0, 64),
    storedAnswer: stored.selected_answer.slice(0, 64),
    storedCorrect: stored.correct,
    storedAgeMs: Math.max(0, now - stored.created_at),
  };
}

type DiagnosticEvent = 'answer_option_mismatch' | 'answer_replay_conflict';

/** Пишет событие и строку в лог; сбой телеметрии ответ игрока не ломает. */
export async function reportAnswerDiagnostic(
  db: D1Database,
  event: DiagnosticEvent,
  playerId: string,
  runId: string,
  questionId: string,
  detail: Record<string, string | number>,
): Promise<void> {
  console.error({ event, runId, questionId, ...detail });
  try {
    await db.prepare(
      'INSERT INTO analytics_events (player_id, event, run_id, question_id, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    ).bind(playerId, event, runId, questionId, JSON.stringify(detail), Date.now()).run();
  } catch (error) {
    console.error(`${event} event failed:`, error instanceof Error ? error.message : 'unknown error');
  }
}
