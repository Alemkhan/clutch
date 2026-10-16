/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Таблицы стран, флагов и языков содержат ответы. Пока они в бандле, ответ на «назовите столицу» берётся
 * прямым поиском. Сборку тест не гоняет; он держит два условия, без которых таблицы возвращаются:
 * веб не импортирует генераторы/таблицы, а shared помечен как свободный от побочных эффектов.
 * Итоговая проверка бандла: `npm run build` и поиск «Уагадугу» в apps/web/dist/assets (должно быть 0).
 */
const SOURCE = new URL('.', import.meta.url);
const FORBIDDEN = [
  'countries', 'generateMatch', 'generateQuestionById', 'generateFixedCapitalQuiz', 'dailyQuestionSet',
  'dailyQuestionSetIds', 'historicFlags', 'languages', 'isKnownQuestionId', 'questionIdCategory',
  'planLastStandRounds', 'regionalCategories', 'FLAG_TRAITS',
];

function sourceFiles(directory: URL): URL[] {
  return readdirSync(directory).flatMap((name) => {
    const path = new URL(`${name}`, directory.href.endsWith('/') ? directory : `${directory.href}/`);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Что файл берёт из @clutch/shared как значение (type-импорты стираются и данных не приносят). */
function sharedValueImports(code: string): string[] {
  const names: string[] = [];
  for (const match of code.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+'@clutch\/shared'/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim();
      if (name && !name.startsWith('type ')) names.push(name.split(/\s+as\s+/)[0]);
    }
  }
  return names;
}

describe('answer data stays out of the browser bundle', () => {
  it('no web source imports a question generator or a data table as a value', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SOURCE)) {
      const imported = sharedValueImports(readFileSync(file, 'utf8'));
      for (const name of imported) {
        if (FORBIDDEN.includes(name)) offenders.push(`${file.pathname.split('/src/')[1]}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shared package is declared free of side effects, so unused tables are dropped from the bundle', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../packages/shared/package.json', import.meta.url), 'utf8'),
    ) as { sideEffects?: unknown };
    expect(manifest.sideEffects).toBe(false);
  });
});
