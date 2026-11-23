/**
 * General knowledge pack: one pool for the race (multiple choice or typed answer) and Last Stand.
 * Nothing here is live until a reviewer sets `editorialStatus: 'approved'` (docs/CONTENT_REVIEW.md).
 */

export type PackDifficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert';

export type PackTopic =
  | 'science'
  | 'space'
  | 'nature'
  | 'body'
  | 'history'
  | 'literature'
  | 'art'
  | 'music'
  | 'film'
  | 'popculture'
  | 'sport'
  | 'food'
  | 'math'
  | 'language'
  | 'tech'
  | 'world'
  /** История Казахстана (по программе ЕНТ): своя категория, в общий пул — только с `generalPool`. */
  | 'kazakhstan';

export type EditorialStatus = 'pending' | 'approved' | 'blocked';

/** `original` — written for Clutch, facts still need a source before approval. */
/** `opentdb` — Open Trivia Database (opentdb.com), переведено и адаптировано. */
export type PackOrigin = 'wikidata' | 'authored' | 'notebooklm' | 'opentdb';
/** CC-BY-SA-4.0 — нужна атрибуция (строка в профиле) и та же лицензия у переработки. */
export type PackLicense = 'CC0' | 'original' | 'CC-BY-SA-4.0';

interface PackRecordBase {
  id: string;
  topic: PackTopic;
  origin: PackOrigin;
  license: PackLicense;
  /** Verifiable page. Required before approval. */
  sourceUrl?: string;
  sourceTitle?: string;
  /** Where to verify when there is no URL yet, e.g. «Википедия: Гепард». */
  sourceHint?: string;
  editorialStatus: EditorialStatus;
  reviewNote?: string;
}

/** One question with one right answer. */
export interface PackQuestion extends PackRecordBase {
  kind: 'single';
  difficulty: PackDifficulty;
  promptRu: string;
  /** Shown after the round. */
  answerRu: string;
  /** Typed answers that count; the canonical answer included. */
  acceptedRu: string[];
  /** Only when an English answer is deliberately allowed. */
  acceptedEn?: string[];
  /** Wrong options for multiple choice; never equal to an accepted answer. */
  distractorsRu: [string, string, string] | string[];
  explanationRu?: string;
  /** False when the answer is too long or too loose to type (lists, phrases): multiple choice only. */
  openAnswer: boolean;
  /**
   * Картинка к вопросу (сама картина в вопросах о живописи): файл Wikimedia Commons, только
   * свободные или перешедшие в общественное достояние. Запоминается лучше подписи.
   */
  image?: PackImage;
  /**
   * Только для темы «kazakhstan»: вопрос, который знает большинство в СНГ (Байконур, Абай),
   * идёт и в общие знания. Без флага он живёт лишь в категории «История Казахстана».
   */
  generalPool?: boolean;
  /**
   * false — вопрос не идёт в забег дня (слишком узкий или спорный между странами), но остаётся
   * в дуэлях и свободной игре. Без поля решает isDailyEligible (зоны, сложность, зубрёжка).
   */
  daily?: boolean;
  /**
   * Первый день, с которого запись попадает в наборы дня (YYYY-MM-DD). Новые вопросы не должны
   * менять уже сыгранные наборы: окно пакета считается по всему пулу. В дуэлях и свободной игре — сразу.
   */
  liveFrom?: string;
  /** Последний день (YYYY-MM-DD), когда запись ещё идёт в забег дня; дальше — только дуэли и свободная игра. */
  dailyUntil?: string;
  /** Первый день (YYYY-MM-DD) в забеге дня для записи, которая уже есть в дуэлях; прошлые дни не меняет. */
  dailyFrom?: string;
}

export interface PackImage {
  /** https://commons.wikimedia.org/wiki/Special:FilePath/<файл>?width=<px> — превью нужной ширины. */
  url: string;
  /** Страница файла на Commons: автор, лицензия. */
  pageUrl: string;
}

export interface PackSetMember {
  /** Stable id stored in Last Stand records instead of the typed text. */
  id: string;
  answerRu: string;
  acceptedRu: string[];
}

/**
 * A closed category: «Назови планету Солнечной системы».
 * Last Stand needs every valid member; multiple choice asks «Что из этого — …?» with one member
 * against three non-members.
 */
export interface PackSet extends PackRecordBase {
  kind: 'set';
  titleRu: string;
  mcPromptRu: string;
  members: PackSetMember[];
  /** Plausible wrong answers that are certainly not members. At least three. */
  nonMembersRu: string[];
}

export type PackRecord = PackQuestion | PackSet;
