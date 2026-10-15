import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ResolutionScreen, stopReportAreaEvent } from './ResolutionScreen';

// Хуки заменены заглушками: компонент вызывается как функция, а обработчики берутся из дерева элементов.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
    useEffect: () => {},
  };
});
vi.mock('../lib/sounds', () => ({ playSound: () => {} }));
import {
  CLOSED_REPORT_PANEL,
  canSendReport,
  editReportComment,
  openReportPanel,
  selectReportKind,
} from '../lib/reportPanel';

const props = {
  correctAnswer: 'Астана',
  explanation: 'Астана — столица Казахстана.',
  correct: false,
  onContinue: vi.fn(),
};

function render(report?: { state: 'idle' | 'sending' | 'sent' | 'error' }) {
  return renderToStaticMarkup(
    <ResolutionScreen
      {...props}
      selectedAnswer="Алматы"
      report={report ? { onSend: vi.fn(), state: report.state } : undefined}
    />,
  );
}

describe('resolution report markup', () => {
  it('shows the small report button only when reporting is wired', () => {
    expect(render({ state: 'idle' })).toContain('Сообщить о проблеме');
    expect(render()).not.toContain('Сообщить о проблеме');
    expect(render({ state: 'idle' })).toContain('class="resolution-report"');
  });

  it('keeps report clicks and keys from continuing the whole screen', () => {
    // Корень — role="button" с тапом-«дальше»; область репорта обязана глушить оба события.
    const source = readFileSync(new URL('./ResolutionScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onClick={stopReportAreaEvent}');
    expect(source).toContain('onKeyDown={stopReportAreaEvent}');
    let stopped = false;
    stopReportAreaEvent({ stopPropagation: () => { stopped = true; } });
    expect(stopped).toBe(true);
  });

  it('renders the open panel with three reasons and a capped comment field', () => {
    const html = render({ state: 'sending' });
    for (const label of ['Неверный правильный ответ', 'Мой ответ не засчитали', 'Другое']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('aria-label="Комментарий (необязательно)"');
    expect(html).toContain('aria-pressed=');
  });

  it('shows sending and error statuses, with retry after a failure', () => {
    const sending = render({ state: 'sending' });
    expect(sending).toContain('Отправляем');
    expect(sending).toContain('role="status"');
    const error = render({ state: 'error' });
    expect(error).toContain('role="alert"');
    expect(error).toContain('Повторить');
  });

  it('replaces the form with a short thank-you after success', () => {
    const html = render({ state: 'sent' });
    expect(html).toContain('Отправлено, спасибо');
    expect(html).not.toContain('Сообщить о проблеме');
    expect(html).not.toContain('Другое');
  });
});

describe('report panel state', () => {
  it('opens once, keeps one selected reason and the typed comment', () => {
    let panel = CLOSED_REPORT_PANEL;
    expect(panel.open).toBe(false);
    panel = openReportPanel(panel);
    expect(openReportPanel(panel)).toBe(panel);
    panel = selectReportKind(panel, 'wrong_answer');
    panel = editReportComment(panel, '  Вадуц вернее  ');
    expect(panel).toEqual({ open: true, kind: 'wrong_answer', comment: '  Вадуц вернее  ' });
  });

  it('allows sending only with a chosen reason and a free network status', () => {
    const open = openReportPanel(CLOSED_REPORT_PANEL);
    expect(canSendReport(open, 'idle')).toBe(false);
    const ready = selectReportKind(open, 'other');
    expect(canSendReport(ready, 'idle')).toBe(true);
    expect(canSendReport(ready, 'error')).toBe(true);
    expect(canSendReport(ready, 'sending')).toBe(false);
    expect(canSendReport(ready, 'sent')).toBe(false);
    expect(canSendReport(CLOSED_REPORT_PANEL, 'idle')).toBe(false);
  });
});

type Node = ReactElement<{ className?: string; onClick?: (e: unknown) => void; children?: unknown }>;

function findByClass(node: unknown, className: string): Node | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByClass(child, className);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as Node;
  if (el.props?.className?.split(' ').includes(className)) return el;
  return findByClass(el.props?.children, className);
}

describe('resolution layout and one-shot continue', () => {
  const base = { correctAnswer: 'Астана', explanation: 'Пояснение.', onContinue: vi.fn() };
  const html = (p: Partial<Parameters<typeof ResolutionScreen>[0]>) =>
    renderToStaticMarkup(<ResolutionScreen {...base} correct={false} {...p} />);

  it('correct answer leads to the mini-game', () => {
    const out = html({ correct: true });
    expect(out).toContain('К мини-игре <span aria-hidden="true">→</span>');
    expect(out).toContain('Попытка заработана');
    expect(out).not.toContain('В этом раунде без мини-игры');
    expect(out).not.toContain('Твой ответ');
  });

  it('wrong answer shows the footnote, a struck-out own answer and the next-question button', () => {
    const out = html({ selectedAnswer: 'Алматы' });
    expect(out).toContain('Неверный ответ');
    expect(out).toContain('В этом раунде без мини-игры');
    expect(out).toContain('Следующий вопрос');
    expect(out).toContain('class="resolution-answers"');
    expect(out.indexOf('Твой ответ')).toBeLessThan(out.indexOf('Правильный ответ'));
    expect(out.indexOf('В этом раунде без мини-игры')).toBeLessThan(out.indexOf('Следующий вопрос'));
  });

  it('timeout says time is up and never shows the own-answer row', () => {
    const out = html({ timedOut: true, selectedAnswer: 'Алматы' });
    expect(out).toContain('Время вышло');
    expect(out).not.toContain('Твой ответ');
    expect(out).toContain('Следующий вопрос');
  });

  it('training has no mini-game footnote', () => {
    const out = html({ variant: 'training', selectedAnswer: 'Алматы' });
    expect(out).not.toContain('В этом раунде без мини-игры');
    expect(out).toContain('Следующий вопрос');
  });

  it('the last question leads to the summary, not to a next question', () => {
    const wrong = html({ variant: 'training', selectedAnswer: 'Алматы', final: true });
    expect(wrong).toContain('К итогу');
    expect(wrong).not.toContain('Следующий вопрос');
    const timedOut = html({ final: true, timedOut: true });
    expect(timedOut).toContain('К итогу');
    // Верный ответ в забеге ведёт к мини-игре, даже если круг последний.
    const correct = html({ correct: true, final: true });
    expect(correct).toContain('К мини-игре');
    expect(correct).not.toContain('К итогу');
  });

  it('button and background tap together continue only once', () => {
    const onContinue = vi.fn();
    const tree = ResolutionScreen({ ...base, correct: true, onContinue }) as Node;
    const button = findByClass(tree, 'resolution-action');
    expect(button).not.toBeNull();
    const stop = vi.fn();
    button!.props.onClick!({ stopPropagation: stop });
    tree.props.onClick!({});
    button!.props.onClick!({ stopPropagation: stop });
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  it('background tap alone continues once, and the report area is shielded from it', () => {
    const onContinue = vi.fn();
    const tree = ResolutionScreen({
      ...base,
      onContinue,
      correct: false,
      report: { onSend: vi.fn(), state: 'idle' },
    }) as Node;
    const area = findByClass(tree, 'resolution-report');
    expect(area!.props.onClick).toBe(stopReportAreaEvent);
    tree.props.onClick!({});
    tree.props.onClick!({});
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('opens the report as a plain text link and keeps the panel out of the continue path', () => {
    const open = ResolutionScreen({
      ...base,
      correct: false,
      report: { onSend: vi.fn(), state: 'error' },
    }) as Node;
    const area = findByClass(open, 'resolution-report');
    expect(area!.props.onClick).toBe(stopReportAreaEvent);
    expect(findByClass(open, 'resolution-report-panel')).not.toBeNull();
    expect(findByClass(open, 'resolution-report-toggle')).toBeNull();
  });
});
