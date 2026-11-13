import { describe, expect, it } from 'vitest';
import { playerDisplayName } from '../apps/api/src/auth/displayName';

const guest = { playerId: 'guest:3fa85f64-5717-4562-b3fc-2c963f66afa6', kind: 'guest' as const };

describe('player display name', () => {
  it('uses the signed Telegram name', () => {
    expect(playerDisplayName({ playerId: 'telegram:1', kind: 'telegram', displayName: ' Мирас ' }, 'Другое')).toBe('Мирас');
  });

  it('accepts only the generated guest name, never free text from the request', () => {
    expect(playerDisplayName(guest, 'Игрок 1a2b')).toBe('Игрок 1a2b');
    expect(playerDisplayName(guest, 'Любой текст в рейтинг')).toBe('Игрок 3fa8');
    expect(playerDisplayName(guest, 'Игрок 1a2b, подпишись')).toBe('Игрок 3fa8');
    expect(playerDisplayName(guest)).toBe('Игрок 3fa8');
  });
});
