import { describe, expect, it } from 'vitest';
import { levenshtein } from '../fuzzyMatch';
import { CONFUSABLE_DISTRACTOR_PAIRS } from './confusableDistractors.baseline';
import { generalPackQuestions, matchesAccepted, normalizePackAnswer } from './index';

const approved = generalPackQuestions.filter((q) => q.editorialStatus === 'approved');

/** Строки эталона: «id | ответ «X» ≈ «Y» | d=1» либо «id | дистракторы «X» ≈ «Y» | d=1». */
function closePairRows(): string[] {
  const rows: string[] = [];
  const seen = new Set<string>();
  const add = (key: string, row: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
  };
  for (const q of approved) {
    const accepted = [q.answerRu, ...q.acceptedRu];
    for (const d of q.distractorsRu) {
      const nd = normalizePackAnswer(d);
      for (const a of accepted) {
        const na = normalizePackAnswer(a);
        if (na === nd) continue;
        const dist = levenshtein(nd, na);
        if (dist <= 1) add(`${q.id}|a|${na}|${nd}`, `${q.id} | ответ «${a}» ≈ «${d}» | d=${dist}`);
      }
    }
    for (let i = 0; i < q.distractorsRu.length; i++) {
      for (let j = i + 1; j < q.distractorsRu.length; j++) {
        const ni = normalizePackAnswer(q.distractorsRu[i]);
        const nj = normalizePackAnswer(q.distractorsRu[j]);
        if (ni === nj) continue;
        const dist = levenshtein(ni, nj);
        if (dist <= 1) add(`${q.id}|d|${ni}|${nj}`, `${q.id} | дистракторы «${q.distractorsRu[i]}» ≈ «${q.distractorsRu[j]}» | d=${dist}`);
      }
    }
  }
  return rows.sort();
}

// «Моне/Мане» и «БЭСМ/МЭСМ» — легитимные, но опасные дистракторы (docs/AUDIT.md A08): новоявленные
// близкие пары не должны появляться молча, поэтому список заморожен эталоном рядом с тестом.
describe('близкие дистракторы', () => {
  it('не засчитывает ни один дистрактор как правильный ответ', () => {
    for (const q of approved) {
      const accepted = [q.answerRu, ...q.acceptedRu];
      for (const d of q.distractorsRu) {
        expect(matchesAccepted(d, accepted), `${q.id}: дистрактор «${d}» прошёл бы как ответ — замени его`).toBe(false);
      }
    }
  });

  it('совпадает с замороженным эталоном близких пар', () => {
    const actual = closePairRows();
    const baseline = new Set(CONFUSABLE_DISTRACTOR_PAIRS);
    const added = actual.filter((row) => !baseline.has(row));
    const removed = CONFUSABLE_DISTRACTOR_PAIRS.filter((row) => !actual.includes(row));
    expect(added, 'новые близкие пары — проверь, что дистрактор легитимный, и добавь в confusableDistractors.baseline.ts:\n' + added.join('\n')).toEqual([]);
    expect(removed, 'пары исчезли из данных — убери их из confusableDistractors.baseline.ts:\n' + removed.join('\n')).toEqual([]);
    expect(actual.length).toBe(CONFUSABLE_DISTRACTOR_PAIRS.length);
  });
});
