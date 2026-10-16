import { SKILL_REWARDS, type SkillResult } from '@clutch/shared';

/** Подпись удара одной строкой: «ОТЛИЧНО +18%»; промах (0%) — только «МИМО», без «+0%». */
export function strikeLabelText(result: SkillResult): string {
  const name = { perfect: 'ИДЕАЛЬНО', great: 'ОТЛИЧНО', good: 'ХОРОШО', weak: 'СЛАБО', miss: 'МИМО' }[result];
  const points = SKILL_REWARDS[result];
  return points > 0 ? `${name} +${points}%` : name;
}

export function HammerResult({ result, remaining, series }: {
  result: SkillResult;
  /** Готовая строка «До 100% — ещё N%» (см. remainingText). */
  remaining?: string;
  /** Готовая строка «Серия N · зоны стали уже», если стадия давления выросла. */
  series?: string | null;
}) {
  return (
    <div className={`strike-result ${result}`} aria-hidden="true">
      <span className="strike-label">{strikeLabelText(result)}</span>
      {remaining && <span className="strike-remaining">{remaining}</span>}
      {series && <span className="strike-series">{series}</span>}
    </div>
  );
}

export function HammerResultStatus({ result, remaining, series }: {
  result: SkillResult;
  remaining?: string;
  series?: string | null;
}) {
  const label = {
    perfect: 'Идеально', great: 'Отлично', good: 'Хорошо', weak: 'Слабо', miss: 'Мимо',
  }[result];
  return (
    <span className="visually-hidden" role="status">
      Результат удара: {label}, +{SKILL_REWARDS[result]}% прогресса.
      {remaining ? ` ${remaining}.` : ''}
      {series ? ` ${series}.` : ''}
    </span>
  );
}
