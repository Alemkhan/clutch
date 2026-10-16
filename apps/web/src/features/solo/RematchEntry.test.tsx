import { describe, expect, it } from 'vitest';
import { ApiError } from '../../platform/api';
import { soloStartErrorMessage } from './soloRunFlow';
import { rematchErrorKind, rematchGoneText } from './RematchEntry';

describe('friend link states', () => {
  it('names each reason shortly: taken, expired, own', () => {
    expect(rematchGoneText('taken')).toBe('Ссылку уже занял другой игрок.');
    expect(rematchGoneText('expired')).toBe('Срок ссылки вышел.');
    expect(rematchGoneText('own')).toBe('Это твоя ссылка. Отправь её другу.');
    expect(rematchGoneText(undefined)).toContain('использовано');
  });

  it('treats refusals from the preview as a closed link, not a connection error', () => {
    for (const status of [403, 404, 410]) expect(rematchErrorKind(new ApiError(status))).toBe('gone');
    expect(rematchErrorKind(new ApiError(500))).toBe('error');
  });

  it('says the same when the start itself is refused after the preview', () => {
    expect(soloStartErrorMessage(new ApiError(410, undefined, 'taken'))).toBe('Ссылку уже занял другой игрок.');
    expect(soloStartErrorMessage(new ApiError(403, undefined, 'own'))).toBe('Это твоя ссылка. Отправь её другу.');
  });
});
