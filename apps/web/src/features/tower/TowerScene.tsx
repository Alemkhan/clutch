import { motion, useReducedMotion } from 'framer-motion';
import type { SkillResult } from '@clutch/shared';
import { BLOCK_WIDTH_PERCENT, blockLeftPercent, type TowerLanding } from './towerGeometry';

const PALETTE = ['#d9c7a7', '#f0a64f', '#4d75e8', '#f04a3e', '#6fbf8a'];
export const GROUND_PX = 28;
export const FLOOR_PX = 36;
export const VISIBLE_FLOORS = 4;
const HOVER_PX = GROUND_PX + VISIBLE_FLOORS * FLOOR_PX + 64;
const DROP_SECONDS = 0.28;
const FALL_SECONDS = 0.8;
const FALL_PX = 240;

/** Небольшой сдвиг нижних этажей: башня выглядит сложенной вручную. Верхний этаж всегда ровно под целью. */
function floorOffset(globalIndex: number): number {
  return ((((globalIndex * 37) % 7) - 3) / 3) * 0.03;
}

interface TowerSceneProps {
  /** Сколько этажей в башне сейчас (с основанием). */
  floors: number;
  /** Центр верхнего блока = центр цели, 0..1 по дорожке. */
  targetCenter: number;
  /** Центр летающего блока, 0..1 по дорожке. */
  markerPos: number;
  result: SkillResult | null;
  landing: TowerLanding | null;
  onSettled: () => void;
}

/** Башня, летающий блок и падающий отломок. onSettled — когда игрок увидел конец падения. */
export function TowerScene({ floors, targetCenter, markerPos, result, landing, onSettled }: TowerSceneProps) {
  const reduceMotion = useReducedMotion();
  const shown = Math.min(VISIBLE_FLOORS, floors);
  const firstGlobal = floors - shown;
  const topSurface = GROUND_PX + shown * FLOOR_PX;
  const dropPx = HOVER_PX - topSurface;
  const movingColor = PALETTE[floors % PALETTE.length];
  const topLeft = blockLeftPercent(targetCenter);
  const instant = Boolean(reduceMotion);

  // Отломок — последнее, что видит игрок: ждём его; если отламывать нечего, ждём посадку блока.
  // Под reduced motion колбэк окончания вызывает сам TowerGame.
  const fragmentSettles = Boolean(landing?.overhang) && !instant;
  const landedSettles = !fragmentSettles && !instant;

  return (
    <div className="tower-scene" aria-hidden="true">
      <div className="tower-ground" style={{ height: GROUND_PX }} />
      {Array.from({ length: shown }, (_, k) => {
        const global = firstGlobal + k;
        const center = k === shown - 1 ? targetCenter : targetCenter + floorOffset(global);
        return (
          <div
            key={global}
            className="tower-floor"
            style={{
              left: `${blockLeftPercent(center)}%`,
              width: `${BLOCK_WIDTH_PERCENT}%`,
              bottom: GROUND_PX + k * FLOOR_PX,
              height: FLOOR_PX,
              background: PALETTE[global % PALETTE.length],
            }}
          />
        );
      })}
      {!result && (
        <>
          <div className="tower-guide" style={{ left: `${topLeft}%`, bottom: topSurface, height: dropPx }} />
          <div
            className="tower-guide"
            style={{ left: `${topLeft + BLOCK_WIDTH_PERCENT}%`, bottom: topSurface, height: dropPx }}
          />
          <div
            className="tower-floor tower-moving"
            style={{
              left: `${blockLeftPercent(markerPos)}%`,
              width: `${BLOCK_WIDTH_PERCENT}%`,
              bottom: HOVER_PX,
              height: FLOOR_PX,
              background: movingColor,
            }}
          />
        </>
      )}
      {result && landing?.landed && (
        <motion.div
          className="tower-floor tower-landed"
          style={{
            left: `${landing.landed.left}%`,
            width: `${landing.landed.width}%`,
            bottom: HOVER_PX,
            height: FLOOR_PX,
            background: movingColor,
          }}
          initial={{ y: instant ? dropPx : 0 }}
          animate={{ y: dropPx }}
          transition={{ duration: instant ? 0 : DROP_SECONDS, ease: 'easeIn' }}
          onAnimationComplete={landedSettles ? onSettled : undefined}
        />
      )}
      {result && landing?.overhang && !instant && (
        <motion.div
          className="tower-floor tower-fragment"
          style={{
            left: `${landing.overhang.left}%`,
            width: `${landing.overhang.width}%`,
            bottom: HOVER_PX,
            height: FLOOR_PX,
            background: movingColor,
          }}
          initial={{ y: 0, rotate: 0, opacity: 1 }}
          animate={
            landing.landed
              ? { y: [0, dropPx, dropPx + FALL_PX], rotate: [0, 0, landing.side * 40], opacity: [1, 1, 0] }
              : { y: [0, FALL_PX], rotate: [0, landing.side * 30], opacity: [1, 0] }
          }
          transition={{
            duration: landing.landed ? FALL_SECONDS : 0.6,
            times: landing.landed ? [0, DROP_SECONDS / FALL_SECONDS, 1] : undefined,
            ease: 'easeIn',
          }}
          onAnimationComplete={fragmentSettles ? onSettled : undefined}
        />
      )}
    </div>
  );
}
