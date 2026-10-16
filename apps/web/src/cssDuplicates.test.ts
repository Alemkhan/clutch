import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { topLevelDuplicateSelectors } from './cssDuplicates';

const srcDir = dirname(fileURLToPath(import.meta.url));
const entry = join(srcDir, 'index.css');

/** Файлы, подключённые из index.css через @import, в порядке следования (рекурсивно). */
function importedFiles(file: string): string[] {
  const out: string[] = [];
  for (const [, path] of readFileSync(file, 'utf8').matchAll(/^@import\s+['"]([^'"]+)['"];/gm)) {
    const target = resolve(dirname(file), path);
    out.push(target, ...importedFiles(target));
  }
  return out;
}

function cssFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entryItem) => {
    const full = join(dir, entryItem.name);
    if (entryItem.isDirectory()) return cssFilesUnder(full);
    return full.endsWith('.css') ? [full] : [];
  });
}

describe('top-level css selectors', () => {
  it('finds a selector declared twice and ignores nested blocks', () => {
    const css = '.a{color:red}.b{x:1}@media (min-width:1px){.a{color:blue}}.a{margin:0}';
    expect(topLevelDuplicateSelectors(css)).toEqual(['.a']);
  });

  it('the combined stylesheet declares every selector once', () => {
    const css = importedFiles(entry).map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(topLevelDuplicateSelectors(css)).toEqual([]);
  });

  it('index.css only lists imports, and every css file under src is imported exactly once', () => {
    const body = readFileSync(entry, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^@import\s+['"][^'"]+['"];$/gm, '');
    expect(body.trim()).toBe('');
    const imported = importedFiles(entry).map((file) => relative(srcDir, file).split(sep).join('/')).sort();
    const all = cssFilesUnder(srcDir).map((file) => relative(srcDir, file).split(sep).join('/')).filter((file) => file !== 'index.css').sort();
    expect(imported).toEqual(all);
    expect(new Set(imported).size).toBe(imported.length);
  });
});
