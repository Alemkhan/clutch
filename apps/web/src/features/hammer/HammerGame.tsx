import { useMemo, useState } from 'react';
import type { MiniGameConfig, SkillResult } from '@clutch/shared';
import { SKILL_REWARDS, SOLO_TARGET_PROGRESS, hammerAttemptRules } from '@clutch/shared';
import { hasSeenHammerIntro, markHammerIntroSeen } from './hammerIntro';
import { strikeGain, strikeNotes } from './hammerStrike';
import { useHammerStrike, useMarkerClock } from './useHammerStrike';
import { HammerIntro } from './HammerIntroCard';
import { HammerLane } from './HammerLane';
import { HammerResult, HammerResultStatus } from './HammerResult';
import { HammerScene } from './HammerScene';
import { m } from './messages';
import { messagesFor } from '../../i18n/messages';

export { HammerIntro } from './HammerIntroCard';
export { HammerResult, HammerResultStatus, strikeLabelText } from './HammerResult';

interface HammerGameProps {
  config: MiniGameConfig;
  questionId: string;
  previousSkillResults: readonly SkillResult[];
  /**
   * Третий аргумент - активное время удара, а не его качество: именно он уходит на сервер,
   * который сам выводит из него расстояние до цели и награду. Результат и награда здесь -
   * только для немедленной анимации и звука; зачётными их делает ответ сервера.
   */
  onComplete: (result: SkillResult, progressAwarded: number, activeElapsedMs: number) => void;
  /**
   * Сразу в момент удара (до анимации гвоздя): родитель обновляет HUD новым процентом и приростом.
   * Это превью по той же scoreHammerTap, что и на сервере; засчитывает всё равно ответ сервера.
   */
  onStrike?: (result: SkillResult, progressAwarded: number) => void;
  /** Процент игрока до этого удара: глубина гвоздя и строка «Гвоздь вошёл на N% · до 100% - ещё M%». Без него гвоздь в начальном положении, строки нет. */
  progressBefore?: number;
}

export function hammerActionSemantics(struck: boolean, result: SkillResult | null) {
  return {
    tabIndex: struck ? -1 : 0,
    'aria-disabled': struck,
    'aria-label': result ? messagesFor(m).strikeDone : messagesFor(m).strikeAction,
  } as const;
}

export function HammerGame({ config, questionId, previousSkillResults, onComplete, onStrike, progressBefore }: HammerGameProps) {
  const attempt = useMemo(
    () => hammerAttemptRules(questionId, previousSkillResults, config),
    [config, previousSkillResults, questionId],
  );
  // Объяснение - шаг ДО попытки: пока оно открыто, часы маркера и аналитика не стартуют.
  const [introOpen, setIntroOpen] = useState(() => !hasSeenHammerIntro());
  const clock = useMarkerClock(attempt, introOpen);
  const { struck, result, handleTap, onNailSettled, onKeyDown } = useHammerStrike({
    attempt, config, questionId, previousSkillResults, introOpen, clock, onComplete, onStrike,
  });

  const t = messagesFor(m);
  const baseNotes = strikeNotes(result, progressBefore, previousSkillResults);
  const gain = result && progressBefore !== undefined ? strikeGain(progressBefore, SKILL_REWARDS[result]) : null;
  // Строка макета: «Гвоздь вошёл на N% · до 100% - ещё M%». Глубина = реальный процент игрока после удара.
  const notes = gain
    ? {
        ...baseNotes,
        remaining: gain.remaining > 0
          ? t.nailRemaining(gain.total, SOLO_TARGET_PROGRESS, gain.remaining)
          : t.nailReached(gain.total, SOLO_TARGET_PROGRESS),
      }
    : baseNotes;
  const confirmIntro = () => {
    markHammerIntroSeen();
    setIntroOpen(false);
  };

  return (
    <>
      {introOpen && <HammerIntro onConfirm={confirmIntro} />}
      <div
        className="hammer-game"
        role="button"
        {...hammerActionSemantics(struck || introOpen, result)}
        aria-hidden={introOpen || undefined}
        onPointerDown={(event) => {
          if (event.button === 0 && event.isPrimary) handleTap(event);
        }}
        onClick={handleTap}
        onKeyDown={onKeyDown}
      >
        {!result && (
          <div className="hammer-headline">
            <h2 className="hammer-headline-title">{t.title}</h2>
            <p className="hammer-headline-sub">{t.subtitle}</p>
          </div>
        )}
        <HammerScene
          struck={struck}
          result={result}
          progressBefore={progressBefore}
          gain={gain?.gain ?? 0}
          onNailSettled={onNailSettled}
        />
        <HammerLane attempt={attempt} markerPos={clock.markerPos} />
        {result ? (
          <HammerResult result={result} {...notes} />
        ) : (
          <p className="strike-instruction">{t.instruction}</p>
        )}
      </div>
      {result && <HammerResultStatus result={result} {...notes} />}
    </>
  );
}
