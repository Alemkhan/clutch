import { describe, expect, it } from 'vitest';
import { expandPersonAnswers, generalPackQuestions, matchesAccepted, packQuestionToRaceQuestion } from './index';
import { isAnswerCorrect } from '../fuzzyMatch';

const byId = (id: string) => generalPackQuestions.find((q) => q.id === id)!;
// Вопросы об авторах теперь только с вариантами, но разбор имени проверяется на них же: открытый
// формат здесь включается принудительно.
const accepts = (id: string, typed: string) => {
  const q = packQuestionToRaceQuestion({ ...byId(id), openAnswer: true }, 'open_answer');
  return isAnswerCorrect(typed.toLowerCase().replace(/ё/g, 'е'), (q.correctAnswers ?? []).map((a) => a.toLowerCase().replace(/ё/g, 'е'))).correct;
};
const littlePrince = generalPackQuestions.find((q) => q.promptRu.includes('«Маленький принц»'))!;
const godfather = generalPackQuestions.find((q) => q.promptRu.includes('«Крёстный отец»'))!;

describe('expandPersonAnswers', () => {
  it('accepts surname and first name + surname for real rejected answers', () => {
    for (const typed of ['Экзюпери', 'Антуан Экзюпери', 'Антуан экзюпери', 'Сент-Экзюпери', 'Антуан Сент-Экзюпери', 'Exupery', 'Antoine Exupery']) {
      expect(accepts(littlePrince.id, typed), typed).toBe(true);
    }
    expect(accepts(godfather.id, 'Фрэнсис Коппола')).toBe(true);
    expect(accepts(godfather.id, 'Francis Coppola')).toBe(true);
  });

  it('rejects a lone first name', () => {
    expect(accepts(littlePrince.id, 'Антуан')).toBe(false);
    expect(accepts(godfather.id, 'Фрэнсис')).toBe(false);
    expect(accepts(godfather.id, 'Форд')).toBe(false); // среднее имя само по себе не принимается
  });

  it('keeps tolerance for typos on the new variants', () => {
    expect(accepts(littlePrince.id, 'Антуан Экзюпери'.replace('ю', 'у'))).toBe(true);
  });

  it('leaves non-person answers untouched', () => {
    expect(expandPersonAnswers('Какая страна называется Южный Судан?', ['Южный Судан'])).toEqual(['Южный Судан']);
    expect(matchesAccepted('Судан', expandPersonAnswers('Столица какой страны Джуба?', ['Южный Судан']))).toBe(false);
    expect(expandPersonAnswers('Какая страна — Сьерра-Леоне?', ['Сьерра-Леоне'])).toEqual(['Сьерра-Леоне']);
  });

  it('handles particles, epithets and numerals', () => {
    const out = expandPersonAnswers('Кто написал «X»?', ['Винсент Ван Гог', 'Питер Брейгель Старший', 'Пётр I']);
    expect(out).toContain('Ван Гог');
    expect(out).toContain('Винсент Ван Гог');
    expect(out).not.toContain('Гог');
    expect(out).toContain('Брейгель');
    expect(out).toContain('Питер Брейгель');
    expect(out).not.toContain('Пётр');
  });

  it('never adds a lone first name or a short word across the whole pack', () => {
    let personal = 0;
    for (const q of generalPackQuestions) {
      const base = [...q.acceptedRu, ...(q.acceptedEn ?? [])];
      const expanded = packQuestionToRaceQuestion({ ...q, openAnswer: true }, 'open_answer').correctAnswers ?? [];
      if (expanded.length === base.length) continue;
      personal++;
      const firstNames = new Set(base.map((a) => a.trim().split(/\s+/)[0].toLowerCase()).filter((w) => base.some((a) => a.trim().split(/\s+/).length > 1 && a.toLowerCase().startsWith(`${w} `))));
      for (const added of expanded.filter((a) => !base.includes(a))) {
        const words = added.split(/\s+/);
        const particle = /^(де|да|ди|дю|ла|ле|фон|ван|дер|von|van|de|da|di|du|la|le|der)$/i;
        for (const w of words.filter((x) => !particle.test(x))) {
          expect(w.replace(/[^\p{L}]/gu, '').length, `${q.id}: ${added}`).toBeGreaterThanOrEqual(3);
        }
        if (words.length === 1) expect(firstNames.has(added.toLowerCase()), `${q.id}: ${added}`).toBe(false);
      }
    }
    expect(personal).toBeGreaterThan(50);
  });
});
