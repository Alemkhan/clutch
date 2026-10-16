import { useState } from "react";
import type { QuestionReportKind } from "@clutch/shared";
import { submitQuestionReport } from "../../platform/api";
import type { ResolutionReportStatus } from "../round/reportPanel";
import { currentSoloQuestion, type SoloFlowState } from "./soloRunFlow";

/** Репорт о проблеме на разборе. Статус привязан к вопросу: следующий разбор снова начинает с idle. */
export function useQuestionReport(state: SoloFlowState) {
  const [report, setReport] = useState<{
    questionId: string;
    status: ResolutionReportStatus;
  } | null>(null);
  const reportQuestion = currentSoloQuestion(state);

  const submitReport = (kind: QuestionReportKind, comment: string) => {
    const question = currentSoloQuestion(state);
    if (!question) return;
    const playerAnswer =
      question.answerType === "multiple_choice"
        ? question.options.find((option) => option.id === state.selectedOption)
            ?.text
        : state.selectedOption || undefined;
    setReport({ questionId: question.id, status: "sending" });
    void submitQuestionReport({
      questionId: question.id,
      ...(state.runId ? { runId: state.runId } : {}),
      category: state.category,
      mode: "solo",
      kind,
      verdict: state.lastCorrect,
      ...(playerAnswer ? { playerAnswer } : {}),
      ...(comment ? { comment } : {}),
    })
      .then(() => setReport({ questionId: question.id, status: "sent" }))
      .catch(() => setReport({ questionId: question.id, status: "error" }));
  };

  const reportState: ResolutionReportStatus =
    report && reportQuestion && report.questionId === reportQuestion.id
      ? report.status
      : "idle";
  return { submitReport, reportState };
}
