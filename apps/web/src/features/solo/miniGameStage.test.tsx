import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_SOLO_RUN_CONDITIONS,
  SOLO_ROUND_CAP,
  SOLO_TARGET_PROGRESS,
  generateMatch,
  type MiniGameId,
  type StartSoloRunResponse,
} from '@clutch/shared';
import { normalizeSoloRun } from './clientMatchRules';
import { SoloRunScreen } from './SoloRun';
import { applyLoadedSoloRun, beginSoloLoading, startSoloPlay, type SoloFlowState } from './soloRunFlow';
import type { SoloSaveState } from './useSoloRun';

const questions = generateMatch(24, 0, 'geography');
const config = CURRENT_SOLO_RUN_CONDITIONS.miniGame.config;
const saving: SoloSaveState = { status: 'saving', response: null, canRetry: false };
const handlers = {
  onSelectCategory: vi.fn(),
  onRetryStart: vi.fn(),
  onBackToCategories: vi.fn(),
  onStart: vi.fn(),
  onAnswer: vi.fn(),
  onContinue: vi.fn(),
  onHammerComplete: vi.fn(),
  onRetrySave: vi.fn(),
  onHome: vi.fn(),
  onMyRuns: vi.fn(),
};

function loaded(miniGameId: MiniGameId): SoloFlowState {
  return applyLoadedSoloRun(beginSoloLoading('geography'), {
    runId: 'run-1', questions, pace: null, config, miniGameId, bankExhausted: false,
  });
}

const render = (state: SoloFlowState) => renderToStaticMarkup(
  <SoloRunScreen state={state} save={saving} {...handlers} />,
);

describe('mini-game of the run on the client', () => {
  it('validates the game from the server response', () => {
    const response: StartSoloRunResponse = {
      runId: 'r', questions, pace: null, target: SOLO_TARGET_PROGRESS, roundCap: SOLO_ROUND_CAP,
      rulesVersion: 'solo-to-100-v2', miniGameId: 'tower_stack', bankExhausted: false,
    };
    expect(normalizeSoloRun(response).miniGameId).toBe('tower_stack');
    expect(() => normalizeSoloRun({ ...response, miniGameId: 'darts' as MiniGameId })).toThrow();
    expect(() => normalizeSoloRun({ ...response, miniGameId: undefined as unknown as MiniGameId })).toThrow();
  });

  it('names the game of the run on the ready screen', () => {
    const tower = render(loaded('tower_stack'));
    expect(tower).toContain('Мини-игра этой партии');
    expect(tower).toContain('Башня');
    const hammer = render(loaded('hammer_nail'));
    expect(hammer).toContain('Молоток');
    expect(hammer).not.toContain('Башня');
  });

  it('renders the game chosen by the server for the attempt', () => {
    const tower = render({ ...startSoloPlay(loaded('tower_stack')), stage: 'hammer' });
    expect(tower).toContain('tower-game');
    expect(tower).not.toContain('hammer-game');
    const hammer = render({ ...startSoloPlay(loaded('hammer_nail')), stage: 'hammer' });
    expect(hammer).toContain('hammer-game');
    expect(hammer).not.toContain('tower-game');
  });
});
