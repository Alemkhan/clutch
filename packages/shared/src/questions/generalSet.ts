import type { CategoryId, Question } from '../index';
import { generateMatch, type TemplateUsage } from './questionGenerator';
import {
  generalPackQuestions,
  generalPackSets,
  isPackRecordLive,
  packQuestionToRaceQuestion,
  packSetToRaceQuestion,
  type PackRecord,
  packRecordRegions,
} from '../generalPack';
import { isEverywhere } from '../i18n/locale';
import { createSeededRandom, hashSeed } from './seededRandom';
import { LEGACY_POOL_ORDER } from './legacyPoolOrder';

/**
 * Набор дня общего режима: смешанный, 70% записей пакета + 30% вопросов генераторов
 * (решение владельца 2026-10-12). 20 вопросов = 14 из пакета + 6 из генераторов
 * (3 география, 2 история, 1 языки). Из 14 пакетных 4 (~30%) подаются открытым вводом.
 */
export const GENERAL_SET_PACK_COUNT = 14;
export const GENERAL_SET_OPEN_COUNT = 4;
export const GENERAL_SET_GENERATED: ReadonlyArray<{ category: 'geography' | 'history' | 'languages'; count: number }> = [
  { category: 'geography', count: 3 },
  { category: 'history', count: 2 },
  { category: 'languages', count: 1 },
];
/** Доля открытых ответов внутри генераторной части, как у остальных наборов дня. */
const GENERATED_OPEN_RATIO = 0.3;

/**
 * С этого дня набор общего режима ровнее по темам: в пакетной части не больше
 * `GENERAL_SET_TOPIC_CAP` вопросов одной темы (наука — почти треть пула и давала по 6–7 за набор),
 * и вопросы одной темы не идут подряд. Более ранние дни собираются по-старому: таблица дня
 * сравнивает забеги одного набора, и уже сыгранные наборы меняться не должны.
 */
export const BALANCED_TOPICS_FROM = '2026-11-15';
export const GENERAL_SET_TOPIC_CAP = 3;

/** Тема вопроса для разведения: подкатегория (тема пакета или раздел генератора). */
export function questionTopicKey(question: Pick<Question, 'category' | 'subcategory'>): string {
  return question.subcategory ?? question.category;
}

/**
 * Дневной порядок пула с потолком тем: каждые `chunk` позиций (ровно окно одного набора) берут
 * не больше `cap` записей одной темы. Лишние уходят дальше по очереди, а не выпадают: это
 * перестановка, окна наборов по-прежнему не пересекаются. Если подходящей записи нет (маленький
 * пул), берётся первая — набор всё равно полный.
 */
function capTopicsPerChunk(order: readonly PackRecord[], chunk: number, cap: number, extra?: ExtraCap): PackRecord[] {
  const queue = [...order];
  const out: PackRecord[] = [];
  let counts = new Map<string, number>();
  let extraCount = 0;
  const fits = (record: PackRecord): boolean =>
    (counts.get(record.topic) ?? 0) < cap && (!extra || !extra.matches(record) || extraCount < extra.cap);
  while (queue.length > 0) {
    if (out.length % chunk === 0) {
      counts = new Map();
      extraCount = 0;
    }
    let index = queue.findIndex(fits);
    if (index < 0) index = 0;
    const [record] = queue.splice(index, 1);
    counts.set(record.topic, (counts.get(record.topic) ?? 0) + 1);
    if (extra?.matches(record)) extraCount += 1;
    out.push(record);
  }
  return out;
}

/** Дополнительный потолок поверх тем: не больше `cap` записей узкой группы на набор. */
interface ExtraCap {
  matches: (record: PackRecord) => boolean;
  cap: number;
}

/** С этого дня в наборе дня не больше одного вопроса про химические элементы. */
export const ELEMENT_LIMIT_FROM = '2026-11-25';
const ELEMENT_QUESTION = /атомный номер|химический элемент обозначается|символ у химического элемента/;
const ONE_ELEMENT_PER_SET: ExtraCap = {
  matches: (record) => record.kind === 'single' && ELEMENT_QUESTION.test(record.promptRu),
  cap: 1,
};

/**
 * Разводит вопросы одной темы: каждый следующий — первый по порядку, чья тема не совпадает с двумя
 * предыдущими, иначе хотя бы с предыдущим. Если тема занимает больше половины остатка, она идёт
 * сейчас, чтобы в конце не остался хвост из одной темы. Детерминирован: зависит только от входа.
 */
export function spreadTopics<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const rest = [...items];
  const out: T[] = [];
  while (rest.length > 0) {
    const last = out.length > 0 ? keyOf(out[out.length - 1]) : undefined;
    const beforeLast = out.length > 1 ? keyOf(out[out.length - 2]) : undefined;
    const counts = new Map<string, number>();
    for (const item of rest) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
    const [dominant, dominantCount] = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
    let index = dominantCount * 2 > rest.length && dominant !== last
      ? rest.findIndex((item) => keyOf(item) === dominant)
      : rest.findIndex((item) => keyOf(item) !== last && keyOf(item) !== beforeLast);
    if (index < 0) index = rest.findIndex((item) => keyOf(item) !== last);
    if (index < 0) index = 0;
    out.push(rest.splice(index, 1)[0]);
  }
  return out;
}

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const random = createSeededRandom(hashSeed(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Набор «Истории Казахстана»: только записи пакета темы kazakhstan, без генераторов.
 * 15 вопросов, из них до 4 открытым вводом (годы, имена).
 */
export const KZ_SET_SIZE = 15;
export const KZ_SET_OPEN_COUNT = 4;
/** Меньше одобренных вопросов — категория в меню «Скоро», старт забега отклоняется. */
export const KZ_MIN_LIVE = 20;

const isKazakhstan = (record: PackRecord): boolean => record.topic === 'kazakhstan';

/**
 * Записи общего пула, которые видят игроки: только одобренные. Казахстанские — лишь с
 * `generalPool` (их знает большинство в СНГ), остальные живут в своей категории.
 */
export function livePackRecords(): PackRecord[] {
  return [...generalPackQuestions, ...generalPackSets]
    .filter((record) => isPackRecordLive(record) && (!isKazakhstan(record) || (record.kind === 'single' && record.generalPool === true)));
}

/**
 * С этого дня общий набор дня (одна таблица на все зоны) берёт только записи, доступные во всех
 * гео-зонах: местные вопросы (советские мультфильмы, история Казахстана) не попадают игроку из
 * другой зоны. Раньше — прежний пул, чтобы не менять уже сыгранные наборы.
 */
export const EVERYWHERE_POOL_FROM = '2026-11-19';

/** Одобренные записи, доступные во всех зонах: пул общего набора дня. */
export function liveEverywhereRecords(): PackRecord[] {
  return livePackRecords().filter((record) => isEverywhere(packRecordRegions(record.id)));
}

/**
 * С этого дня забег дня собирается только из вопросов «для всех»: общие для всех зон, не
 * экспертные, без зубрёжки (атомные номера и символы редких элементов) и не помеченные
 * `daily: false`. Генераторная часть — флаги стран, столицы и языки, без «Исторических флагов»
 * (там штаты США и гербы городов). Дуэли и свободная игра берут пул шире.
 */
export const DAILY_CURATED_FROM = '2026-11-24';

/** Атомный номер в забеге дня — только у самых известных элементов. */
const DAILY_ATOMIC_NUMBER_ELEMENTS = new Set(['водород', 'гелий', 'углерод', 'кислород']);
const ATOMIC_NUMBER = /^Какой атомный номер у элемента «(.+)»\?$/u;
const ELEMENT_SYMBOL = /^Какой символ у химического элемента «(.+)»\?$/u;
const SYMBOL_TO_ELEMENT = /обозначается символом (\S+)\?$/u;
/** Символы тех же бытовых элементов: для обратного вопроса «какой элемент обозначается X». */
const DAILY_SYMBOLS = new Set([
  'H', 'He', 'C', 'N', 'O', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'K', 'Ca', 'Fe', 'Cu', 'Zn',
  'Ag', 'Sn', 'I', 'Pt', 'Au', 'Hg', 'Pb', 'U',
]);

/**
 * Шаблонные вопросы из Wikidata («Кто автор „…“», «Кто режиссёр „…“») смешивают знаменитое с
 * нишевым («Сон в красном тереме», «Сельская честь»). В забег дня — только то, что знает почти
 * каждый; остальное живёт в дуэлях и свободной игре.
 */
const DAILY_FAMOUS_WORKS: Readonly<Record<string, ReadonlySet<string>>> = {
  'автор произведения': new Set([
    'Маленький принц', 'Властелин колец', 'Дон Кихот', '1984', 'Алиса в Стране чудес', 'Преступление и наказание',
    'Анна Каренина', 'Русалочка', 'Гарри Поттер и философский камень', 'Гордость и предубеждение',
    'Жизнь и удивительные приключения Робинзона Крузо', 'Отверженные', 'Война и мир', 'Старик и море',
    'Три мушкетёра', 'Франкенштейн, или Современный Прометей', 'Код да Винчи', 'Остров сокровищ',
    'Путешествия Гулливера', 'Приключения Пиноккио. История деревянной куклы', 'Приключения Оливера Твиста',
    'Портрет Дориана Грея', 'Мастер и Маргарита', 'Граф Монте-Кристо', 'Вокруг света за восемьдесят дней',
    'Двадцать тысяч льё под водой', 'Алхимик', 'Хоббит, или Туда и обратно',
  ]),
  'режиссёр фильма': new Set([
    'Титаник', 'Аватар', 'Криминальное чтиво', 'Тёмный рыцарь', 'Интерстеллар', 'Список Шиндлера',
    'Парк юрского периода', 'Властелин колец: Братство Кольца', 'Звёздные войны. Эпизод IV: Новая надежда',
  ]),
  'композитор произведения': new Set(['Лебединое озеро', 'Щелкунчик', 'К Элизе', 'Волшебная флейта', 'Кармен']),
  'написал картину': new Set([
    'Мона Лиза', 'Звёздная ночь', 'Девушка с жемчужной серёжкой', 'Герника', 'Рождение Венеры', 'Поцелуй',
    'Постоянство памяти', 'Ночной дозор',
  ]),
};
const WIKIDATA_WORK = /^Кто (автор произведения|режиссёр фильма|композитор произведения|написал картину) «(.+)»\?$/u;
const WIKIDATA_BY_CREATOR = /^Как(?:ое|ую) из этих (?:произведений|картин) написал (.+)\?$/u;
const DAILY_FAMOUS_CREATORS = new Set([
  'Антуан де Сент-Экзюпери', 'Джон Рональд Руэл Толкин', 'Мигель де Сервантес', 'Джордж Оруэлл', 'Льюис Кэрролл',
  'Фёдор Михайлович Достоевский', 'Лев Николаевич Толстой', 'Ханс Кристиан Андерсен', 'Джоан Роулинг',
  'Джейн Остин', 'Даниель Дефо', 'Виктор Гюго', 'Эрнест Хемингуэй', 'Пауло Коэльо', 'Александр Дюма', 'Мэри Шелли',
  'Дэн Браун', 'Роберт Льюис Стивенсон', 'Джонатан Свифт', 'Чарльз Диккенс', 'Оскар Уайльд',
  'Михаил Афанасьевич Булгаков', 'Жюль Верн',
  'Леонардо да Винчи', 'Винсент Ван Гог', 'Пабло Пикассо', 'Сальвадор Дали', 'Клод Моне', 'Густав Климт',
  'Сандро Боттичелли', 'Рембрандт',
]);

/**
 * Годится ли запись пакета для забега дня (без учёта зон). У каждой записи контента стоит явный
 * флаг `daily` — он и решает. Правила ниже — то, по чему флаг проставляется новым вопросам.
 */
export function isDailyEligible(record: PackRecord): boolean {
  const flag = (record as { daily?: boolean }).daily;
  if (typeof flag === 'boolean') return flag;
  return dailyRulesAllow(record);
}

/** Правила забега дня: не экспертный, без зубрёжки, только общеизвестные произведения. */
export function dailyRulesAllow(record: PackRecord): boolean {
  if (record.kind !== 'single') return true;
  if (record.difficulty === 'Expert') return false;
  const prompt = record.promptRu;
  const atomic = ATOMIC_NUMBER.exec(prompt);
  if (atomic) return DAILY_ATOMIC_NUMBER_ELEMENTS.has(atomic[1].toLowerCase());
  // Элементы — одним видом вопроса («какой элемент обозначается Fe»), иначе их в наборе по два-три.
  if (ELEMENT_SYMBOL.test(prompt)) return false;
  const reverse = SYMBOL_TO_ELEMENT.exec(prompt);
  if (reverse) return DAILY_SYMBOLS.has(reverse[1]);
  const work = WIKIDATA_WORK.exec(prompt);
  if (work) return DAILY_FAMOUS_WORKS[work[1]]?.has(work[2]) ?? false;
  const creator = WIKIDATA_BY_CREATOR.exec(prompt);
  if (creator && record.origin === 'wikidata') return DAILY_FAMOUS_CREATORS.has(creator[1]);
  return true;
}

/** Пул забега дня: общие для всех зон и годные для забега дня записи. */
export function liveDailyRecords(): PackRecord[] {
  return liveEverywhereRecords().filter(isDailyEligible);
}

/** Генераторная часть забега дня с DAILY_CURATED_FROM: флаги стран, столицы и языки. */
export const DAILY_SET_GENERATED: ReadonlyArray<{ category: 'geography' | 'history' | 'languages'; count: number }> = [
  { category: 'geography', count: 4 },
  { category: 'languages', count: 2 },
];

const LEGACY_POSITION = new Map(LEGACY_POOL_ORDER.map((entry, index) => {
  const split = entry.lastIndexOf(':');
  return [entry.slice(0, split), { index, topic: entry.slice(split + 1) as PackRecord['topic'] }];
}));

/**
 * Пул пакетной части забега дня для этого дня: записи с `liveFrom` позже этого дня не входят.
 *
 * Перемешивание зависит от порядка записей. С DAILY_CURATED_FROM пул упорядочен по id — раскладка
 * по файлам и темам больше не влияет на наборы. Более ранние дни собираются в замороженном порядке
 * и с прежними темами (LEGACY_POOL_ORDER), чтобы уже сыгранные наборы не менялись.
 */
// Контент статичен: пул забега дня по id считается один раз, дальше только фильтр по дате.
let curatedBase: readonly PackRecord[] | null = null;
function curatedDailyBase(): readonly PackRecord[] {
  return (curatedBase ??= liveDailyRecords().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

export function dailyPackPool(dateKey: string): PackRecord[] {
  const live = (record: PackRecord): boolean => {
    const from = (record as { liveFrom?: string }).liveFrom;
    return !from || from <= dateKey;
  };
  if (dateKey >= DAILY_CURATED_FROM) {
    // `dailyUntil` — последний день записи в забеге дня: убрать вопрос, не меняя уже идущий день.
    // `dailyFrom` — первый день в забеге дня для вопроса, который уже живёт в дуэлях (в отличие от
    // liveFrom он не трогает пул прошлых дней).
    const stillDaily = (record: PackRecord): boolean => {
      const { dailyUntil: until, dailyFrom: from } = record as { dailyUntil?: string; dailyFrom?: string };
      return (!until || dateKey <= until) && (!from || dateKey >= from);
    };
    return curatedDailyBase().filter((record) => live(record) && stillDaily(record));
  }
  const pool = dateKey >= EVERYWHERE_POOL_FROM ? liveEverywhereRecords() : livePackRecords();
  return pool
    .filter((record) => live(record) && LEGACY_POSITION.has(record.id))
    .map((record) => ({ ...record, topic: LEGACY_POSITION.get(record.id)!.topic }) as PackRecord)
    .sort((a, b) => LEGACY_POSITION.get(a.id)!.index - LEGACY_POSITION.get(b.id)!.index);
}

/** Одобренные записи категории «История Казахстана», включая попавшие и в общий пул. */
export function liveKzRecords(): PackRecord[] {
  return [...generalPackQuestions, ...generalPackSets].filter((record) => isPackRecordLive(record) && isKazakhstan(record));
}

/** Открыта ли категория для игры. Генераторные и общие знания — всегда. */
export function isCategoryOpen(category: CategoryId, kzPool: readonly PackRecord[] = liveKzRecords()): boolean {
  return category !== 'kz_history' || kzPool.length >= KZ_MIN_LIVE;
}

/**
 * Окно из `count` записей начиная с позиции `start` в дневном порядке. Порядок дня — перемешанный
 * по `general:<dateKey>` пул; если одобренных записей не хватает на весь банк, список идёт по кругу,
 * и каждый следующий круг перемешивается своим сидом (`...:cycle<n>`). Запись в окне не повторяется.
 */
function packWindow(
  pool: readonly PackRecord[],
  base: string,
  start: number,
  count: number,
  topicCap?: { chunk: number; cap: number; extra?: ExtraCap },
): PackRecord[] {
  if (pool.length === 0) return [];
  const cycles = new Map<number, PackRecord[]>();
  const at = (position: number): PackRecord => {
    const cycle = Math.floor(position / pool.length);
    let order = cycles.get(cycle);
    if (!order) {
      order = shuffled(pool, cycle === 0 ? base : `${base}:cycle${cycle}`);
      if (topicCap) order = capTopicsPerChunk(order, topicCap.chunk, topicCap.cap, topicCap.extra);
      cycles.set(cycle, order);
    }
    return order[position % pool.length];
  };
  const out: PackRecord[] = [];
  const seen = new Set<string>();
  const limit = start + count + pool.length;
  for (let position = start; position < limit && out.length < count; position++) {
    const record = at(position);
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  return out;
}

/** Индекс набора в банке дня из его id (`general:2026-10-12:3` даёт 3). */
function setIndexOf(questionSetId: string): number {
  const index = Number(questionSetId.slice(questionSetId.lastIndexOf(':') + 1));
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`Bad question set id: ${questionSetId}`);
  return index;
}

/**
 * Записи в формате забега. Открытым вводом - только одиночные записи, у которых он разрешён;
 * выбор детерминирован по id набора.
 */
function packRaceQuestions(records: readonly PackRecord[], questionSetId: string, openCount: number): Question[] {
  const open = new Set(
    shuffled(
      records.filter((r) => r.kind === 'single' && r.openAnswer).map((r) => r.id),
      `${questionSetId}:open`,
    ).slice(0, openCount),
  );
  return records.map((record) => {
    const seed = `${questionSetId}:${record.id}`;
    if (record.kind === 'set') return packSetToRaceQuestion(record, seed);
    return packQuestionToRaceQuestion(record, open.has(record.id) ? 'open_answer' : 'multiple_choice', seed);
  });
}

/**
 * Один набор «Истории Казахстана»: окно дня по пулу темы, как у общего режима, но без генераторов.
 * `pool` нужен только тестам.
 */
export function buildKzSet(questionSetId: string, dateKey: string, pool: readonly PackRecord[] = liveKzRecords()): Question[] {
  const index = setIndexOf(questionSetId);
  const records = packWindow(pool, `kz_history:${dateKey}`, index * KZ_SET_SIZE, KZ_SET_SIZE);
  const createdAt = `${dateKey}T00:00:00.000Z`;
  return shuffled(packRaceQuestions(records, questionSetId, KZ_SET_OPEN_COUNT), `${questionSetId}:order`)
    .map((q) => ({ ...q, createdAt }));
}

/**
 * С этого дня набор забега дня (нулевой в банке — его играют все) собирается без повторов.
 * Раньше пул каждый день перемешивался заново, и за неделю 1–4 вопроса из 20 попадались снова
 * (жалоба игроков 2026-11-25). Теперь берутся записи, которые дольше всех не были в забеге дня:
 * повтор возможен только после того, как прошёл весь пул (~510 записей по 14 в день, около
 * пяти недель). Генераторы тоже не берут недавние сущности: язык — 14 дней, страну — 30.
 * Дни до NO_REPEAT_FROM не меняются; их вопросы (за NO_REPEAT_HISTORY_DAYS дней) считаются
 * недавними, чтобы первые дни ротации не повторили прошлую неделю.
 */
export const NO_REPEAT_FROM = '2026-11-26';
const NO_REPEAT_HISTORY_DAYS = 14;

type GeneratedCategory = 'geography' | 'history' | 'languages';
const ENTITY_WINDOW_DAYS: Readonly<Record<GeneratedCategory, number>> = { geography: 30, history: 14, languages: 14 };

interface DailyRunPick {
  records: PackRecord[];
  /** Сущности генераторов, взятые в этот день. */
  entities: Partial<Record<GeneratedCategory, string[]>>;
  /** Что генераторам нельзя было брать: нужно, чтобы собрать набор ровно так же. */
  exclude: Partial<Record<GeneratedCategory, ReadonlySet<string>>>;
}

interface RotationState {
  day: string;
  packUsed: Map<string, number>;
  entityUsed: Map<GeneratedCategory, Map<string, number>>;
}

const dayNumber = (dateKey: string): number => Math.round(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function setCaps(dateKey: string): { chunk: number; cap: number; extra?: ExtraCap } | undefined {
  if (dateKey < BALANCED_TOPICS_FROM) return undefined;
  return { chunk: GENERAL_SET_PACK_COUNT, cap: GENERAL_SET_TOPIC_CAP, ...(dateKey >= ELEMENT_LIMIT_FROM ? { extra: ONE_ELEMENT_PER_SET } : {}) };
}

function generatedEntities(
  questionSetId: string,
  mix: ReadonlyArray<{ category: GeneratedCategory; count: number }>,
  exclude: DailyRunPick['exclude'] = {},
): DailyRunPick['entities'] {
  const entities: DailyRunPick['entities'] = {};
  for (const { category, count } of mix) {
    const usage: TemplateUsage = new Map();
    generateMatch(count, GENERATED_OPEN_RATIO, category, createSeededRandom(hashSeed(`${questionSetId}:${category}`)), usage, exclude[category]);
    entities[category] = [...usage.keys()];
  }
  return entities;
}

/** Забег дня, как он собирался до NO_REPEAT_FROM: только чтобы знать, что было недавно. */
function legacyDailyRunPick(dateKey: string): DailyRunPick {
  const records = packWindow(dailyPackPool(dateKey), `general:${dateKey}`, 0, GENERAL_SET_PACK_COUNT, setCaps(dateKey));
  const mix = dateKey >= DAILY_CURATED_FROM ? DAILY_SET_GENERATED : GENERAL_SET_GENERATED;
  return { records, entities: generatedEntities(`general:${dateKey}:0`, mix), exclude: {} };
}

/** Первые `count` записей порядка с потолком тем и узкой группы; не хватает — добирает по порядку. */
function takeCapped(order: readonly PackRecord[], count: number, caps: { cap: number; extra?: ExtraCap } | undefined): PackRecord[] {
  const out: PackRecord[] = [];
  const counts = new Map<string, number>();
  let extraCount = 0;
  for (const record of order) {
    if (out.length === count) break;
    if (caps) {
      if ((counts.get(record.topic) ?? 0) >= caps.cap) continue;
      if (caps.extra?.matches(record) && extraCount >= caps.extra.cap) continue;
    }
    counts.set(record.topic, (counts.get(record.topic) ?? 0) + 1);
    if (caps?.extra?.matches(record)) extraCount += 1;
    out.push(record);
  }
  if (out.length < count) {
    const taken = new Set(out.map((record) => record.id));
    out.push(...order.filter((record) => !taken.has(record.id)).slice(0, count - out.length));
  }
  return out;
}

function pickWithoutRepeats(dateKey: string, state: RotationState): DailyRunPick {
  const today = dayNumber(dateKey);
  const lastUsed = (record: PackRecord): number => state.packUsed.get(record.id) ?? -1;
  const pool = dailyPackPool(dateKey);
  const ties = new Map(pool.map((record) => [record.id, hashSeed(`norepeat:${dateKey}:${record.id}`)]));
  const order = pool.sort((a, b) =>
    lastUsed(a) - lastUsed(b) || ties.get(a.id)! - ties.get(b.id)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const records = takeCapped(order, GENERAL_SET_PACK_COUNT, setCaps(dateKey));
  const exclude: DailyRunPick['exclude'] = {};
  for (const { category } of DAILY_SET_GENERATED) {
    const used = state.entityUsed.get(category) ?? new Map<string, number>();
    exclude[category] = new Set([...used].filter(([, day]) => today - day <= ENTITY_WINDOW_DAYS[category]).map(([id]) => id));
  }
  return { records, entities: generatedEntities(`general:${dateKey}:0`, DAILY_SET_GENERATED, exclude), exclude };
}

function remember(state: RotationState, dateKey: string, pick: DailyRunPick): void {
  const day = dayNumber(dateKey);
  for (const record of pick.records) state.packUsed.set(record.id, day);
  for (const [category, ids] of Object.entries(pick.entities) as [GeneratedCategory, string[]][]) {
    let used = state.entityUsed.get(category);
    if (!used) state.entityUsed.set(category, (used = new Map()));
    for (const id of ids) used.set(id, day);
  }
}

// Ротация последовательна: день зависит от всех предыдущих. Считается один раз на изолят.
const rotationPicks = new Map<string, DailyRunPick>();
let rotationState: RotationState | null = null;

function dailyRunPick(dateKey: string): DailyRunPick {
  const cached = rotationPicks.get(dateKey);
  if (cached) return cached;
  if (!rotationState) {
    const state: RotationState = { day: addDays(NO_REPEAT_FROM, -1), packUsed: new Map(), entityUsed: new Map() };
    for (let back = NO_REPEAT_HISTORY_DAYS; back >= 1; back--) {
      const day = addDays(NO_REPEAT_FROM, -back);
      remember(state, day, legacyDailyRunPick(day));
    }
    rotationState = state;
  }
  while (rotationState.day < dateKey) {
    const day = addDays(rotationState.day, 1);
    const pick = pickWithoutRepeats(day, rotationState);
    remember(rotationState, day, pick);
    rotationPicks.set(day, pick);
    rotationState.day = day;
  }
  return rotationPicks.get(dateKey)!;
}

/**
 * Один набор общего режима. Детерминирован: одинаковые `questionSetId` и день всегда дают
 * байт-идентичный набор. `usage` — общий ledger шаблонов всего банка дня, как у других категорий.
 * `pool` нужен только тестам (нехватка одобренных записей); с ним ротация забега дня не включается.
 */
export function buildGeneralSet(
  questionSetId: string,
  dateKey: string,
  usage?: TemplateUsage,
  pool?: readonly PackRecord[],
): Question[] {
  const index = setIndexOf(questionSetId);
  const balanced = dateKey >= BALANCED_TOPICS_FROM;
  const rotation = pool === undefined && dateKey >= NO_REPEAT_FROM && questionSetId === `general:${dateKey}:0`
    ? dailyRunPick(dateKey)
    : undefined;
  const records = rotation?.records ?? packWindow(
    pool ?? dailyPackPool(dateKey),
    `general:${dateKey}`,
    index * GENERAL_SET_PACK_COUNT,
    GENERAL_SET_PACK_COUNT,
    setCaps(dateKey),
  );
  const packQuestions = packRaceQuestions(records, questionSetId, GENERAL_SET_OPEN_COUNT);

  const mix = dateKey >= DAILY_CURATED_FROM ? DAILY_SET_GENERATED : GENERAL_SET_GENERATED;
  const generated = mix.flatMap(({ category, count }) =>
    generateMatch(count, GENERATED_OPEN_RATIO, category, createSeededRandom(hashSeed(`${questionSetId}:${category}`)), usage, rotation?.exclude[category]),
  );

  // createdAt is wall-clock in the generators; pin it so the set is byte-identical for everyone.
  const createdAt = `${dateKey}T00:00:00.000Z`;
  const order = shuffled([...packQuestions, ...generated], `${questionSetId}:order`);
  return (balanced ? spreadTopics(order, questionTopicKey) : order).map((q) => ({ ...q, createdAt }));
}
