import {
  countries,
  narrowCategories,
  planLastStandRounds,
  type LastStandCategory,
  type LastStandRound,
} from '@clutch/shared';

const narrowPool: LastStandCategory[] = narrowCategories.map((category) => ({
  id: category.id,
  scale: 'narrow',
  members: category.countryCodes,
}));

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
  const plan = planLastStandRounds(dateKey, narrowPool);
  if (planCache.size >= 4) planCache.delete(planCache.keys().next().value as string);
  planCache.set(dateKey, plan);
  return plan;
}

export function roundTitleRu(round: LastStandRound): string {
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
