import type { SoloRunView } from "../soloRunSession";
import { buildFriendDuelSummary } from "../friendDuelResult";
import { buildPracticeSummary } from "../practiceResult";
import type { SoloFlowState } from "../soloRunFlow";
import type { SoloRunScreenProps } from "../soloScreenTypes";
import { SoloResult } from "../SoloResult";

const noop = () => undefined;

export function SoloResultStage({ props, state, view }: {
  props: SoloRunScreenProps;
  state: SoloFlowState;
  view: SoloRunView;
}) {
  const { save } = props;
  return (
    <SoloResult
      view={view}
      saveStatus={save.status}
      response={save.response}
      saveError={save.error}
      canRetrySave={save.canRetry}
      onRetrySave={props.onRetrySave ?? noop}
      onReplay={props.onBackToCategories}
      onMyRuns={props.onMyRuns}
      practice={
        props.practice && state.session
          ? buildPracticeSummary(state.session)
          : null
      }
      friendDuel={
        state.friendDuel && state.session
          ? buildFriendDuelSummary(state.session, save.response)
          : null
      }
      onExitPractice={props.onHome}
      category={state.category}
      correctCount={state.correctCount}
      skillResults={state.skillResults}
      mode={state.mode}
      roundCap={state.session?.roundCap}
      pace={state.session?.pace ?? null}
      miniGameId={state.miniGameId}
      onPlayMode={props.onPlayMode ? (mode) => props.onPlayMode?.(mode, state.category) : undefined}
      roundAwards={state.session?.rounds.map((round) => round.progressAwarded)}
    />
  );
}
