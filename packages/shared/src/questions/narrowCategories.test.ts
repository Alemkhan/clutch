import { describe, expect, it } from 'vitest';
import { countries } from './countries';
import {
  NARROW_CATEGORY_MAX_MEMBERS,
  NARROW_CATEGORY_MIN_MEMBERS,
  narrowCategories,
} from './narrowCategories';

const SENSITIVE = ['xk', 'ps', 'tw', 'il'];

describe('narrowCategories', () => {
  const known = new Set(countries.map((c) => c.code));

  it('has unique ids', () => {
    const ids = narrowCategories.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(narrowCategories.map((c) => [c.id, c] as const))('%s is valid', (_id, cat) => {
    expect(cat.titleRu.trim()).not.toBe('');
    for (const code of cat.countryCodes) expect(known.has(code), code).toBe(true);
    for (const code of cat.countryCodes) expect(SENSITIVE).not.toContain(code);
    expect(cat.countryCodes.length).toBeGreaterThanOrEqual(NARROW_CATEGORY_MIN_MEMBERS);
    expect(cat.countryCodes.length).toBeLessThanOrEqual(NARROW_CATEGORY_MAX_MEMBERS);
    expect(new Set(cat.countryCodes).size).toBe(cat.countryCodes.length);
    expect(cat.sourceUrl).toMatch(/^https:\/\//);
    expect(cat.sourceTitle.trim()).not.toBe('');
    expect(cat.lastVerifiedAt).toBe('2026-10-08');
  });
});
