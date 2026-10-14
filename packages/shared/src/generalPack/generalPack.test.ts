import { describe, expect, it } from 'vitest';
import { validateNarrowCategories } from '../lastStand';
import {
  generalPackQuestions,
  generalPackSets,
  isPackRecordLive,
  matchesAccepted,
  matchPackSetMember,
  normalizePackAnswer,
  packQuestionToRaceQuestion,
  packSetScale,
  packSetToLastStandCategory,
  packSetToRaceQuestion,
} from './index';

const allRecords = [...generalPackQuestions, ...generalPackSets];

describe('general pack data', () => {
  it('has unique ids', () => {
    const ids = allRecords.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Происхождение обязательно, проверяемость — нет, и это разные вещи. `sourceUrl` ведёт на
  // страницу, где факт можно сверить; `sourceHint` говорит, где искать; `sourceTitle` в одиночку
  // называет только, откуда запись взялась (например ролик), и факт за ней никто не проверял.
  // Записи NotebookLM живут именно так — см. docs/CONTENT_REVIEW.md.
  it('gives every live record its provenance; pending and blocked ones never go live', () => {
    for (const r of allRecords) {
      expect(['pending', 'approved', 'blocked'], r.id).toContain(r.editorialStatus);
      if (r.editorialStatus !== 'approved') expect(isPackRecordLive(r), r.id).toBe(false);
      if (isPackRecordLive(r)) {
        const provenance = (r.sourceUrl ?? '').trim() || (r.sourceHint ?? '').trim() || (r.sourceTitle ?? '').trim();
        expect(provenance, r.id).not.toBe('');
      }
    }
  });

  it('gives every question its canonical answer and three distinct wrong options', () => {
    for (const q of generalPackQuestions) {
      const accepted = q.acceptedRu.map(normalizePackAnswer);
      expect(accepted, q.id).toContain(normalizePackAnswer(q.answerRu));
      const wrong = q.distractorsRu.map(normalizePackAnswer);
      expect(wrong, q.id).toHaveLength(3);
      expect(new Set(wrong).size, q.id).toBe(3);
      for (const w of wrong) expect(accepted, `${q.id}: «${w}» is also accepted`).not.toContain(w);
      expect(q.promptRu.trim(), q.id).not.toBe('');
    }
  });

  it('never lets a wrong option pass as a typed answer', () => {
    for (const q of generalPackQuestions.filter((x) => x.openAnswer)) {
      for (const w of q.distractorsRu) expect(matchesAccepted(w, q.acceptedRu), `${q.id}: ${w}`).toBe(false);
    }
  });

  it('keeps every set closed and unambiguous', () => {
    for (const s of generalPackSets) {
      expect(s.members.length, s.id).toBeGreaterThanOrEqual(2);
      expect(new Set(s.members.map((x) => x.id)).size, s.id).toBe(s.members.length);
      expect(s.nonMembersRu.length, s.id).toBeGreaterThanOrEqual(3);
      for (const x of s.members) {
        for (const alias of x.acceptedRu) expect(matchPackSetMember(s, alias), `${s.id}: ${alias}`).toBe(x.id);
      }
      for (const wrong of s.nonMembersRu) expect(matchPackSetMember(s, wrong), `${s.id}: ${wrong}`).toBeNull();
    }
  });
});

describe('race conversion', () => {
  const question = generalPackQuestions.find((q) => q.openAnswer)!;

  it('builds a four-option question with exactly one right option', () => {
    const race = packQuestionToRaceQuestion(question, 'multiple_choice');
    expect(race.options).toHaveLength(4);
    expect(race.options.find((o) => o.id === race.correctOptionId)?.text).toBe(question.answerRu);
    expect(race.status).toBe('approved');
  });

  it('keeps the option order fixed for a seed', () => {
    const a = packQuestionToRaceQuestion(question, 'multiple_choice', 'seed-1');
    const b = packQuestionToRaceQuestion(question, 'multiple_choice', 'seed-1');
    expect(a.options).toEqual(b.options);
  });

  it('builds a typed-answer question that accepts the aliases', () => {
    const race = packQuestionToRaceQuestion(question, 'open_answer');
    expect(race.answerType).toBe('open_answer');
    expect(race.options).toEqual([]);
    expect(race.correctAnswers).toEqual(expect.arrayContaining(question.acceptedRu));
  });

  it('refuses a typed answer for multiple-choice-only questions', () => {
    const mcOnly = generalPackQuestions.find((q) => !q.openAnswer)!;
    expect(() => packQuestionToRaceQuestion(mcOnly, 'open_answer')).toThrow(RangeError);
  });

  it('turns a set into «что из этого» with one member among non-members', () => {
    const planets = generalPackSets.find((s) => s.id === 'set-solar-planets')!;
    const race = packSetToRaceQuestion(planets, 'day-1');
    const right = race.options.find((o) => o.id === race.correctOptionId)!.text;
    expect(planets.members.map((x) => x.answerRu)).toContain(right);
    for (const o of race.options.filter((x) => x.id !== race.correctOptionId)) {
      expect(planets.nonMembersRu).toContain(o.text);
    }
  });
});

describe('Last Stand conversion', () => {
  it('sizes sets into the existing scales', () => {
    const scales = new Set(generalPackSets.map(packSetScale));
    expect(scales).toEqual(new Set(['narrow', 'regional', 'wide']));
  });

  it('produces narrow categories the Last Stand rules accept', () => {
    const narrow = generalPackSets.filter((s) => packSetScale(s) === 'narrow').map(packSetToLastStandCategory);
    expect(() => validateNarrowCategories(narrow)).not.toThrow();
  });

  it('recognises aliases and refuses near misses on short answers', () => {
    const chess = generalPackSets.find((s) => s.id === 'set-chess-pieces')!;
    expect(matchPackSetMember(chess, 'Королева')).toBe('queen');
    expect(matchPackSetMember(chess, 'ладя')).toBeNull();
    const greek = generalPackSets.find((s) => s.id === 'set-greek-letters')!;
    expect(matchPackSetMember(greek, 'пи')).toBe('pi');
    expect(matchPackSetMember(greek, 'по')).toBeNull();
    expect(matchPackSetMember(greek, 'лямбба')).toBe('lambda');
  });

  it('uses the shared exact policy for numeric answers and keeps ordinary typos', () => {
    expect(matchesAccepted('1896', ['1896'])).toBe(true);
    for (const wrong of ['1886', '1996', '1895', '896']) {
      expect(matchesAccepted(wrong, ['1896'])).toBe(false);
    }
    expect(matchesAccepted('Астна', ['Астана'])).toBe(true);
  });
});
