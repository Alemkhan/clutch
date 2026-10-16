import type { CategoryId, PracticeLevel, QuestionReportKind, SkillResult } from "@clutch/shared";
import type { ResolutionReportStatus } from "../round/reportPanel";
import type { SoloFlowState } from "./soloRunFlow";
import type { SoloSaveState } from "./useSoloRun";

/** Удар, уже сыгранный на круге roundsPlayed, но ещё не засчитанный в сохранённый прогресс. */
export interface PendingStrike {
  roundsPlayed: number;
  reward: number;
}

export interface SoloRunScreenProps {
  state: SoloFlowState;
  save: SoloSaveState;
  onSelectCategory: (category: CategoryId) => void;
  onRetryStart: () => void;
  onBackToCategories: () => void;
  /** Забег начат с главной без выбора категории: «Назад» ведёт на главную, а не в пустой выбор. */
  onExit?: () => void;
  onStart: () => void;
  onAnswer: (optionId: string, timeMs: number) => void;
  onContinue: () => void;
  /** Удар только что сыгран (до анимации): HUD сразу показывает новый процент. */
  strike?: PendingStrike | null;
  onStrike?: (result: SkillResult, reward: number) => void;
  onHammerComplete: (
    result: unknown,
    progress: number,
    distance: number,
  ) => void;
  /** Итог приходит вместе с последним кругом, повторять нечего; свойство осталось для экрана результата. */
  onRetrySave?: () => void;
  /** Запрос круга не дошёл после повторов: прогресс на сервере цел, круг можно отправить снова. */
  syncError?: string | null;
  canRetrySync?: boolean;
  onRetrySync?: () => void;
  /** В тренировке «домой» ведёт к выбору уровня. */
  onHome: () => void;
  onMyRuns: () => void;
  /** Напоминание «На глазок» на экране готовности; без него строки нет. */
  onOpenTiebreaker?: () => void;
  /** Тренировка против бота: другой текст и итог, результат не засчитывается. */
  practice?: PracticeLevel;
  /** Репорт о проблеме на разборе: экран только рисует, сеть и статус живут в SoloRun. */
  onReport?: (kind: QuestionReportKind, comment: string) => void;
  reportState?: ResolutionReportStatus;
}
