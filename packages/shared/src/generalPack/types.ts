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
  | 'world';

export type EditorialStatus = 'pending' | 'approved' | 'blocked';

/** `original` — written for Clutch, facts still need a source before approval. */
export type PackOrigin = 'wikidata' | 'authored' | 'notebooklm';
export type PackLicense = 'CC0' | 'original';

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
