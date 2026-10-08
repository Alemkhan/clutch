import type { Phase } from './gameSession';

// The shared Match HUD (names, percents, progress bars, sound toggle) is shown
// during the question, its resolution and the hammer strike itself.
const HUD_PHASES: ReadonlySet<Phase> = new Set<Phase>(['question', 'resolution', 'hammer']);

export function shouldShowMatchHud(phase: Phase): boolean {
  return HUD_PHASES.has(phase);
}
