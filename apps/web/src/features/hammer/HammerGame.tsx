import { useEffect, useMemo, useState } from 'react';
import type { MiniGameConfig, SkillResult } from '@clutch/shared';
import { hammerAttemptRules } from '@clutch/shared';
import { preloadImages } from './preloadImages';
import { hasSeenHammerIntro, markHammerIntroSeen } from './hammerIntro';
import { strikeNotes } from './hammerStrike';
import { useHammerStrike, useMarkerClock } from './useHammerStrike';
import { HammerIntro } from './HammerIntroCard';
import { HammerLane } from './HammerLane';
import { HammerResult, HammerResultStatus } from './HammerResult';
import { HammerScene } from './HammerScene';

export { HammerIntro } from './HammerIntroCard';
export { HammerResult, HammerResultStatus, strikeLabelText } from './HammerResult';

interface HammerGameProps {
  config: MiniGameConfig;
  questionId: string;
  previousSkillResults: readonly SkillResult[];
  /**
   * Третий аргумент — активное время удара, а не его качество: именно он уходит на сервер,
   * который сам выводит из него расстояние до цели и награду. Результат и награда здесь —
   * только для немедленной анимации и звука; зачётными их делает ответ сервера.
   */
  onComplete: (result: SkillResult, progressAwarded: number, activeElapsedMs: number) => void;
  /**
   * Сразу в момент удара (до анимации гвоздя): родитель обновляет HUD новым процентом и приростом.
   * Это превью по той же scoreHammerTap, что и на сервере; засчитывает всё равно ответ сервера.
   */
  onStrike?: (result: SkillResult, progressAwarded: number) => void;
  /** Процент игрока до этого удара: нужен для подписи «До 100% — ещё N%». Без него строки нет. */
  progressBefore?: number;
}

export function hammerActionSemantics(struck: boolean, result: SkillResult | null) {
  return {
    tabIndex: struck ? -1 : 0,
    'aria-disabled': struck,
    'aria-label': result ? 'Удар завершён' : 'Нажмите, чтобы ударить по пню',
  } as const;
}

export function HammerGame({ config, questionId, previousSkillResults, onComplete, onStrike, progressBefore }: HammerGameProps) {
  const attempt = useMemo(
    () => hammerAttemptRules(questionId, previousSkillResults, config),
    [config, previousSkillResults, questionId],
  );
  // Объяснение — шаг ДО попытки: пока оно открыто, часы маркера и аналитика не стартуют.
  const [introOpen, setIntroOpen] = useState(() => !hasSeenHammerIntro());
  const clock = useMarkerClock(attempt, introOpen);
  const { struck, result, handleTap, onNailSettled, onKeyDown } = useHammerStrike({
    attempt, config, questionId, previousSkillResults, introOpen, clock, onComplete, onStrike,
  });

  // Спрайты вспышек — несколько мегабайт; прогреваем кэш на монтировании, ошибки игнорируются.
  useEffect(() => {
    preloadImages(['/sprites/burst-hit.png', '/sprites/burst-perfect.png']);
  }, []);

  const notes = strikeNotes(result, progressBefore, previousSkillResults);
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
        onClick={handleTap}
        onKeyDown={onKeyDown}
      >
        {!result && <h2 className="stump-headline">Бей по пню!</h2>}
        <HammerScene struck={struck} result={result} onNailSettled={onNailSettled} />
        <HammerLane attempt={attempt} markerPos={clock.markerPos} />
        {result ? (
          <HammerResult result={result} {...notes} />
        ) : (
          <p className="strike-instruction">Тапни, когда маркер в центре</p>
        )}
      </div>
      {result && <HammerResultStatus result={result} {...notes} />}
    </>
  );
}
