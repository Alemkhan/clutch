import { SKILL_REWARDS, type SkillResult } from '@clutch/shared';
import { m } from './messages';
import { messagesFor } from '../../i18n/messages';

/** Подпись удара одной строкой: «ОТЛИЧНО +18%»; промах (0%) - только «МИМО», без «+0%». */
export function strikeLabelText(result: SkillResult): string {
  const t = messagesFor(m);
  const name = { perfect: t.labelPerfect, great: t.labelGreat, good: t.labelGood, weak: t.labelWeak, miss: t.labelMiss }[result];
  const points = SKILL_REWARDS[result];
  return points > 0 ? `${name} +${points}%` : name;
}

export function HammerResult({ result, remaining, series }: {
  result: SkillResult;
  /** Готовая строка «До 100% - ещё N%» (см. remainingText). */
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
  const t = messagesFor(m);
  const label = { perfect: t.perfect, great: t.great, good: t.good, weak: t.weak, miss: t.miss }[result];
  return (
    <span className="visually-hidden" role="status">
      {t.status(label, SKILL_REWARDS[result])}
      {remaining ? ` ${remaining}.` : ''}
      {series ? ` ${series}.` : ''}
    </span>
  );
}
