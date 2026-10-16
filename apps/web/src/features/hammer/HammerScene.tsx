import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SOLO_TARGET_PROGRESS, type SkillResult } from '@clutch/shared';

/**
 * Сцена удара: доска в разрезе, гвоздь, молоток и шкала 0-100% сбоку. Всё в одном SVG, без растров.
 * Глубина гвоздя = прогресс забега игрока: до удара progressBefore, после удара progressBefore + реальный прирост.
 * Координаты — в единицах viewBox; доска и шкала имеют общий «нуль» по верхней грани доски.
 */
export const SCENE_W = 340;
export const SCENE_H = 276;
const BOARD_TOP = 180;
const NAIL_X = 150;
const NAIL_LEN = 80;
/** Ход шляпки гвоздя от 0% до 100%. */
export const NAIL_TRAVEL = 74;
/** Шляпка гвоздя на 0%: остриё чуть вошло в доску. */
const NAIL_HEAD_Y0 = BOARD_TOP + 6 - NAIL_LEN;
const SCALE_X = 284;

const HAMMER_IDLE_DEG = -22;
const HAMMER_STRUCK_DEG = 3;
const HAMMER_PIVOT = '-104px -20px';
/** Промах/нулевой прирост: гвоздь не двигается, но игрок должен успеть увидеть удар. */
const STILL_SETTLE_MS = 450;

/** Смещение шляпки от положения 0% до глубины p (в единицах viewBox). Глубина кэпается 0..100. */
export function nailOffset(percent: number): number {
  const p = Math.min(SOLO_TARGET_PROGRESS, Math.max(0, percent));
  return (NAIL_TRAVEL * p) / SOLO_TARGET_PROGRESS;
}

/** Глубина гвоздя после удара: реальный прирост, не выше цели. */
export function nailDepthAfter(before: number, gain: number): number {
  return Math.min(SOLO_TARGET_PROGRESS, Math.max(0, before) + Math.max(0, gain));
}

const scaleY = (percent: number) => BOARD_TOP + 6 + nailOffset(percent);

export function HammerScene({ struck, result, progressBefore, gain = 0, onNailSettled }: {
  struck: boolean;
  result: SkillResult | null;
  /** Процент игрока до удара. Без него гвоздь стоит в начальном положении и прироста на сцене нет. */
  progressBefore?: number;
  /** Реальный прирост этого удара (у цели может быть меньше награды зоны). */
  gain?: number;
  /** Вызывается, когда гвоздь дошёл до конца анимации погружения (сразу, если двигаться нечему). */
  onNailSettled: () => void;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const known = progressBefore !== undefined;
  const before = known ? Math.min(SOLO_TARGET_PROGRESS, Math.max(0, progressBefore)) : 0;
  const after = nailDepthAfter(before, known ? gain : 0);
  const beforeY = nailOffset(before);
  const afterY = nailOffset(after);
  const targetY = result ? afterY : beforeY;
  const moves = result !== null && targetY !== beforeY;
  const showGain = result !== null && known && after > before;
  const hammerY = NAIL_HEAD_Y0 + beforeY;

  // Если гвоздь не едет (промах, цель достигнута) или движение отключено, framer-motion не сообщит
  // об окончании анимации, а на этом колбэке держится завершение круга.
  useEffect(() => {
    if (!result) return undefined;
    if (reduceMotion) {
      onNailSettled();
      return undefined;
    }
    if (moves) return undefined;
    const timer = setTimeout(onNailSettled, STILL_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [result, reduceMotion, moves]);

  const animated = struck && !reduceMotion;
  const hammerDeg = animated ? HAMMER_STRUCK_DEG : HAMMER_IDLE_DEG;
  const impact = result !== null && result !== 'miss' && !reduceMotion;
  const tickPercents = [0, 50, 100];
  const markTop = NAIL_HEAD_Y0 + beforeY;
  const markBottom = NAIL_HEAD_Y0 + afterY;

  return (
    <div className={`hammer-scene ${animated ? 'shake' : ''}`} aria-hidden="true">
      <svg className="hammer-scene-svg" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMid meet">
        {/* Доска в разрезе */}
        <rect x="8" y={BOARD_TOP} width="260" height={SCENE_H - BOARD_TOP - 8} fill="#c8925a" />
        <rect x="8" y={BOARD_TOP} width="260" height="9" fill="#d9a974" />
        <path
          d={`M16 ${BOARD_TOP + 34} C90 ${BOARD_TOP + 28}, 190 ${BOARD_TOP + 40}, 268 ${BOARD_TOP + 32} M16 ${BOARD_TOP + 62} C100 ${BOARD_TOP + 56}, 200 ${BOARD_TOP + 70}, 268 ${BOARD_TOP + 60}`}
          fill="none"
          stroke="#b07a45"
          strokeWidth="2"
        />
        <rect x={NAIL_X - 6} y={BOARD_TOP} width="12" height={SCENE_H - BOARD_TOP - 8} fill="#b07a45" opacity="0.45" />

        {/* Гвоздь: смещение y считается от положения 0% */}
        <g transform={`translate(${NAIL_X} ${NAIL_HEAD_Y0})`}>
          <motion.g
            className="hammer-nail"
            initial={false}
            animate={{ y: targetY }}
            transition={{ duration: reduceMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={onNailSettled}
          >
            <rect x="-3" y="8" width="6" height={NAIL_LEN - 8} fill="#8a8f96" />
            <path d={`M-3 ${NAIL_LEN} L0 ${NAIL_LEN + 11} L3 ${NAIL_LEN} Z`} fill="#8a8f96" />
            <rect x="-17" y="0" width="34" height="8" rx="3" fill="#5f6b75" />
          </motion.g>
        </g>

        {/* Отметка реального прироста на гвозде */}
        {showGain && (
          <g className="hammer-gain-mark" data-testid="gain-mark">
            <path
              d={`M${NAIL_X + 30} ${markTop} V${markBottom} M${NAIL_X + 23} ${markTop} H${NAIL_X + 37} M${NAIL_X + 23} ${markBottom} H${NAIL_X + 37}`}
              stroke="#168c51"
              strokeWidth="3"
              fill="none"
            />
            <text x={NAIL_X + 44} y={(markTop + markBottom) / 2 + 4} fontSize="13" fontWeight="800" fill="#11693c">
              +{after - before}%
            </text>
          </g>
        )}

        {/* Молоток: центр вращения в конце рукояти; до удара стоит над шляпкой */}
        <g transform={`translate(${NAIL_X} ${hammerY})`}>
          <g
            className="hammer-tool"
            data-struck={struck ? 'true' : 'false'}
            style={{
              transform: `rotate(${hammerDeg}deg)`,
              transformBox: 'view-box',
              transformOrigin: HAMMER_PIVOT,
              transition: reduceMotion ? 'none' : `transform ${struck ? 110 : 140}ms ${struck ? 'ease-out' : 'ease-in'}`,
            }}
          >
            <rect x="-112" y="-26" width="92" height="12" rx="5" fill="#8a5a2b" />
            <rect x="-22" y="-40" width="44" height="40" rx="7" fill="#3d3b37" />
            <rect x="-22" y="-40" width="44" height="10" rx="5" fill="#5f5c56" />
          </g>
          {impact && result && (
            <g className={`hammer-impact ${result === 'perfect' ? 'perfect' : ''}`} data-testid="impact">
              <circle cx="0" cy="0" r="16" fill="none" strokeWidth="3" />
              <path
                d="M0 -26 V-14 M0 14 V26 M-26 0 H-14 M14 0 H26 M-19 -19 L-11 -11 M19 -19 L11 -11 M-19 19 L-11 11 M19 19 L11 11"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          )}
        </g>

        {/* Шкала прогресса 0-100% */}
        <g fontFamily="Inter, sans-serif" fontSize="12" fontWeight="700" fill="#5f4a38">
          <path d={`M${SCALE_X} ${scaleY(0)} V${scaleY(100)}`} stroke="#5f4a38" strokeWidth="2" />
          {tickPercents.map((p) => (
            <g key={p}>
              <path d={`M${SCALE_X - 6} ${scaleY(p)} H${SCALE_X + 6}`} stroke="#5f4a38" strokeWidth="2" />
              <text x={SCALE_X + 10} y={scaleY(p) + 4}>{p}%</text>
            </g>
          ))}
        </g>
        {known && before > 0 && (
          <rect
            className="hammer-scale-before"
            x={SCALE_X - 10}
            y={scaleY(0)}
            width="10"
            height={scaleY(before) - scaleY(0)}
            rx="2"
            fill="#5f4a38"
            opacity="0.22"
          />
        )}
        {showGain && (
          <rect
            className="hammer-scale-gain"
            data-testid="scale-gain"
            x={SCALE_X - 10}
            y={scaleY(before)}
            width="10"
            height={scaleY(after) - scaleY(before)}
            rx="2"
            fill="#168c51"
            opacity="0.55"
          />
        )}
      </svg>
    </div>
  );
}
