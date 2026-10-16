import type { ReactNode } from "react";
import { ScreenHeader } from "../../../ui/ScreenHeader";

/** Общая рамка экранов загрузки, ошибки и готовности забега. */
export function MatchmakingFrame({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <section className="matchmaking">
      <ScreenHeader onBack={onBack} />
      <div className="matchmaking-body">{children}</div>
    </section>
  );
}
