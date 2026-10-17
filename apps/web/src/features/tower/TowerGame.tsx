import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { MiniGameConfig, SkillResult } from '@clutch/shared';
import { hammerAttemptRules } from '@clutch/shared';
import { strikeNotes } from '../hammer/hammerStrike';
import { markerPositionAtElapsed } from '../hammer/hammerMotion';
import { HammerResult, HammerResultStatus } from '../hammer/HammerResult';
import { useHammerStrike, useMarkerClock } from '../hammer/useHammerStrike';
import { TowerIntro } from './TowerIntroCard';
import { TowerScene } from './TowerScene';
import { hasSeenTowerIntro, markTowerIntroSeen } from './towerIntro';
import { towerFloorCount, towerLanding, towerThresholdLabels } from './towerGeometry';

interface TowerGameProps {
  config: MiniGameConfig;
  questionId: string;
  previousSkillResults: readonly SkillResult[];
  /** Тот же контракт, что у HammerGame: третий аргумент — активное время тапа, его и проверяет сервер. */
  onComplete: (result: SkillResult, progressAwarded: number, activeElapsedMs: number) => void;
  onStrike?: (result: SkillResult, progressAwarded: number) => void;
  progressBefore?: number;
}

export function towerActionSemantics(struck: boolean, result: SkillResult | null) {
  return {
    tabIndex: struck ? -1 : 0,
    'aria-disabled': struck,
    'aria-label': result ? 'Блок упал' : 'Нажми, чтобы уронить блок',
  } as const;
}

export function TowerGame({ config, questionId, previousSkillResults, onComplete, onStrike, progressBefore }: TowerGameProps) {
  const attempt = useMemo(
    () => hammerAttemptRules(questionId, previousSkillResults, config),
    [config, previousSkillResults, questionId],
  );
  const reduceMotion = useReducedMotion();
  // Объяснение — шаг ДО попытки: пока оно открыто, часы блока и аналитика не стартуют.
  const [introOpen, setIntroOpen] = useState(() => !hasSeenTowerIntro());
  const clock = useMarkerClock(attempt, introOpen);
  const { struck, result, handleTap, onNailSettled, onKeyDown } = useHammerStrike({
    attempt, config, questionId, previousSkillResults, introOpen, clock, onComplete, onStrike,
  });

  // Без анимации падения нечего ждать: результат показан сразу, колбэк окончания вызывается сам.
  useEffect(() => {
    if (result && reduceMotion) onNailSettled();
  }, [result, reduceMotion]);

  const landing = result
    ? towerLanding(markerPositionAtElapsed(clock.elapsedRef.current, attempt.markerSpeed), attempt.targetCenter, result)
    : null;
  const notes = strikeNotes(result, progressBefore, previousSkillResults);
  const labels = useMemo(() => towerThresholdLabels(attempt), [attempt]);
  const confirmIntro = () => {
    markTowerIntroSeen();
    setIntroOpen(false);
  };

  return (
    <>
      {introOpen && <TowerIntro onConfirm={confirmIntro} />}
      <div
        className="tower-game"
        role="button"
        {...towerActionSemantics(struck || introOpen, result)}
        aria-hidden={introOpen || undefined}
        onClick={handleTap}
        onKeyDown={onKeyDown}
      >
        <div className="tower-stage">
          <div className="tower-caption" aria-hidden="true">
            <h2 className="tower-title">Башня</h2>
            {landing && <p className="tower-match">Совпало {landing.overlapPercent}% с нижним блоком</p>}
          </div>
          <TowerScene
            floors={towerFloorCount(previousSkillResults)}
            targetCenter={attempt.targetCenter}
            markerPos={clock.markerPos}
            result={result}
            landing={landing}
            onSettled={onNailSettled}
          />
        </div>
        <ul className="tower-thresholds" aria-hidden="true">
          {labels.map((label) => (
            <li key={label.result} className={`tower-threshold${label.result === result ? ' is-hit' : ''}`}>
              {label.minOverlap === null ? 'мимо' : `≥${label.minOverlap}%`} +{label.points}
            </li>
          ))}
        </ul>
        {result ? (
          <HammerResult result={result} {...notes} />
        ) : (
          <p className="strike-instruction">Тапни, чтобы уронить блок</p>
        )}
      </div>
      {result && <HammerResultStatus result={result} {...notes} />}
    </>
  );
}
