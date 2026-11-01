import { describe, expect, it } from 'vitest';
import { displayLabel, validateInventoryRecord } from './build-other-flags-inventory.mjs';

const item = {
  id: 'us_state:Q99:flag-of-example-svg', group: 'us_state', labelRu: 'Пример', adoptedYear: 2026,
  assetKind: 'flag', wikidataUrl: 'https://www.wikidata.org/wiki/Q99', sourceTitle: 'Wikidata: Пример', sourceCheckedAt: '2026-10-31',
  asset: { fileName: 'Flag of Example.svg', url: 'https://upload.wikimedia.org/example.svg', pageUrl: 'https://commons.wikimedia.org/wiki/File:Flag_of_Example.svg', license: 'CC BY-SA 4.0', author: 'Example author' },
  assetLicenseStatus: 'free',
  reviewStatus: 'pending', reviewNote: 'Media provenance проверен. Год принятия не подтверждён первичным источником.',
};

describe('other flags pending inventory', () => {
  it('renders the adoption year beside the name only when it is verified', () => {
    expect(displayLabel('Астана', 2022)).toBe('Астана · 2022');
    expect(displayLabel('Астана', null)).toBe('Астана');
  });

  it('requires provenance and a safe media license before a record can be reviewed', () => {
    expect(validateInventoryRecord(item)).toBe(true);
    expect(() => validateInventoryRecord({ ...item, asset: { ...item.asset, license: 'All rights reserved' } })).toThrow(/лицензия/);
    expect(() => validateInventoryRecord({ ...item, adoptedYear: 999 })).toThrow(/Год/);
  });

  it('keeps a Commons file with no stated author reviewable when the file page says so', () => {
    expect(validateInventoryRecord({ ...item, asset: { ...item.asset, author: null, authorNote: 'not stated on the Commons file page' } })).toBe(true);
  });

  it('retains a copyrighted-free-use asset only as a blocked review item', () => {
    const protectedItem = { ...item, asset: { ...item.asset, license: 'Copyrighted free use' }, assetLicenseStatus: 'manual_review', reviewStatus: 'blocked', rightsNote: 'Нужна отдельная проверка условий правообладателя.', reviewNote: 'Нужна отдельная проверка условий правообладателя. Год принятия не подтверждён первичным источником.' };
    expect(validateInventoryRecord(protectedItem)).toBe(true);
  });

  it('marks organisation marks for separate trademark review', () => {
    const organisation = { ...item, group: 'organisation', trademarkReview: 'required' };
    expect(validateInventoryRecord(organisation)).toBe(true);
    expect(() => validateInventoryRecord({ ...organisation, trademarkReview: undefined })).toThrow(/товарного знака/);
  });
});
