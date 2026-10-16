const KEY = 'clutch_hammer_intro_seen_v1';

// Fail-open towards showing: if storage is unreadable, the explanation is shown.
export function hasSeenHammerIntro(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markHammerIntroSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // localStorage unavailable
  }
}
