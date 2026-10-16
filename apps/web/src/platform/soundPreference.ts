const KEY = 'clutch_sound_enabled_v1';

// Once the player toggles in this session, memory wins over storage so the
// choice holds even when localStorage is unavailable or silently drops writes.
let memory: boolean | null = null;

// Fail-open towards sound on: if storage is unreadable, sound stays enabled.
export function readSoundEnabled(): boolean {
  if (memory !== null) return memory;
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeSoundEnabled(enabled: boolean): void {
  memory = enabled;
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    // localStorage unavailable: the in-memory value still applies this session
  }
}

// Test helper: forgets the in-session value so storage is read again.
export function resetSoundPreferenceMemory(): void {
  memory = null;
}
