import { normalizeAnswer } from '../fuzzyMatch';

const key = (text: string): string => normalizeAnswer(text.replace(/ё/gi, 'е'));

/**
 * Вопрос «кто автор/режиссёр/художник/композитор…» — ответ человек.
 * Правило: промпт начинается с «Кто » (в пакете так начинаются все wd-book, wd-film,
 * wd-painting, wd-music и авторские вопросы про людей) или с «Какой художник/композитор/…».
 * Остальные вопросы (страны, города, термины) не расширяются: «Судан» ≠ «Южный Судан».
 */
const PERSON_PROMPT = /^(?:Кто\s|Какой\s+(?:художник|композитор|писатель|поэт|режисс[её]р|учёный|ученый|скульптор|архитектор|драматург)\b)/i;

export function isPersonPrompt(prompt: string): boolean {
  return PERSON_PROMPT.test(prompt.trim());
}

/** Частицы фамилий (нижний регистр, в нормализованной записи). */
const PARTICLES = new Set(['де', 'да', 'ди', 'дю', 'ла', 'ле', 'фон', 'ван', 'дер', 'von', 'van', 'de', 'da', 'di', 'du', 'la', 'le', 'der']);

/** Хвосты вроде «Старший», «the Elder», «II», которые не фамилия. */
const EPITHETS = new Set([
  'старший', 'младший', 'великий', 'первый', 'второй', 'третий',
  'elder', 'younger', 'great', 'jr', 'sr', 'ii', 'iii', 'iv',
]);

const letters = (word: string): number => word.replace(/[^\p{L}]/gu, '').length;
const isNumeral = (word: string): boolean => /^(?:[ivxl]+|\d+)$/i.test(word);

function surnameForms(tokens: string[]): string[] {
  const n = tokens.length;
  let start = n - 1;
  while (start > 1 && PARTICLES.has(tokens[start - 1].toLowerCase())) start--;
  const withParticles = tokens.slice(start).join(' ');
  const last = tokens[n - 1];
  const bare = start < n - 1 ? [last] : [];
  const forms = new Set<string>();
  const add = (form: string, wordsOk: string[]) => {
    if (wordsOk.every((w) => letters(w) >= 3)) forms.add(form);
  };
  add(withParticles, [last]);
  // Без частицы: «Винчи» (≥4 буквы, иначе «Гог»), «Коппола» (≥3).
  for (const b of bare) if (letters(b) >= 4) add(b, [b]);
  // Составная через дефис: «Сент-Экзюпери» → «Экзюпери» (≥4 букв).
  if (last.includes('-')) {
    const parts = last.split('-').filter(Boolean);
    const tail = parts[parts.length - 1];
    if (parts.length > 1 && letters(tail) >= 4) add(tail, [tail]);
  }
  return [...forms];
}

/**
 * Добавляет к принятым ответам-людям: фамилию без частиц, последнюю часть составной
 * фамилии и «имя + фамилия» без средних слов. Одно имя не принимается.
 * Исходные ответы сохраняют порядок; дубли (после нормализации) не добавляются.
 */
export function expandPersonAnswers(prompt: string, answers: readonly string[]): string[] {
  if (!isPersonPrompt(prompt)) return [...answers];
  const out = [...answers];
  const seen = new Set(out.map(key));
  const push = (value: string) => {
    const k = key(value);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(value);
    }
  };
  for (const answer of answers) {
    const tokens = answer.trim().split(/\s+/).filter(Boolean);
    while (tokens.length > 0) {
      const tail = tokens[tokens.length - 1].toLowerCase();
      if (EPITHETS.has(tail) || isNumeral(tail)) tokens.pop();
      else if (tail === 'the') tokens.pop();
      else break;
    }
    if (tokens.length < 2) continue;
    const first = tokens[0];
    const surnames = surnameForms(tokens);
    for (const surname of surnames) push(surname);
    if (letters(first) >= 3 && !PARTICLES.has(first.toLowerCase())) {
      for (const surname of surnames) push(`${first} ${surname}`);
    }
  }
  return out;
}
