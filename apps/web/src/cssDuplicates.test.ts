import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { topLevelDuplicateSelectors } from './cssDuplicates';

describe('top-level css selectors', () => {
  it('finds a selector declared twice and ignores nested blocks', () => {
    const css = '.a{color:red}.b{x:1}@media (min-width:1px){.a{color:blue}}.a{margin:0}';
    expect(topLevelDuplicateSelectors(css)).toEqual(['.a']);
  });

  it('index.css declares every selector once', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
    expect(topLevelDuplicateSelectors(css)).toEqual([]);
  });
});
