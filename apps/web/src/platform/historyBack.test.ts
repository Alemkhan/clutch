import { describe, expect, it, vi } from 'vitest';
import { HistoryBackController, type HistoryAdapter } from './historyBack';

/** История как стек: back() снимает запись и сообщает об этом, как popstate. */
function fakeHistory() {
  let depth = 0;
  let listener: (() => void) | null = null;
  const adapter: HistoryAdapter = {
    push: () => { depth += 1; },
    back: () => { if (depth > 0) depth -= 1; listener?.(); },
    onPop: (next) => { listener = next; return () => { listener = null; }; },
  };
  /** Системная «Назад»: на пустой истории приложение закрылось бы. */
  const pressBack = () => {
    if (depth === 0) return 'exit';
    depth -= 1;
    listener?.();
    return 'stayed';
  };
  return { adapter, pressBack, depth: () => depth };
}

describe('system back outside Telegram', () => {
  it('goes home from a section, then exits from home', () => {
    const history = fakeHistory();
    const navigate = vi.fn();
    const controller = new HistoryBackController(history.adapter, navigate);
    controller.mount();
    controller.setState('home', false);
    expect(history.pressBack()).toBe('stayed');
    expect(navigate).toHaveBeenCalledWith('home');
    controller.setState('hidden', false);
    expect(history.pressBack()).toBe('exit');
  });

  it('does not let back close the app during a run', () => {
    const history = fakeHistory();
    const navigate = vi.fn();
    const controller = new HistoryBackController(history.adapter, navigate);
    controller.mount();
    controller.setState('hidden', true);
    expect(history.pressBack()).toBe('stayed');
    expect(history.pressBack()).toBe('stayed');
    expect(navigate).not.toHaveBeenCalled();
    controller.setState('home', false);
    expect(history.depth()).toBe(1);
  });

  it('drops its entry when the player returns home with in-app buttons', () => {
    const history = fakeHistory();
    const navigate = vi.fn();
    const controller = new HistoryBackController(history.adapter, navigate);
    controller.mount();
    controller.setState('home', false);
    controller.setState('hidden', false);
    expect(history.depth()).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
    expect(history.pressBack()).toBe('exit');
  });
});
