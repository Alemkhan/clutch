/**
 * Телеметрия игрока: репорты о проблемах с вопросом и минимальные продуктовые события
 * (PLAYTEST_03, beta-cut R22, п. 5). Контракт один для клиента и API-маршрутов:
 * allowlist имён и причины репортов живут здесь, чтобы стороны не разошлись.
 */

/** Что игрок считает проблемой в вопросе. */
export type QuestionReportKind = 'wrong_answer' | 'answer_not_accepted' | 'other';

export const QUESTION_REPORT_KINDS: readonly QuestionReportKind[] = [
  'wrong_answer',
  'answer_not_accepted',
  'other',
];

/** Где показан разбор: соло-забег (включая практику и дружескую дуэль) или отработка ошибок. */
export type QuestionReportMode = 'solo' | 'training';

/** Тело POST /api/reports. Личность игрока не в теле: её проверяет сервер из заголовка. */
export interface QuestionReportRequest {
  questionId: string;
  runId?: string;
  category?: string;
  mode: QuestionReportMode;
  kind: QuestionReportKind;
  /** Вердикт сервера по ответу, при котором игрок пожаловался. */
  verdict: boolean;
  playerAnswer?: string;
  comment?: string;
}

/** Разрешённые продуктовые события; сервер незнакомое имя отклоняет. */
export type AnalyticsEventName = 'solo_run_started' | 'solo_run_completed' | 'training_started' | 'sound_failure' | 'tiebreaker_answered' | 'tiebreaker_shared' | 'answer_option_mismatch' | 'answer_replay_conflict' | 'client_error' | 'app_opened' | 'result_shared' | 'friend_invite_shared';

export const ANALYTIC_EVENT_NAMES: readonly AnalyticsEventName[] = [
  'solo_run_started',
  'solo_run_completed',
  'training_started',
  'sound_failure',
  'tiebreaker_answered',
  'tiebreaker_shared',
  'answer_option_mismatch',
  'answer_replay_conflict',
  'client_error',
  'app_opened',
  'result_shared',
  'friend_invite_shared',
];

export type AnalyticsEventValue = string | boolean | number;

/** Плоский объект: не больше 4 ключей, строки не длиннее 64 символов (проверяет сервер). */
export type AnalyticsEventPayload = Record<string, AnalyticsEventValue>;

/** Тело POST /api/events. */
export interface AnalyticsEventRequest {
  event: AnalyticsEventName;
  runId?: string;
  questionId?: string;
  payload?: AnalyticsEventPayload;
}
