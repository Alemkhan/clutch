import {
  countries,
  generalPackSets,
  isPackRecordLive,
  LAST_STAND_TABLE_SIZE,
  narrowCategories,
  packSetScale,
  packSetToLastStandCategory,
  planLastStandRounds,
  type LastStandCategory,
  type LastStandRound,
  type PackSet,
} from '@clutch/shared';

/** Pools of pack categories that may reach players: approved only. Ids carry the `gp:` prefix. */
export function packPools(sets: readonly PackSet[]): { narrow: LastStandCategory[]; regional: LastStandCategory[] } {
  const live = sets.filter(isPackRecordLive);
  return {
    // Smaller than the table eliminates by arithmetic; the planner would drop them anyway.
    narrow: live
      .filter((set) => packSetScale(set) === 'narrow' && set.members.length >= LAST_STAND_TABLE_SIZE)
      .map(packSetToLastStandCategory),
    regional: live.filter((set) => packSetScale(set) === 'regional').map(packSetToLastStandCategory),
  };
}

const packSetById = new Map<string, PackSet>(
  generalPackSets.filter(isPackRecordLive).map((set) => [`gp:${set.id}`, set]),
);
const packPool = packPools(generalPackSets);

const narrowPool: LastStandCategory[] = [
  ...narrowCategories.map((category): LastStandCategory => ({
    id: category.id,
    scale: 'narrow',
    members: category.countryCodes,
  })),
  ...packPool.narrow,
];

const regionalPackPool = packPool.regional;

const narrowTitles = new Map(narrowCategories.map((category) => [category.id, category.titleRu]));

const regionTitles: Record<string, string> = {
  Europe: 'Страна Европы',
  Asia: 'Страна Азии',
  Africa: 'Страна Африки',
  Americas: 'Страна Америки',
  Oceania: 'Страна Океании',
};

const planCache = new Map<string, LastStandRound[]>();

/** Rounds of the UTC day; deterministic, memoised (a few recent days only). */
export function planForDate(dateKey: string): LastStandRound[] {
  const cached = planCache.get(dateKey);
  if (cached) return cached;
  const plan = planLastStandRounds(dateKey, narrowPool, undefined, regionalPackPool);
  if (planCache.size >= 4) planCache.delete(planCache.keys().next().value as string);
  planCache.set(dateKey, plan);
  return plan;
}

export function roundTitleRu(round: LastStandRound): string {
  const packSet = packSetById.get(round.categoryId);
  if (packSet) return packSet.titleRu;
  if (round.scale === 'wide') return 'Любая страна';
  if (round.scale === 'regional') {
    const region = round.categoryId.replace(/^region:/, '');
    return regionTitles[region] ?? 'Страна региона';
  }
  return narrowTitles.get(round.categoryId) ?? 'Узкая группа стран';
}

const nameRuByCode = new Map(countries.map((country) => [country.code, country.nameRu]));

export function countryNameRu(code: string): string {
  return nameRuByCode.get(code) ?? code;
}

/** Pack category behind a round, or undefined for country categories. */
export function packSetForRound(round: Pick<LastStandRound, 'categoryId'>): PackSet | undefined {
  return packSetById.get(round.categoryId);
}

/** Readable name of a round member: a country name, or the pack member's canonical answer. */
export function memberNameRu(round: Pick<LastStandRound, 'categoryId'>, memberId: string): string {
  const set = packSetById.get(round.categoryId);
  if (!set) return countryNameRu(memberId);
  return set.members.find((member) => member.id === memberId)?.answerRu ?? memberId;
}
