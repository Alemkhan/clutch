const KEY = 'clutch_tower_intro_seen_v1';

// Fail-open towards showing: if storage is unreadable, the explanation is shown.
export function hasSeenTowerIntro(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markTowerIntroSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // localStorage unavailable
  }
}
