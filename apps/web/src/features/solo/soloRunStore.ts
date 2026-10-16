/**
 * Какой соло-забег идёт на этом устройстве. Круги сохраняются на сервере сразу, так что закрытая вкладка
 * забег не теряет; здесь хранится только его id, чтобы найти и продолжить. Ответов и вопросов тут нет.
 */
const KEY = 'clutch_solo_active_v1';

export interface ActiveSoloRun {
  runId: string;
  /** Тренировка против бота живёт отдельно от зачётного забега: продолжается только на своём экране. */
  practice: boolean;
}

export function saveActiveSoloRun(run: ActiveSoloRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    // Хранилище недоступно: забег идёт, но после перезагрузки его не найти.
  }
}

export function loadActiveSoloRun(): ActiveSoloRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ActiveSoloRun> | null;
    return value && typeof value.runId === 'string' && value.runId.length > 0 && typeof value.practice === 'boolean'
      ? { runId: value.runId, practice: value.practice }
      : null;
  } catch {
    return null;
  }
}

export function clearActiveSoloRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // нечего очищать
  }
}
