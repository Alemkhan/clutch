import { describe, expect, it } from 'vitest';
import published from '../../../../content/other-flags/published.json';
import { toPublicQuestion } from '../index';
import { otherFlags } from './otherFlags';
import { generateHistoricFlag } from './questionGenerator';

describe('masked «Другие флаги»', () => {
  const masked = otherFlags.filter((flag) => flag.revealMediaUrl);

  it('serves the app copy in the question and keeps the Commons original for the answer', () => {
    expect(masked.length).toBeGreaterThan(0);
    for (const flag of masked) {
      expect(flag.mediaUrl).toMatch(/^\/flags-other\/[0-9a-f]{16}\.webp$/);
      expect(flag.revealMediaUrl).toMatch(/^https:\/\/[a-z]+\.wikimedia\.org\//);
    }
    // Нетронутые копии тоже свои (быстрее Commons), но открывать на разборе нечего.
    const plain = otherFlags.filter((flag) => flag.mediaUrl.startsWith('/flags-other/') && !flag.revealMediaUrl);
    expect(plain.length + masked.length).toBeLessThanOrEqual(Object.keys(published).length);
  });

  it('does not leak the original image with the question', () => {
    const question = generateHistoricFlag(masked[0]);
    expect(question.revealMediaUrl).toBe(masked[0].revealMediaUrl);
    expect(toPublicQuestion(question)).not.toHaveProperty('revealMediaUrl');
    expect(JSON.stringify(toPublicQuestion(question))).not.toContain('wikimedia');
  });
});
