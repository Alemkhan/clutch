import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  LastStandFinal,
  LastStandIntro,
  LastStandLeaderboard,
  LastStandReveal,
  LastStandRoundScreen,
  LastStandStatus,
} from './LastStand';
import {
  applyLastStandAnswer,
  lastStandStarted,
  parseStartResponse,
  recordSentAnswer,
} from '../lib/lastStandRun';

const round = { index: 4, scale: 'narrow' as const, titleRu: 'Очень длинное название категории стран Юго-Восточной Азии', timeMs: 7000 };
const started = lastStandStarted(parseStartResponse({
  runId: 'r', dateKey: '2026-10-08',
  opponents: [{ displayName: 'Dana', source: 'bot' }, { displayName: 'Рахат', source: 'player' }],
  round,
}), Date.now());
const noop = vi.fn();

describe('Last Stand screens', () => {
  it('round shows category, round number, input, labelled opponents', () => {
    const html = renderToStaticMarkup(<LastStandRoundScreen state={started} submitting={false} onSubmit={noop} />);
    expect(html).toContain('Юго-Восточной Азии');
    expect(html).toContain('Круг 5 из 12');
    expect(html).toContain('role="timer"');
    expect(html).toContain('<input');
    expect(html).toContain('Бот');
    expect(html).toContain('Запись игрока');
    expect(html).not.toContain('readonly');
  });

  it('occupied and invalid show distinct notices; sending locks the field', () => {
    const occupied = applyLastStandAnswer(started, {
      status: 'occupied', reason: null, deadlineMs: 12000, reveal: [], survived: 4, round: null,
    }, Date.now());
    expect(renderToStaticMarkup(<LastStandRoundScreen state={occupied} submitting={false} onSubmit={noop} />))
      .toContain('Занято!');
    const invalid = applyLastStandAnswer(started, {
      status: 'invalid', reason: null, deadlineMs: 7000, reveal: [], survived: 4, round: null,
    }, Date.now());
    const html = renderToStaticMarkup(<LastStandRoundScreen state={invalid} submitting onSubmit={noop} />);
    expect(html).toContain('Не узнаю');
    expect(html).not.toContain('Занято!');
    expect(html).toContain('readonly');
    expect(html).toContain('disabled');
  });

  it('reveal lists answers, times, sources and the fastest', () => {
    const sent = recordSentAnswer(started, 'Китай', 2400);
    const next = applyLastStandAnswer(sent, {
      status: 'accepted', reason: null, deadlineMs: 7000, survived: 5,
      reveal: [{ displayName: 'Dana', answerRu: 'Япония', atMs: 3200 }],
      round: { ...round, index: 5 },
    }, Date.now());
    const html = renderToStaticMarkup(
      <LastStandReveal snapshot={next.reveal!} survived={5} finalRound={false} onContinue={noop} />,
    );
    expect(html).toContain('Япония');
    expect(html).toContain('3,2 с');
    expect(html).toContain('Бот');
    expect(html).toContain('быстрее всех');
    expect(html).toContain('Следующий круг');
  });

  it('final shows score, reason and both actions', () => {
    const html = renderToStaticMarkup(
      <LastStandFinal state={{ survived: 3, outcome: 'eliminated', reason: 'timeout' }} onAgain={noop} onLeaderboard={noop} onHome={noop} />,
    );
    expect(html).toContain('3 круга из 12');
    expect(html).toContain('Время вышло');
    expect(html).toContain('Ещё раз');
    expect(html).toContain('На главный экран');
    const cleared = renderToStaticMarkup(
      <LastStandFinal state={{ survived: 12, outcome: 'cleared', reason: null }} onAgain={noop} onLeaderboard={noop} onHome={noop} />,
    );
    expect(cleared).toContain('Забег пройден');
  });

  it('final names the mine the player stepped on, and the intro explains it', () => {
    const html = renderToStaticMarkup(
      <LastStandFinal state={{ survived: 2, outcome: 'eliminated', reason: 'mined', mineRu: 'США' }} onAgain={noop} onLeaderboard={noop} onHome={noop} />,
    );
    expect(html).toContain('Ты назвал загаданное: США.');
    expect(renderToStaticMarkup(<LastStandIntro onStart={noop} onLeaderboard={noop} onBack={noop} />)).toContain('загаданный ответ');
  });

  it('leaderboard handles loading, error, empty and ranked rows', () => {
    const props = { onRetry: noop, onClose: noop };
    expect(renderToStaticMarkup(<LastStandLeaderboard view={{ status: 'loading' }} {...props} />)).toContain('Загружаем');
    const err = renderToStaticMarkup(<LastStandLeaderboard view={{ status: 'error', error: 'Сбой' }} {...props} />);
    expect(err).toContain('Сбой');
    expect(err).toContain('Повторить');
    expect(renderToStaticMarkup(
      <LastStandLeaderboard view={{ status: 'ready', data: { dateKey: '2026-10-08', entries: [] } }} {...props} />,
    )).toContain('никто не закончил');
    const html = renderToStaticMarkup(
      <LastStandLeaderboard
        view={{ status: 'ready', data: { dateKey: '2026-10-08', entries: [{ displayName: 'Dana', survived: 7, completedAt: 1 }] } }}
        {...props}
      />,
    );
    expect(html).toContain('Dana');
    expect(html).toContain('7 из 12');
  });

  it('intro does not name opponents; loading and error are honest', () => {
    expect(renderToStaticMarkup(<LastStandIntro onStart={noop} onLeaderboard={noop} onBack={noop} />))
      .toContain('Начать забег');
    const loading = renderToStaticMarkup(<LastStandStatus title="Собираем забег" body="Подбираем…" loading />);
    expect(loading).not.toContain('Dana');
    expect(renderToStaticMarkup(<LastStandStatus title="x" body="Нет сети" onRetry={noop} onBack={noop} />))
      .toContain('Повторить');
  });
});
