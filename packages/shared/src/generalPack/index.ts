import { contentQuestions, contentSets } from './content';
import type { PackQuestion, PackRecord, PackSet } from './types';

export * from './types';
export * from './convert';

/** Every single-answer question in content/questions/*.json, reviewed or not. */
export const generalPackQuestions: PackQuestion[] = contentQuestions;

/** Every closed category in content/sets/*.json, reviewed or not. */
export const generalPackSets: PackSet[] = contentSets;

/** Only approved records may reach players. */
export function isPackRecordLive(record: PackRecord): boolean {
  return record.editorialStatus === 'approved';
}
