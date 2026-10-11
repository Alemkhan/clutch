import { useEffect } from 'react';
import type { CategoryId, PracticeLevel } from '@clutch/shared';
import { SOLO_ROUND_CAP } from '@clutch/shared';
import { CategorySelect } from './CategorySelect';
import { HammerGame } from './HammerGame';
import { QuestionScreen } from './QuestionScreen';
import { ResolutionScreen } from './ResolutionScreen';
import { ScreenHeader } from './ScreenHeader';
import { SoloHud } from './SoloHud';
import { SoloResult } from './SoloResult';
import {
  currentSoloQuestion,
  soloFlowView,
  soloPaceOf,
  soloRoundsLeft,
  type SoloFlowState,
  type SoloStage,
} from '../lib/soloRunFlow';
import { buildPracticeSummary, practiceBotLabel } from '../lib/practiceResult';
import { FRIEND_DUEL_CHIP, buildFriendDuelSummary } from '../lib/friendDuelResult';
import { useSoloRun, type SoloSaveState } from '../lib/useSoloRun';

interface SoloRunScreenProps {
  state: SoloFlowState;
  save: SoloSaveState;
  onSelectCategory: (category: CategoryId) => void;
  onRetryStart: () => void;
  onBackToCategories: () => void;
  onStart: () => void;
  onAnswer: (optionId: string, timeMs: number) => void;
  onContinue: () => void;
  onHammerComplete: (result: unknown, progress: number, distance: number) => void;
  onRetrySave: () => void;
  /** В тренировке «домой» ведёт к выбору уровня. */
  onHome: () => void;
  onMyRuns: () => void;
  /** Тренировка против бота: другой текст и итог, результат не засчитывается. */
  practice?: PracticeLevel;
}

export function toSoloCategory(id: string): CategoryId {
  return id === 'history' || id === 'languages' ? id : 'geography';
}

/** Экран соло-забега по шагам. Соперник только рисуется на полосе: завершает забег сам игрок. */
export function SoloRunScreen(props: SoloRunScreenProps) {
  const { state, save } = props;
  const view = soloFlowView(state);
  const pace = soloPaceOf(state);
  const question = currentSoloQuestion(state);
  const eyebrow = props.practice ? 'Тренировка' : 'Соло-забег';

  if (state.stage === 'categories') {
    return <CategorySelect onSelect={(id) => props.onSelectCategory(toSoloCategory(id))} onBack={props.onHome} />;
  }

  if (state.stage === 'loading') {
    return (
      <section className="matchmaking">
        <ScreenHeader onBack={props.onBackToCategories} />
        <div className="matchmaking-body">
          <span className="matchmaking-eyebrow">{eyebrow}</span>
          <h1 className="screen-title">Готовим забег</h1>
          <div className="matchmaking-loading" role="status"><span /> Загружаем вопросы</div>
        </div>
      </section>
    );
  }

  if (state.stage === 'error') {
    return (
      <section className="matchmaking">
        <ScreenHeader onBack={props.onBackToCategories} />
        <div className="matchmaking-body">
          <span className="matchmaking-eyebrow">{eyebrow}</span>
          <h1 className="screen-title">Забег не начался</h1>
          <p className="matchmaking-error" role="alert">{state.error}</p>
          <div className="matchmaking-actions">
            <button type="button" className="cta-btn" onClick={props.onRetryStart}>Повторить</button>
          </div>
        </div>
      </section>
    );
  }

  if (!view) return null;

  if (state.stage === 'ready' && props.practice) {
    return (
      <section className="matchmaking">
        <ScreenHeader onBack={props.onBackToCategories} />
        <div className="matchmaking-body">
          <span className="matchmaking-eyebrow">Тренировка · {props.practice.name}</span>
          <h1 className="screen-title">Всё готово</h1>
          <div className="matchmaking-card">
            <p className="matchmaking-status">
              Против: {pace ? practiceBotLabel(pace.displayName) : 'бот'}. Не засчитывается.
            </p>
          </div>
          <button type="button" className="cta-btn" onClick={props.onStart}>Начать</button>
        </div>
      </section>
    );
  }

  if (state.stage === 'ready') {
    return (
      <section className="matchmaking">
        <ScreenHeader onBack={props.onBackToCategories} />
        <div className="matchmaking-body">
          <span className="matchmaking-eyebrow">{state.friendDuel ? 'Вызов друга' : 'Соло-забег'}</span>
          <h1 className="screen-title">Забег готов</h1>
          {state.friendDuel && <span className="chip">{FRIEND_DUEL_CHIP}</span>}
          {state.bankExhausted && (
            <span className="match-source source-player abandoned-note">
              Все наборы дня в этой категории пройдены — выдан тот, что ты играл давнее всех
            </span>
          )}
          <div className="matchmaking-card">
            <p className="matchmaking-status">
              Дойди до {view.target}%, но не больше чем за {SOLO_ROUND_CAP} кругов.
              Верный ответ даёт попытку в мини-игре, удар двигает прогресс.
            </p>
          </div>
          <button type="button" className="cta-btn" onClick={props.onStart}>Начать</button>
        </div>
      </section>
    );
  }

  if (state.stage === 'result') {
    return (
      <SoloResult
        view={view}
        saveStatus={save.status}
        response={save.response}
        saveError={save.error}
        canRetrySave={save.canRetry}
        onRetrySave={props.onRetrySave}
        onReplay={props.onBackToCategories}
        onMyRuns={props.onMyRuns}
        practice={props.practice && state.session ? buildPracticeSummary(state.session) : null}
        friendDuel={state.friendDuel && state.session ? buildFriendDuelSummary(state.session, save.response) : null}
        onExitPractice={props.onHome}
      />
    );
  }

  if (!question) return null;
  const hud = (
    <SoloHud
      progress={view.progress}
      paceProgress={view.paceProgress}
      paceName={pace?.displayName ?? null}
      round={view.round}
      roundsLeft={soloRoundsLeft(view)}
    />
  );

  return (
    <div className="solo-play">
      {hud}
      {state.stage === 'question' && (
        <QuestionScreen key={`${view.roundsPlayed}:${question.id}`} question={question} onAnswer={props.onAnswer} />
      )}
      {state.stage === 'resolution' && (
        <ResolutionScreen
          question={question}
          correct={state.lastCorrect}
          selectedOptionId={state.selectedOption}
          onContinue={props.onContinue}
        />
      )}
      {state.stage === 'hammer' && (
        <HammerGame
          key={view.roundsPlayed}
          config={state.config}
          questionId={question.id}
          previousSkillResults={state.skillResults}
          onComplete={props.onHammerComplete}
        />
      )}
    </div>
  );
}

export interface SoloRematch {
  inviteId: string;
  category: CategoryId;
}

interface SoloRunProps {
  onHome: () => void;
  onMyRuns: () => void;
  /** Реванш из приглашения: забег стартует сразу, без выбора категории. */
  rematch?: SoloRematch | null;
  /** Тренировка против бота выбранного уровня; без неё — обычный забег. */
  practice?: PracticeLevel;
  /** Нужен приложению: системная «Назад» скрыта во время игры, а молоток получает свой фон. */
  onStageChange: (stage: SoloStage) => void;
}

export function SoloRun({ onHome, onMyRuns, rematch, practice, onStageChange }: SoloRunProps) {
  const run = useSoloRun(practice?.id);
  const { stage } = run.state;
  const { begin } = run;

  useEffect(() => {
    if (rematch) begin(rematch.category, rematch.inviteId);
  }, [rematch, begin]);

  useEffect(() => {
    onStageChange(stage);
  }, [stage, onStageChange]);
  useEffect(() => () => onStageChange('categories'), [onStageChange]);

  return (
    <SoloRunScreen
      state={run.state}
      save={run.save}
      onSelectCategory={run.begin}
      onRetryStart={run.retryStart}
      onBackToCategories={run.backToCategories}
      onStart={run.start}
      onAnswer={run.answer}
      onContinue={run.continueAfterResolution}
      onHammerComplete={run.completeHammer}
      onRetrySave={run.retrySave}
      onHome={onHome}
      onMyRuns={onMyRuns}
      practice={practice}
    />
  );
}
