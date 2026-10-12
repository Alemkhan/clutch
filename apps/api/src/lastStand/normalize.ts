import { countries, levenshtein, matchPackSetMember, normalizeAnswer, type Country, type PackSet } from '@clutch/shared';

const byCode = new Map<string, Country>(countries.map((country) => [country.code, country]));

export const MAX_ANSWER_LENGTH = 64;

/** Common spellings that are not countries.ts names (kept deliberately short). */
const ALIASES: Record<string, string[]> = {
  kp: ['Северная Корея', 'Корея Северная', 'КНДР'],
  kr: ['Республика Корея', 'Корея Южная'],
};

function fold(value: string): string {
  return normalizeAnswer(value).replace(/ё/g, 'е');
}

/**
 * Free text -> country code, only among the given members (the roster never leaves the server).
 * Exact match on nameRu / name wins; otherwise the nearest name within the usual tolerance
 * (max(1, floor(len / 5))). A tie between different countries is not recognised.
 */
export function recogniseCountry(input: unknown, members: readonly string[]): string | null {
  if (typeof input !== 'string') return null;
  const text = fold(input.slice(0, MAX_ANSWER_LENGTH * 2));
  if (!text || text.length > MAX_ANSWER_LENGTH) return null;

  let bestCode: string | null = null;
  let bestDistance = Infinity;
  let tied = false;
  for (const code of members) {
    const country = byCode.get(code);
    if (!country) continue;
    for (const name of [country.nameRu, country.name, ...(ALIASES[code] ?? [])]) {
      const candidate = fold(name);
      if (candidate === text) return code;
      const distance = levenshtein(text, candidate);
      const tolerance = Math.max(1, Math.floor(candidate.length / 5));
      if (distance > tolerance) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCode = code;
        tied = false;
      } else if (distance === bestDistance && code !== bestCode) {
        tied = true;
      }
    }
  }
  return tied ? null : bestCode;
}

/**
 * Free text -> member of the round's category: country code, or pack member id for `gp:` categories.
 * One entry point so the route does not branch on the category kind.
 */
export function recogniseAnswer(
  input: unknown,
  round: { categoryId: string; members: readonly string[] },
  packSet?: PackSet,
): string | null {
  if (!packSet) return recogniseCountry(input, round.members);
  if (typeof input !== 'string' || input.length > MAX_ANSWER_LENGTH * 2) return null;
  const text = input.trim();
  if (!text || text.length > MAX_ANSWER_LENGTH) return null;
  const id = matchPackSetMember(packSet, text);
  return id !== null && round.members.includes(id) ? id : null;
}
