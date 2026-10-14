import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ResolutionScreen, stopReportAreaEvent } from './ResolutionScreen';
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
