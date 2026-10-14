import type { CategoryId, Question, Difficulty } from './index';
import { countries, flagUrl, outlineUrl, ISLAND_COUNTRIES, type Country } from './countries';
import { FLAG_TRAITS } from './flagTraits';
import { historicFlags, historicFlagUrl, type HistoricFlag } from './historicFlags';
import { languages, type LanguageEntry } from './languages';

export type { CategoryId };

// Near-identical flag pairs (indistinguishable at quiz size) — never used as
// each other's distractors: the question would have no fair answer.
const IDENTICAL_FLAG_PAIRS: [string, string][] = [
  ['id', 'mc'], // Indonesia / Monaco — literally the same flag
  ['ro', 'td'], // Romania / Chad — differ by a shade of blue
];

// Source of randomness for the current generation. Swapped only for the duration
// of a synchronous generateMatch call (see its optional rng parameter).
let random: () => number = Math.random;

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(random() * arr.length)];
}

function pickDistractors<T>(arr: T[], exclude: T, count: number): T[] {
  const key = (item: T) => (item as Country).code ?? item;
  const pool = arr.filter((item) => key(item) !== key(exclude));
  return shuffle(pool).slice(0, count);
}

// Take the count most plausible distractors from a scored list, with a little
// variety: shuffle-pick from the top slice instead of always the same three.
function pickFromShortlist<T>(scored: { item: T; score: number }[], count: number, shortlistSize = 6): T[] {
  const shortlist = scored.slice(0, shortlistSize).map((s) => s.item);
  return shuffle(shortlist).slice(0, count);
}

function buildOptions<T>(
  correct: T,
  distractors: T[],
  idFn: (item: T) => string,
  textFn: (item: T) => string,
) {
  const all = shuffle([correct, ...distractors]);
  const options = all.map((item, i) => ({
    id: String.fromCharCode(97 + i),
    text: textFn(item),
  }));
  const correctOptionId = String.fromCharCode(97 + all.findIndex((item) => idFn(item) === idFn(correct)));
  return { options, correctOptionId };
}

// ---------- Distractor strategies ----------

function flagDistance(a: string, b: string): number {
  const A = FLAG_TRAITS[a];
  const B = FLAG_TRAITS[b];
  if (!A || !B) return 99;
  let d = 0;
  if (A.o !== B.o) d += A.o === 'x' || B.o === 'x' ? 0.1 : 0.3;
  const keys = new Set([...Object.keys(A.c), ...Object.keys(B.c)]);
  for (const k of keys) d += Math.abs((A.c[k] ?? 0) - (B.c[k] ?? 0));
  return d;
}

// Flag questions: distractors with similar colors + stripe layout.
// Netherlands → Russia / Thailand / France / Luxembourg, not random flags.
function pickFlagDistractors(correct: Country, count = 3): Country[] {
  const banned = new Set(
    IDENTICAL_FLAG_PAIRS.filter((pair) => pair.includes(correct.code)).flat().filter((c) => c !== correct.code),
  );
  const scored = countries
    .filter((c) => c.code !== correct.code && !banned.has(c.code))
    .map((c) => ({ item: c, score: flagDistance(correct.code, c.code) }))
    .sort((x, y) => x.score - y.score);
  return pickFromShortlist(scored, count);
}

// Outline questions: island outlines are compared against other islands,
// mainland against the same region. Kiribati → Fiji / Samoa / Vanuatu.
function pickOutlineDistractors(correct: Country, count = 3): Country[] {
  const correctIsland = ISLAND_COUNTRIES.has(correct.code);
  const scored = outlineCountries
    .filter((c) => c.code !== correct.code)
    .map((c) => {
      let score = 0;
      if (ISLAND_COUNTRIES.has(c.code) !== correctIsland) score += 1.2;
      if (c.region !== correct.region) score += 0.5;
      score += random() * 0.05; // tie-break jitter
      return { item: c, score };
    })
    .sort((x, y) => x.score - y.score);
  return pickFromShortlist(scored, count);
}

// Capital-of-country (text) questions: plausible options come from the same region.
function pickRegionDistractors(correct: Country, count = 3): Country[] {
  const sameRegion = countries.filter((c) => c.region === correct.region && c.code !== correct.code);
  const pool = sameRegion.length >= count ? sameRegion : countries.filter((c) => c.code !== correct.code);
  return shuffle(pool).slice(0, count);
}

// Language questions: prefer distractors written in the same script —
// Urdu is compared against Farsi and Arabic, not against Finnish.
function pickLanguageDistractors(correct: (typeof languages)[number], count = 3): (typeof languages)[number][] {
  const others = languages.filter((l) => l.id !== correct.id);
  const sameScript = others.filter((l) => l.script === correct.script);
  const rest = shuffle(others.filter((l) => l.script !== correct.script));
  const chosen = shuffle(sameScript).slice(0, count);
  if (chosen.length < count) chosen.push(...rest.slice(0, count - chosen.length));
  return shuffle(chosen);
}

const now = () => new Date().toISOString();

// mapsicon has no outline for these codes (verified 2026-09-09); they never appear
// as outline media, but stay valid for flag/capital questions and as distractors.
const OUTLINE_EXCLUDED = new Set(['xk', 'ps', 'mh', 'fm', 'tv']);

const outlineCountries = countries.filter((c) => !OUTLINE_EXCLUDED.has(c.code));

function requireOutlineCountry(country: Country): Country {
  if (OUTLINE_EXCLUDED.has(country.code)) {
    throw new RangeError(`Country ${country.code} does not have an outline asset.`);
  }
  return country;
}

// ---------- Geography (RU) ----------

export function generateFlagToCountry(correct: Country = pickOne(countries)): Question {
  const distractors = pickFlagDistractors(correct);
  const { options, correctOptionId } = buildOptions(correct, distractors, (c) => c.code, (c) => c.nameRu);

  return {
    id: `flag_country_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Geography',
    subcategory: 'Флаги',
    difficulty: 'Easy',
    prompt: 'Флаг какой это страны?',
    mediaType: 'flag',
    mediaUrl: flagUrl(correct.code),
    options,
    correctOptionId,
    explanation: `Это флаг ${correct.nameRu} — ${correct.region === 'Asia' ? 'Азия' : correct.region === 'Europe' ? 'Европа' : correct.region === 'Africa' ? 'Африка' : correct.region === 'Americas' ? 'Америка' : 'Океания'}.`,
    status: 'approved',
    createdAt: now(),
  };
}

export function generateCountryToCapital(difficulty?: Difficulty): Question;
export function generateCountryToCapital(correct: Country): Question;
export function generateCountryToCapital(difficulty: Difficulty, correct: Country): Question;
export function generateCountryToCapital(
  difficultyOrCountry: Difficulty | Country = 'Medium',
  selectedCountry?: Country,
): Question {
  const difficulty = typeof difficultyOrCountry === 'string' ? difficultyOrCountry : 'Medium';
  const correct = typeof difficultyOrCountry === 'string'
    ? (selectedCountry ?? pickOne(countries))
    : difficultyOrCountry;
  const distractors = pickRegionDistractors(correct);
  const { options, correctOptionId } = buildOptions(correct, distractors, (c) => c.code, (c) => c.capitalRu);

  return {
    id: `capital_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Geography',
    subcategory: 'Столицы',
    difficulty,
    prompt: `Какой город — столица страны ${correct.nameRu}?`,
    options,
    correctOptionId,
    explanation: `${correct.nameRu}: столица — ${correct.capitalRu}.`,
    status: 'approved',
    createdAt: now(),
  };
}

export function generateFlagToCapital(correct: Country = pickOne(countries)): Question {
  const distractors = pickFlagDistractors(correct);
  const { options, correctOptionId } = buildOptions(correct, distractors, (c) => c.code, (c) => c.capitalRu);

  return {
    id: `flag_capital_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Geography',
    subcategory: 'Флаги и столицы',
    difficulty: 'Hard',
    prompt: 'Какой город — столица страны с этим флагом?',
    mediaType: 'flag',
    mediaUrl: flagUrl(correct.code),
    options,
    correctOptionId,
    explanation: `Это флаг ${correct.nameRu}. Столица — ${correct.capitalRu}.`,
    status: 'approved',
    createdAt: now(),
  };
}

export function generateOutlineToCountry(correct: Country = pickOne(outlineCountries)): Question {
  requireOutlineCountry(correct);
  const distractors = pickOutlineDistractors(correct);
  const { options, correctOptionId } = buildOptions(correct, distractors, (c) => c.code, (c) => c.nameRu);

  return {
    id: `outline_country_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Geography',
    subcategory: 'Контуры',
    difficulty: 'Medium',
    prompt: 'Какая страна имеет такую форму?',
    mediaType: 'outline',
    mediaUrl: outlineUrl(correct.code),
    options,
    correctOptionId,
    explanation: `Это контур ${correct.nameRu}.`,
    status: 'approved',
    createdAt: now(),
  };
}

export function generateOutlineToCountryOpen(correct: Country = pickOne(outlineCountries)): Question {
  requireOutlineCountry(correct);
  return {
    id: `open_outline_country_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'open_answer',
    category: 'Geography',
    subcategory: 'Страна по контуру',
    difficulty: 'Expert',
    prompt: 'Напишите название страны с таким контуром:',
    mediaType: 'outline',
    mediaUrl: outlineUrl(correct.code),
    options: [],
    correctOptionId: '',
    correctAnswers: [correct.nameRu, correct.name],
    explanation: `Это контур ${correct.nameRu}.`,
    status: 'approved',
    createdAt: now(),
  };
}

export function generateCapitalOpenAnswer(correct: Country = pickOne(countries)): Question {
  return {
    id: `open_capital_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'open_answer',
    category: 'Geography',
    subcategory: 'Столица',
    difficulty: 'Hard',
    prompt: `Напишите название города — столицы страны ${correct.nameRu}.`,
    options: [],
    correctOptionId: '',
    correctAnswers: [correct.capitalRu, correct.capital],
    explanation: `${correct.nameRu}: столица — ${correct.capitalRu}.`,
    status: 'approved',
    createdAt: now(),
  };
}

export function generateFlagToCountryOpen(correct: Country = pickOne(countries)): Question {
  return {
    id: `open_flag_country_${correct.code}`,
    type: 'multiple_choice',
    answerType: 'open_answer',
    category: 'Geography',
    subcategory: 'Страна по флагу',
    difficulty: 'Expert',
    prompt: 'Напишите название страны с этим флагом:',
    mediaType: 'flag',
    mediaUrl: flagUrl(correct.code),
    options: [],
    correctOptionId: '',
    correctAnswers: [correct.nameRu, correct.name],
    explanation: `Это флаг ${correct.nameRu}.`,
    status: 'approved',
    createdAt: now(),
  };
}

// Builds an ordered, fixed capital quiz for a specific list of country codes.
// Resolves `capital_fixed_*` ids in generateQuestionById.
export function generateFixedCapitalQuiz(countryCodes: string[]): Question[] {
  return countryCodes
    .map((code) => countries.find((c) => c.code === code))
    .filter((c): c is Country => Boolean(c))
    .map((country) => ({
      id: `capital_fixed_${country.code}`,
      type: 'multiple_choice' as const,
      answerType: 'open_answer' as const,
      category: 'Geography',
      subcategory: 'Столицы',
      difficulty: 'Hard' as const,
      prompt: `Напишите название города — столицы страны ${country.nameRu}.`,
      options: [],
      correctOptionId: '',
      correctAnswers: [country.capitalRu, country.capital],
      explanation: `${country.nameRu}: столица — ${country.capitalRu}.`,
      status: 'approved' as const,
      createdAt: now(),
    }));
}

// ---------- Historical Flags (RU) ----------

export function generateHistoricFlag(correct: HistoricFlag = pickOne(historicFlags)): Question {
  const distractors = pickDistractors(historicFlags, correct, 3);
  const { options, correctOptionId } = buildOptions(
    correct,
    distractors,
    (f) => f.id,
    (f) => `${f.labelRu} (${f.era})`,
  );

  return {
    id: `hist_flag_${correct.id}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Historical Flags',
    subcategory: 'Другие флаги',
    difficulty: 'Hard',
    prompt: 'Что это за флаг?',
    mediaType: 'flag',
    mediaUrl: historicFlagUrl(correct.file),
    options,
    correctOptionId,
    explanation: `${correct.labelRu}, ${correct.era}. ${correct.factRu}`,
    status: 'approved',
    createdAt: now(),
  };
}

// ---------- Languages (RU) ----------

export function generateLanguage(correct: LanguageEntry = pickOne(languages)): Question {
  const distractors = pickLanguageDistractors(correct);
  const { options, correctOptionId } = buildOptions(correct, distractors, (l) => l.id, (l) => l.nameRu);

  return {
    id: `lang_${correct.id}`,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    category: 'Languages',
    subcategory: 'Языки',
    difficulty: 'Medium',
    prompt: 'Что это за язык?',
    mediaType: null,
    mediaUrl: null,
    mediaText: correct.sample,
    options,
    correctOptionId,
    explanation: `Это ${correct.nameRu}. ${correct.factRu}`,
    status: 'approved',
    createdAt: now(),
  };
}

// ---------- Match assembly ----------

/**
 * Which question templates each entity was already asked with, across the sets of one
 * bank: entity key -> template name -> times used. Mutated by generateMatch.
 */
export type TemplateUsage = Map<string, Map<string, number>>;

// Among the templates available for this entity, keep the ones used least so far
// (unused ones first: count 0), then pick one with the current rng.
function pickLeastUsed<T extends { name: string }>(
  templates: T[],
  entityKey: string,
  usage: TemplateUsage | undefined,
): T {
  const used = usage?.get(entityKey);
  let candidates = templates;
  if (used) {
    const counts = templates.map((template) => used.get(template.name) ?? 0);
    const min = Math.min(...counts);
    candidates = templates.filter((_, index) => counts[index] === min);
  }
  const chosen = pickOne(candidates);
  if (usage) {
    const entry = usage.get(entityKey) ?? new Map<string, number>();
    entry.set(chosen.name, (entry.get(chosen.name) ?? 0) + 1);
    usage.set(entityKey, entry);
  }
  return chosen;
}

export function generateMatch(
  numQuestions: number = 10,
  openRatio: number = 0.3,
  category: CategoryId = 'geography',
  rng: () => number = Math.random,
  templateUsage?: TemplateUsage,
): Question[] {
  const previousRandom = random;
  random = rng;
  try {
    return generateMatchWithRandom(numQuestions, openRatio, category, templateUsage);
  } finally {
    random = previousRandom;
  }
}

function generateMatchWithRandom(
  numQuestions: number,
  openRatio: number,
  category: CategoryId,
  usage?: TemplateUsage,
): Question[] {
  if (!Number.isInteger(numQuestions) || numQuestions < 0) {
    throw new RangeError('numQuestions must be a nonnegative integer.');
  }
  if (!Number.isFinite(openRatio) || openRatio < 0 || openRatio > 1) {
    throw new RangeError('openRatio must be a finite number between 0 and 1.');
  }

  const capacities: Record<Exclude<CategoryId, 'general'>, number> = {
    geography: countries.length,
    history: historicFlags.length,
    languages: languages.length,
  };
  // 'general' нарочно не обслуживается: набор общего режима собирает generalSet.ts.
  if (category !== 'geography' && category !== 'history' && category !== 'languages') {
    throw new RangeError(`Unknown category: ${String(category)}.`);
  }
  const capacity = capacities[category];
  if (numQuestions > capacity) {
    throw new RangeError(
      `Cannot generate ${numQuestions} unique ${category} questions: category capacity is ${capacity}.`,
    );
  }
  if (numQuestions === 0) {
    return [];
  }

  if (category === 'history') {
    const questions = shuffle(historicFlags)
      .slice(0, numQuestions)
      .map((flag) => {
        // Single template per entity: nothing to choose, only record the use.
        pickLeastUsed([{ name: 'hist_flag' }], flag.id, usage);
        return generateHistoricFlag(flag);
      });
    return shuffle(questions);
  }
  if (category === 'languages') {
    const questions = shuffle(languages)
      .slice(0, numQuestions)
      .map((language) => {
        pickLeastUsed([{ name: 'lang' }], language.id, usage);
        return generateLanguage(language);
      });
    return shuffle(questions);
  }

  const numOpen = Math.round(numQuestions * openRatio);
  const selectedCountries = shuffle(countries).slice(0, numQuestions);
  const questions = selectedCountries.map((country, index) => {
    if (index < numQuestions - numOpen) {
      const generators = [
        { name: 'flag_country', make: generateFlagToCountry },
        { name: 'capital', make: generateCountryToCapital },
        { name: 'flag_capital', make: generateFlagToCapital },
        ...(OUTLINE_EXCLUDED.has(country.code) ? [] : [{ name: 'outline_country', make: generateOutlineToCountry }]),
      ];
      return pickLeastUsed(generators, country.code, usage).make(country);
    }

    const generators = [
      { name: 'open_capital', make: generateCapitalOpenAnswer },
      { name: 'open_flag_country', make: generateFlagToCountryOpen },
    ];
    return pickLeastUsed(generators, country.code, usage).make(country);
  });

  return shuffle(questions);
}

// ---------- Rebuild by id ----------

type CountryTemplate =
  | 'flag_country'
  | 'capital'
  | 'flag_capital'
  | 'outline_country'
  | 'open_outline_country'
  | 'open_capital'
  | 'open_flag_country'
  | 'capital_fixed';

// Longest prefixes first: `open_outline_country_` must not be read as something shorter.
const COUNTRY_TEMPLATE_PREFIXES: [string, CountryTemplate][] = [
  ['open_outline_country_', 'open_outline_country'],
  ['open_flag_country_', 'open_flag_country'],
  ['open_capital_', 'open_capital'],
  ['outline_country_', 'outline_country'],
  ['flag_capital_', 'flag_capital'],
  ['flag_country_', 'flag_country'],
  ['capital_fixed_', 'capital_fixed'],
  ['capital_', 'capital'],
];

type ResolvedQuestionId =
  | { kind: 'country'; template: CountryTemplate; country: Country }
  | { kind: 'history'; flag: HistoricFlag }
  | { kind: 'language'; language: LanguageEntry };

function resolveQuestionId(id: unknown): ResolvedQuestionId | null {
  if (typeof id !== 'string') return null;
  if (id.startsWith('hist_flag_')) {
    const flag = historicFlags.find((f) => f.id === id.slice('hist_flag_'.length));
    return flag ? { kind: 'history', flag } : null;
  }
  if (id.startsWith('lang_')) {
    const language = languages.find((l) => l.id === id.slice('lang_'.length));
    return language ? { kind: 'language', language } : null;
  }
  for (const [prefix, template] of COUNTRY_TEMPLATE_PREFIXES) {
    if (!id.startsWith(prefix)) continue;
    const code = id.slice(prefix.length);
    const country = countries.find((c) => c.code === code);
    if (!country) return null;
    if ((template === 'outline_country' || template === 'open_outline_country') && OUTLINE_EXCLUDED.has(code)) {
      return null;
    }
    return { kind: 'country', template, country };
  }
  return null;
}

/** True when a stored question id still maps to an existing question template and entity. */
export function isKnownQuestionId(id: unknown): boolean {
  return resolveQuestionId(id) !== null;
}

/** Category a question id belongs to, or null for an unknown id. */
export function questionIdCategory(id: unknown): CategoryId | null {
  const resolved = resolveQuestionId(id);
  if (!resolved) return null;
  return resolved.kind === 'history' ? 'history' : resolved.kind === 'language' ? 'languages' : 'geography';
}

/**
 * Rebuilds a question from its id (`{template}_{entity code}`). Answer options of
 * multiple-choice questions are drawn anew. Unknown or malformed ids give null:
 * ids stored by older versions may refer to templates or entities that no longer exist.
 */
export function generateQuestionById(id: unknown): Question | null {
  const resolved = resolveQuestionId(id);
  if (!resolved) return null;
  if (resolved.kind === 'history') return generateHistoricFlag(resolved.flag);
  if (resolved.kind === 'language') return generateLanguage(resolved.language);
  const { country } = resolved;
  switch (resolved.template) {
    case 'flag_country': return generateFlagToCountry(country);
    case 'capital': return generateCountryToCapital(country);
    case 'flag_capital': return generateFlagToCapital(country);
    case 'outline_country': return generateOutlineToCountry(country);
    case 'open_outline_country': return generateOutlineToCountryOpen(country);
    case 'open_capital': return generateCapitalOpenAnswer(country);
    case 'open_flag_country': return generateFlagToCountryOpen(country);
    case 'capital_fixed': return generateFixedCapitalQuiz([country.code])[0] ?? null;
  }
}
