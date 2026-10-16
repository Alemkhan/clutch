import { MatchmakingFrame } from "./MatchmakingFrame";

interface FrameProps {
  eyebrow: string;
  onBack: () => void;
}

export function SoloLoadingStage({ eyebrow, onBack }: FrameProps) {
  return (
    <MatchmakingFrame onBack={onBack}>
      <span className="matchmaking-eyebrow">{eyebrow}</span>
      <h1 className="screen-title">Готовим забег</h1>
      <div className="matchmaking-loading" role="status">
        <span /> Загружаем вопросы
      </div>
    </MatchmakingFrame>
  );
}

export function SoloErrorStage({ eyebrow, onBack, error, onRetry }: FrameProps & {
  error?: string;
  onRetry: () => void;
}) {
  return (
    <MatchmakingFrame onBack={onBack}>
      <span className="matchmaking-eyebrow">{eyebrow}</span>
      <h1 className="screen-title">Забег не начался</h1>
      <p className="matchmaking-error" role="alert">
        {error}
      </p>
      <div className="matchmaking-actions">
        <button type="button" className="cta-btn" onClick={onRetry}>
          Повторить
        </button>
      </div>
    </MatchmakingFrame>
  );
}
