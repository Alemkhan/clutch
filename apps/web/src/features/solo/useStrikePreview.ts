import { useCallback, useState } from "react";
import type { SkillResult } from "@clutch/shared";
import { soloFlowView, type SoloFlowState } from "./soloRunFlow";
import type { PendingStrike } from "./soloScreenTypes";

/** Превью удара для HUD: привязано к кругу, потому что засчитывает его только ответ сервера. */
export function useStrikePreview(state: SoloFlowState) {
  const [strike, setStrike] = useState<PendingStrike | null>(null);
  const roundsPlayedNow = soloFlowView(state)?.roundsPlayed ?? 0;
  const onStrike = useCallback(
    (_result: SkillResult, reward: number) => setStrike({ roundsPlayed: roundsPlayedNow, reward }),
    [roundsPlayedNow],
  );
  return { strike, onStrike };
}
