import { useMessages } from "../../../i18n/messages";
import { MatchmakingFrame } from "./MatchmakingFrame";
import { m } from "./messages";

interface FrameProps {
  eyebrow: string;
  onBack: () => void;
}

export function SoloLoadingStage({ eyebrow, onBack }: FrameProps) {
  const t = useMessages(m);
  return (
    <MatchmakingFrame onBack={onBack}>
      <span className="matchmaking-eyebrow">{eyebrow}</span>
      <h1 className="screen-title">{t.loadingTitle}</h1>
      <div className="matchmaking-loading" role="status">
        <span /> {t.loadingQuestions}
      </div>
    </MatchmakingFrame>
  );
}

export function SoloErrorStage({ eyebrow, onBack, error, onRetry }: FrameProps & {
  error?: string;
  onRetry: () => void;
}) {
  const t = useMessages(m);
  return (
    <MatchmakingFrame onBack={onBack}>
      <span className="matchmaking-eyebrow">{eyebrow}</span>
      <h1 className="screen-title">{t.errorTitle}</h1>
      <p className="matchmaking-error" role="alert">
        {error}
      </p>
      <div className="matchmaking-actions">
        <button type="button" className="cta-btn" onClick={onRetry}>
          {t.retry}
        </button>
      </div>
    </MatchmakingFrame>
  );
}
