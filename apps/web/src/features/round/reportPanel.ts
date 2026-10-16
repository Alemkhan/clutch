import type { QuestionReportKind } from '@clutch/shared';

/** Сетевой статус репорта; живёт в вызывающем (SoloRun/Training), экран только рисует. */
export type ResolutionReportStatus = 'idle' | 'sending' | 'sent' | 'error';

/** Локальный UI-статус панели репорта: открытость, выбранная причина, комментарий. */
export interface ReportPanelState {
  open: boolean;
  kind: QuestionReportKind | null;
  comment: string;
}

export const CLOSED_REPORT_PANEL: ReportPanelState = { open: false, kind: null, comment: '' };

export function openReportPanel(state: ReportPanelState): ReportPanelState {
  return state.open ? state : { ...state, open: true };
}

export function selectReportKind(state: ReportPanelState, kind: QuestionReportKind): ReportPanelState {
  return { ...state, kind };
}

export function editReportComment(state: ReportPanelState, comment: string): ReportPanelState {
  return { ...state, comment };
}

/** Отправка доступна, только когда причина выбрана и сеть не занята или ожидает повтора. */
export function canSendReport(panel: ReportPanelState, status: ResolutionReportStatus): boolean {
  return panel.open && panel.kind !== null && (status === 'idle' || status === 'error');
}
