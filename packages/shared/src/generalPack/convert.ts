import type { AnswerType, Question } from '../index';
import { createSeededRandom, hashSeed } from '../seededRandom';
import { isAnswerCorrect, normalizeAnswer } from '../fuzzyMatch';
import type { LastStandCategory, LastStandScale } from '../lastStand';
import type { PackQuestion, PackSet, PackTopic } from './types';
import { expandPersonAnswers } from './personAnswers';

export const PACK_CATEGORY_RU = 'Общие знания';

export const PACK_TOPIC_LABELS_RU: Record<PackTopic, string> = {
  science: 'Наука',
  space: 'Космос',
  nature: 'Природа',
  body: 'Человек',
  history: 'История',
  literature: 'Литература',
  art: 'Искусство',
  music: 'Музыка',
  film: 'Кино и мультфильмы',
  popculture: 'Поп-культура',
  sport: 'Спорт',
  food: 'Еда',
  math: 'Математика',
  language: 'Язык',
  tech: 'Технологии',
  world: 'Мир',
};

export function normalizePackAnswer(text: string): string {
  return normalizeAnswer(text.normalize('NFKC').replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/[‐-―−]/g, '-')).replace(/[«»„“”]/g, '');
}

/** True when the typed text names one of the accepted answers. */
export function matchesAccepted(input: string, accepted: readonly string[]): boolean {
  const typed = normalizePackAnswer(input);
  return isAnswerCorrect(typed, accepted.map(normalizePackAnswer)).correct;
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

const OPTION_IDS = ['a', 'b', 'c', 'd'];

function multipleChoice(
  base: Omit<Question, 'options' | 'correctOptionId' | 'type' | 'answerType'>,
  correct: string,
  wrong: readonly string[],
  seed: string,
): Question {
  const texts = shuffled([correct, ...wrong.slice(0, 3)], seed);
  const options = texts.map((text, i) => ({ id: OPTION_IDS[i], text }));
  return {
    ...base,
    type: 'multiple_choice',
    answerType: 'multiple_choice',
    options,
    correctOptionId: options.find((o) => o.text === correct)!.id,
  };
}

/** A pack question in the race format. Typed answers require `openAnswer`; option order is fixed by `seed`. */
export function packQuestionToRaceQuestion(q: PackQuestion, answerType: AnswerType, seed = q.id): Question {
  const base = {
    id: `gp:${q.id}:${answerType === 'open_answer' ? 'open' : 'mc'}`,
    category: PACK_CATEGORY_RU,
    subcategory: PACK_TOPIC_LABELS_RU[q.topic],
    difficulty: q.difficulty,
    prompt: q.promptRu,
    // Для вопросов про человека сервер и клиент видят один расширенный список (personAnswers.ts).
    correctAnswers: expandPersonAnswers(q.promptRu, [...q.acceptedRu, ...(q.acceptedEn ?? [])]),
    explanation: q.explanationRu ?? `Правильный ответ: ${q.answerRu}.`,
    sourceUrl: q.sourceUrl,
    sourceTitle: q.sourceTitle,
    status: q.editorialStatus === 'approved' ? ('approved' as const) : ('draft' as const),
    createdAt: '2026-10-12T00:00:00.000Z',
  };
  if (answerType === 'open_answer') {
    if (!q.openAnswer) throw new RangeError(`${q.id} is multiple choice only`);
    return { ...base, type: 'multiple_choice', answerType: 'open_answer', options: [], correctOptionId: '' };
  }
  return multipleChoice(base, q.answerRu, q.distractorsRu, seed);
}

/** «Что из этого — …?»: one member against three non-members, both picked by `seed`. */
export function packSetToRaceQuestion(set: PackSet, seed = set.id, memberId?: string): Question {
  const random = createSeededRandom(hashSeed(`${set.id}:${seed}`));
  // memberId restores a question from its stored id; without it the seed picks the member.
  const member =
    (memberId !== undefined ? set.members.find((x) => x.id === memberId) : undefined) ??
    set.members[Math.floor(random() * set.members.length)];
  const wrong = shuffled(set.nonMembersRu, `${seed}:wrong`).slice(0, 3);
  return multipleChoice(
    {
      id: `gp:${set.id}:${member.id}`,
      category: PACK_CATEGORY_RU,
      subcategory: PACK_TOPIC_LABELS_RU[set.topic],
      difficulty: 'Medium',
      prompt: set.mcPromptRu,
      correctAnswers: member.acceptedRu,
      explanation: `${member.answerRu} — правильный ответ. ${set.titleRu}: ${set.members.map((x) => x.answerRu).join(', ')}.`,
      sourceUrl: set.sourceUrl,
      sourceTitle: set.sourceTitle,
      status: set.editorialStatus === 'approved' ? 'approved' : 'draft',
      createdAt: '2026-10-12T00:00:00.000Z',
    },
    member.answerRu,
    wrong,
    seed,
  );
}

/** Last Stand scale from the number of valid answers. */
export function packSetScale(set: PackSet): LastStandScale {
  if (set.members.length <= 6) return 'narrow';
  if (set.members.length <= 30) return 'regional';
  return 'wide';
}

/** Category for the Last Stand rules: members are stable member ids, never typed text. */
export function packSetToLastStandCategory(set: PackSet): LastStandCategory {
  return { id: `gp:${set.id}`, scale: packSetScale(set), members: set.members.map((x) => x.id) };
}

/** Member id named by the typed text, or null when it names none or is ambiguous between two. */
export function matchPackSetMember(set: PackSet, input: string): string | null {
  const typed = normalizePackAnswer(input);
  const exact = set.members.filter((x) => x.acceptedRu.some((a) => normalizePackAnswer(a) === typed));
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;
  const fuzzy = set.members.filter((x) => matchesAccepted(input, x.acceptedRu));
  return fuzzy.length === 1 ? fuzzy[0].id : null;
}
