/// <reference types="node" />

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  WIDGET_MAX_HTML_BYTES,
  WIDGET_MAX_ZLIB_BYTES,
  buildDailyWidgetHtml,
  dailyWidgetQuestion,
  widgetQuestionPool,
} from '../apps/api/src/notifications/dailyWidget';

const LINK = 'https://t.me/playclutchbot?startapp=daily_quiz';

function optionsOf(html: string): { o: string[]; a: number; l: string } {
  return JSON.parse(/const D=(\{.*?\});/s.exec(html)![1].replaceAll('<\\/', '</'));
}

describe('daily question widget', () => {
  it('has enough approved questions to rotate', () => {
    expect(widgetQuestionPool().length).toBeGreaterThan(100);
    expect(widgetQuestionPool().every((record) => record.editorialStatus === 'approved' && record.topic !== 'kazakhstan')).toBe(true);
  });

  it('fits Telegram limits for every question in the pool', () => {
    const tooBig = widgetQuestionPool().filter((record) => {
      const html = buildDailyWidgetHtml({
        questionId: record.id,
        prompt: record.promptRu,
        options: [record.answerRu, ...record.distractorsRu.slice(0, 3)],
        answerIndex: 0,
        explanation: record.explanationRu ?? '',
      }, LINK);
      return Buffer.byteLength(html) > WIDGET_MAX_HTML_BYTES || deflateSync(Buffer.from(html), { level: 9 }).length > WIDGET_MAX_ZLIB_BYTES;
    });
    expect(tooBig.map((record) => record.id)).toEqual([]);
  });

  it('picks the same question for everyone on a day and points at the right answer', () => {
    const today = dailyWidgetQuestion('2026-11-13')!;
    expect(dailyWidgetQuestion('2026-11-13')).toEqual(today);
    const record = widgetQuestionPool().find((candidate) => candidate.id === today.questionId)!;
    expect(today.options).toHaveLength(4);
    expect(today.options[today.answerIndex]).toBe(record.answerRu);
    const days = new Set(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map((day) => dailyWidgetQuestion(day)!.questionId));
    expect(days.size).toBeGreaterThan(1);
  });

  it('keeps question data from closing the script tag', () => {
    const html = buildDailyWidgetHtml({
      questionId: 'x', prompt: 'Что значит </script><b>?', options: ['a', 'b', 'c', 'd'], answerIndex: 2, explanation: '',
    }, LINK);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const data = optionsOf(html);
    expect(data).toMatchObject({ a: 2, l: LINK });
  });
});
