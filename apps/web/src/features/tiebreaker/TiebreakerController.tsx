import { useEffect, useRef, useState } from "react";
import { isBestAnswerOfDay } from "@clutch/shared";
import { answerTiebreaker, logAnalyticsEvent } from "../../platform/api";
import { canShareViaTelegram, getTelegramIdentity, shareViaTelegram } from "../../platform/telegram";
import { shareTiebreakerResult } from "./tiebreakerShare";
import { buildGuessPreviewUrl, previewBase } from "../../platform/share";
import { preparedMessageShare } from "../../platform/shareMessage";
import { useDayCountdown } from "./useDayCountdown";
import { TiebreakerSubmitter } from "./tiebreakerSubmit";
import { useTiebreakerToday } from "./useTiebreakerToday";
import { TiebreakerScreenView } from "./TiebreakerScreenView";
import type { TiebreakerSubmitStatus } from "./TiebreakerAnswerForm";
import type { TiebreakerShareStatus } from "./TiebreakerReveal";
export function TiebreakerScreen({ onBack }: { onBack: () => void }) {
  const { state, reload, setToday } = useTiebreakerToday();
  const [submitStatus, setSubmitStatus] =
    useState<TiebreakerSubmitStatus>("idle");
  const [shareStatus, setShareStatus] = useState<TiebreakerShareStatus>("idle");
  const submitter = useRef<TiebreakerSubmitter | null>(null);
  submitter.current ??= new TiebreakerSubmitter({ answer: answerTiebreaker });
  const guest = getTelegramIdentity() === null;
  // Смена суток: вопрос уже другой, перечитываем.
  const msLeft = useDayCountdown(reload);

  // Подтверждение «Скопировано» гаснет само, чтобы не висеть до ухода с экрана.
  useEffect(() => {
    if (shareStatus === "idle") return undefined;
    const id = window.setTimeout(() => setShareStatus("idle"), 3000);
    return () => window.clearTimeout(id);
  }, [shareStatus]);

  const share = () => {
    if (
      state.status !== "ready" ||
      !state.today.question ||
      !state.today.answered
    )
      return;
    const { question, answered } = state.today;
    const hasNative =
      typeof navigator !== "undefined" && typeof navigator.share === "function";
    const previewUrl = buildGuessPreviewUrl(
      previewBase(
        import.meta.env.VITE_API_URL as string | undefined,
        window.location.origin,
      ),
      question.number,
      answered.multiplier,
      answered.percentile,
      isBestAnswerOfDay(answered.percentile),
    );
    void shareTiebreakerResult(question.number, answered, previewUrl, {
      telegramShare: canShareViaTelegram(),
      nativeShare: hasNative,
      effects: {
        telegramMessage: preparedMessageShare(previewUrl),
        telegramShare: shareViaTelegram,
        nativeShare: hasNative ? (data) => navigator.share(data) : undefined,
        copy: (text) => navigator.clipboard.writeText(text),
      },
    }).then((result) => {
      // Событие без текста и без ответа: только факт, что поделились.
      if (result === "shared" || result === "copied")
        logAnalyticsEvent("tiebreaker_shared");
      setShareStatus(
        result === "copied"
          ? "copied"
          : result === "failed"
            ? "failed"
            : "idle",
      );
    });
  };

  const submit = (guess: number) => {
    if (state.status !== "ready" || !state.today.question) return;
    const questionId = state.today.question.id;
    setSubmitStatus("sending");
    void submitter.current!.submit({ questionId, guess }).then((outcome) => {
      if (!outcome) return;
      switch (outcome.kind) {
        case "answered":
          // Событие без guess и ответа: на сервере они и так есть, а в аналитике им делать нечего.
          logAnalyticsEvent("tiebreaker_answered");
          setSubmitStatus("idle");
          setToday(outcome.state);
          break;
        case "already_answered":
          setSubmitStatus("idle");
          if (outcome.state) setToday(outcome.state);
          else reload();
          break;
        case "stale":
          setSubmitStatus("stale");
          reload();
          break;
        case "network":
          setSubmitStatus("network");
          break;
        case "rejected":
          setSubmitStatus("rejected");
          break;
      }
    });
  };

  return (
    <TiebreakerScreenView
      state={state}
      guest={guest}
      submitStatus={submitStatus}
      msLeft={msLeft}
      shareStatus={shareStatus}
      onBack={onBack}
      onRetry={reload}
      onSubmit={submit}
      onShare={share}
    />
  );
}
