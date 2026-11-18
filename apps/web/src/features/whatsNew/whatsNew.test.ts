import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CLANS_FROM } from '@clutch/shared';
import { nextRelease, parseSeen, releaseItems, releaseVersions, WhatsNewDialog, WHATS_NEW_RELEASE } from './WhatsNew';
import type { WhatsNewItem } from './messages';

const base: WhatsNewItem = { icon: '🌍', title: 'Три языка', text: '…' };
const clans: WhatsNewItem = { icon: '🦆', title: 'Кланы', text: '…', since: CLANS_FROM };
const items = [clans, base];

describe('what is new by release', () => {
  it('keeps clans a separate release', () => {
    expect(releaseVersions(items)).toEqual([CLANS_FROM, WHATS_NEW_RELEASE]);
    expect(releaseItems(items, CLANS_FROM)).toEqual([clans]);
    expect(releaseItems(items, WHATS_NEW_RELEASE)).toEqual([base]);
  });

  it('shows the newest unseen release, the older one on the next visit', () => {
    expect(nextRelease(items, parseSeen(null))).toBe(CLANS_FROM);
    expect(nextRelease(items, parseSeen(CLANS_FROM))).toBe(WHATS_NEW_RELEASE);
    expect(nextRelease(items, parseSeen(WHATS_NEW_RELEASE))).toBe(CLANS_FROM);
    expect(nextRelease(items, parseSeen(`${WHATS_NEW_RELEASE},${CLANS_FROM}`))).toBeNull();
  });

  it('reads the old single-version value', () => {
    expect([...parseSeen('2026-11-17')]).toEqual(['2026-11-17']);
  });

  it('gives the clans window its own title and a claim button', () => {
    const html = renderToStaticMarkup(createElement(WhatsNewDialog, { release: CLANS_FROM, onClose: vi.fn(), onClan: vi.fn() }));
    expect(html).toContain('Новое в Clutch: кланы');
    expect(html).toContain('Кланы-эмодзи');
    expect(html).not.toContain('Три языка');
    expect(html).toContain('Занять своё эмодзи');
    const release = renderToStaticMarkup(createElement(WhatsNewDialog, { release: WHATS_NEW_RELEASE, onClose: vi.fn() }));
    expect(release).toContain('Три языка');
    expect(release).not.toContain('Кланы-эмодзи');
  });
});
