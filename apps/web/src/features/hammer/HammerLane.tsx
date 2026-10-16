import { useMemo } from 'react';
import type { HammerAttemptRules } from '@clutch/shared';
import { hammerTierZones } from './hammerMotion';
import { hammerZoneLabels } from './hammerStrike';

/** Дорожка: подписи очков над зонами, сами зоны и бегущий маркер (0..1). */
export function HammerLane({ attempt, markerPos }: { attempt: HammerAttemptRules; markerPos: number }) {
  const tierZones = useMemo(() => hammerTierZones(attempt), [attempt]);
  const zoneLabels = useMemo(() => hammerZoneLabels(attempt), [attempt]);
  return (
    <div className="hammer-lane" aria-hidden="true">
      <div className="hammer-zone-labels">
        {zoneLabels.map((label, index) => (
          <span
            key={`${label.result}-${index}`}
            className={`hammer-zone-label hammer-zone-label-${label.result}`}
            style={{ left: `${label.leftPercent}%` }}
          >
            +{label.points}
          </span>
        ))}
      </div>
      <div className="hammer-track">
        {tierZones.map((zone) => (
          <div
            key={zone.result}
            className={`hammer-zone hammer-zone-${zone.result}`}
            style={{ left: `${zone.leftPercent}%`, width: `${zone.widthPercent}%` }}
          />
        ))}
        <div
          className="marker"
          style={{ left: `${markerPos * 100}%` }}
        />
      </div>
    </div>
  );
}
