import { describe, expect, it } from 'vitest';
import { CATEGORY_POOL_SIZES } from './categoryStats';
import { countries } from './countries';
import { livePackRecords } from './generalSet';
import { historicFlags } from './historicFlags';
import { languages } from './languages';

describe('category pool sizes shown in the category list', () => {
  it('match the data', () => {
    expect(CATEGORY_POOL_SIZES).toEqual({
      // Темы, которые реально есть в наборе «Общих знаний» (тема «Казахстан» живёт в своей категории).
      generalTopics: new Set(livePackRecords().map((record) => record.topic)).size,
      countries: countries.length,
      otherFlags: historicFlags.length,
      languages: languages.length,
    });
  });
});
