import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMatch, type CompleteSoloRunResponse, type SkillResult, type SoloLeaderboardStanding } from '@clutch/shared';
import { SoloResult } from './SoloResult';
import { applySoloSessionRound, createSoloRunSession, soloRunView } from './soloRunSession';
import * as telegram from '../../platform/telegram';
import type { RunStandingState } from './soloResultModel';

const questions = generateMatch(24, 0, 'geography');

function view(awards: number[]) {
  return soloRunView(awards.reduce(applySoloSessionRound, createSoloRunSession(questions, null)));
}

function response(patch: Partial<CompleteSoloRunResponse> = {}): CompleteSoloRunResponse {
  return {
    runId: 'run-1', rounds: [], progress: 100, correctCount: 5, roundsPlayed: 4, reachedTarget: true,
    par: 6, score: 1, outcome: null, ...patch,
  };
}

const you: SoloLeaderboardStanding = {
  rank: 3, total: 40, roundsToNext: 1, placeAbove: 2, outrankedByGuess: false, tiebreak: 'answered',
  entry: { rank: 3, displayName: 'Я', soloScore: 1, setPar: 6, roundsPlayed: 4, completedAt: 1 },
};
const skills: SkillResult[] = ['perfect', 'great', 'perfect', 'miss'];

function render(props: Partial<Parameters<typeof SoloResult>[0]> = {}) {
  return renderToStaticMarkup(
    <SoloResult
      view={view([25, 25, 25, 25])}
      saveStatus="saved"
      response={response()}
      canRetrySave={false}
      onRetrySave={vi.fn()}
      onReplay={vi.fn()}
      onMyRuns={vi.fn()}
      category="geography"
      correctCount={4}
      skillResults={skills}
      standing={{ status: 'ready', standing: you }}
      {...props}
    />,
  );
}

afterEach(() => { vi.restoreAllMocks(); });

describe('solo result receipt', () => {
  it('mentions Telegram in the record card only for a Telegram player', () => {
    vi.spyOn(telegram, 'getTelegramIdentity').mockReturnValue({ id: 1, displayName: 'Я' } as never);
    expect(render({ mode: 'duel' })).toContain('«Партии» и в Telegram.');
  });

  it('without the invite button «Поделиться» takes its slot, so a short run can be shared too', () => {
    const html = render({ mode: 'duel', friendDuel: null, response: response({ reachedTarget: false, progress: 40 }) });
    expect(html).not.toContain('Позвать друга');
    expect(html).toContain('>Поделиться<');
    expect(render({ mode: 'duel' })).not.toContain('>Поделиться<');
  });

  it('the run of the day: place in the table, shared not invited, then a duel or free play', () => {
    const html = render({ mode: 'daily', onPlayMode: vi.fn() });
    expect(html).toContain('за 4 круга · География');
    expect(html).toMatch(/data-stat="correct"><strong>5\/4<\/strong><span>верных/);
    expect(html).toMatch(/data-stat="perfect"><strong>2<\/strong><span>идеально/);
    expect(html).toMatch(/data-stat="place"><strong>3-й<\/strong><span>в таблице/);
    // Не дуэль: ни карточки «ждёт соперника», ни побед и поражений.
    expect(html).not.toContain('Твоя запись');
    expect(html).not.toMatch(/Победа|Поражение|Ничья/);
    // Друга с забега дня не зовут: он узнал бы вопросы дня.
    expect(html).not.toContain('Позвать друга');
    expect(html).toContain('>Поделиться<');
    expect(html).toMatch(/class="cta-btn"[^>]*>Дуэль</);
    expect(html).toContain('>Свободная игра<');
    expect(html).toContain('Мои партии');
  });

  it('a duel without an opponent waits as a record and can be sent to a friend', () => {
    const html = render({ mode: 'duel', onPlayMode: vi.fn() });
    expect(html).toContain('Твоя запись');
    expect(html).toContain('ждёт соперника');
    expect(html).toContain('Против неё сыграет следующий, кто выйдет на дуэль. Исход придёт в «Партии»');
    expect(html).not.toContain('data-stat="place"');
    expect(html).toContain('Позвать друга');
    expect(html).toMatch(/class="cta-btn"[^>]*>Ещё дуэль</);
  });

  it('a duel the opponent finished first says so in the words of the mini-game', () => {
    const pace = { id: 'p', displayName: 'Аня', rounds: [25, 25, 25, 25].map((progressAwarded, index) => (
      { questionId: questions[index].id, correct: true, responseTimeMs: 1000, skillScore: 1, progressAwarded })) };
    const lost = { mode: 'duel' as const, pace, roundCap: 4, view: view([25, 0, 12, 0]), response: response({ reachedTarget: false, progress: 37, roundsPlayed: 4 }) };
    expect(render({ ...lost, miniGameId: 'hammer_nail' })).toContain('Соперник забил гвоздь первым');
    expect(render({ ...lost, miniGameId: 'tower_stack' })).toContain('Соперник достроил башню первым');
    expect(render(lost)).toContain('Он дошёл до 100% за 4 круга. У тебя 37%.');
  });

  it('a duel shows its outcome right away: win, loss, tie', () => {
    const pace = { id: 'p', displayName: 'Дамир', rounds: [25, 25, 25, 25].map((progressAwarded, index) => (
      { questionId: questions[index].id, correct: true, responseTimeMs: 1000, skillScore: 1, progressAwarded })) };
    const duel = { mode: 'duel' as const, pace, roundCap: 4 };
    expect(render({ ...duel, response: response({ outcome: 'player', roundsPlayed: 4 }) })).toContain('Победа: Дамир позади');
    expect(render({ ...duel, response: response({ outcome: 'tie' }) })).toContain('>Ничья<');
    const lost = render({ ...duel, miniGameId: 'hammer_nail', view: view([25, 0, 12, 0]), response: response({ outcome: 'opponent', reachedTarget: false, progress: 37 }) });
    expect(lost).toContain('Соперник забил гвоздь первым');
    expect(lost).toContain('result-headline loss');
    expect(lost).not.toContain('До 100% не дошёл');
  });

  it('free play: no table, no record card, the next set is one tap away', () => {
    const html = render({ mode: 'free', onPlayMode: vi.fn() });
    expect(html).not.toContain('data-stat="place"');
    expect(html).not.toContain('Твоя запись');
    expect(html).toMatch(/class="cta-btn"[^>]*>Ещё набор</);
    expect(html).toContain('Позвать друга');
  });

  it('place is a dash while loading, on error or without a standing', () => {
    const states: RunStandingState[] = [
      { status: 'loading' }, { status: 'error' }, { status: 'ready', standing: null },
    ];
    for (const standing of states) {
      const html = render({ standing, mode: 'daily' });
      expect(html).toMatch(/data-stat="place"><strong>—<\/strong>/);
      expect(html).toContain('Сыграть ещё');
    }
  });

  it('did not reach the target: no place, no record card, honest text', () => {
    const html = render({ view: view(new Array<number>(20).fill(2)), response: response({ reachedTarget: false, progress: 40, roundsPlayed: 20 }) });
    expect(html).toContain('До 100% не дошёл');
    expect(html).not.toContain('data-stat="place"');
    expect(html.match(/data-stat=/g)).toHaveLength(2);
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('Лимит забега — 20 кругов, и он закончился. Ты набрал 40% из 100%.');
    expect(html).not.toContain('из 100% за');
    expect(html.match(/20 кругов/g)).toHaveLength(2);
    expect(html).not.toContain('Твоя запись');
    expect(html).not.toContain('Позвать друга');
    expect(html).toContain('>Поделиться<');
    expect(html).toContain('Мои партии');
  });

  it('friend duel: no place and no record card', () => {
    const html = render({
      friendDuel: { outcome: 'player', headline: 'Ты обыграл Алекса', line: 'Счёт лучше.', tiebreakLine: '' },
    });
    expect(html).toContain('Ты обыграл Алекса');
    expect(html).not.toContain('data-stat="place"');
    expect(html).not.toContain('Твоя запись');
    expect(html).not.toContain('Позвать друга');
  });

  it('practice keeps its short result without numbers or record', () => {
    const html = render({
      practice: { outcome: 'player', headline: 'Ты обыграл бота', line: 'Быстрее.' } as never,
      onExitPractice: vi.fn(),
    });
    expect(html).toContain('Тренировка');
    expect(html).toContain('Другой уровень');
    expect(html).not.toContain('solo-result-stats');
    expect(html).not.toContain('Твоя запись');
  });

  it('saving: no record card and no place, buttons disabled; error keeps the alert', () => {
    const saving = render({ saveStatus: 'saving', response: null });
    expect(saving).toContain('Сохраняем результат');
    expect(saving).not.toContain('Твоя запись');
    expect(saving).not.toContain('data-stat="place"');
    expect(saving).toContain('disabled=""');
    const failed = render({ saveStatus: 'error', response: null, saveError: 'Не удалось сохранить результат.', canRetrySave: true });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Повторить');
    expect(failed).not.toContain('Твоя запись');
  });
});
