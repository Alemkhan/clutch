import { messagesFor, useMessages } from '../../i18n/messages';
import { m } from './messages';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PRACTICE_LEVELS, type PracticeLevel, type PublicQuestion } from '@clutch/shared';
import { checkTrainingAnswer, fetchTrainingMistakes, fetchTrainingQuestions, logAnalyticsEvent, submitQuestionReport } from '../../platform/api';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { Training, type TrainingReportInput } from './Training';

interface TrainingHubProps {
  onStartBot: (level: PracticeLevel) => void;
  /** Открыть сразу отработку ошибок (переход с экрана итога), если ошибки есть. */
  openMistakes?: boolean;
  /** true, пока идёт практика ошибок: App прячет нижнюю навигацию. */
  onPlayingChange?: (playing: boolean) => void;
}

type View = 'menu' | 'bots' | 'mistakes';

/** Выбор уровня бота: название и одна строка о силе. */
export function PracticeLevelList({ onStartBot }: { onStartBot: (level: PracticeLevel) => void }) {
  const t = messagesFor(m);
  return (
    <>
      {PRACTICE_LEVELS.map((level) => (
        <button key={level.id} type="button" className="training-entry" onClick={() => { onStartBot(level); }}>
          <span className="training-entry-title">{t.levelName(level.id)}</span>
          <span className="training-entry-meta">{t.levelCaption(Number(level.caption.match(/\d+(?= круг)/)?.[0] ?? 0))}</span>
        </button>
      ))}
    </>
  );
}

type MistakeLoad =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; questions: PublicQuestion[] };

interface MistakePracticeProps {
  ids: string[];
  onBack: () => void;
  exitLabel?: string;
}

/** Репорт из отработки ошибок: забега нет, runId не приходит. */
const reportTrainingProblem = (input: TrainingReportInput) =>
  submitQuestionReport({ ...input, mode: 'training' }).then(() => undefined);

/** Загрузка вопросов отработки с сервера (без ответов) и сама отработка. Журнал ошибок ведёт сервер: id приходят оттуда же, чужие сервер отклоняет. */
export function MistakePractice({ ids, onBack, exitLabel }: MistakePracticeProps) {
  const t = useMessages(m);
  const [load, setLoad] = useState<MistakeLoad>(ids.length === 0 ? { status: 'ready', questions: [] } : { status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (ids.length === 0) {
      setLoad({ status: 'ready', questions: [] });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    fetchTrainingQuestions(ids, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      // Порядок сессии задал сервер; вопросы приходят в том же порядке.
      setLoad({ status: 'ready', questions: response.questions });
      // Категория сессии - категория первого вопроса: набор ошибок бывает смешанным.
      if (response.questions.length > 0) {
        logAnalyticsEvent('training_started', { category: response.questions[0].category });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setLoad({ status: 'error' });
    });
    return () => controller.abort();
  }, [ids, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (load.status === 'loading') {
    return (
      <section className="training-screen">
        <ScreenHeader onBack={onBack} title={t.mistakesTitle} />
        <div className="matchmaking-loading" role="status"><span /> {t.loadingQuestions}</div>
      </section>
    );
  }
  if (load.status === 'error') {
    return (
      <section className="training-screen">
        <ScreenHeader onBack={onBack} title={t.mistakesTitle} />
        <p className="matchmaking-error" role="alert">{t.questionsError}</p>
        <button type="button" className="cta-btn" onClick={retry}>{t.retry}</button>
      </section>
    );
  }
  return (
    <Training
      questions={load.questions}
      check={checkTrainingAnswer}
      onBack={onBack}
      exitLabel={exitLabel}
      onReport={reportTrainingProblem}
    />
  );
}

/** «Тренировка»: практика без зачёта. Два входа: игра против бота и отработка ошибок. */
/** Журнал ошибок живёт на сервере: экран показывает только то, что сервер ответил. */
export type MistakeSummary =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; count: number; ids: string[] };

export function mistakeMeta(summary: MistakeSummary): string {
  const t = messagesFor(m);
  if (summary.status === 'loading') return t.metaLoading;
  if (summary.status === 'error') return t.metaError;
  return summary.count > 0 ? t.metaCount(summary.count) : t.metaNone;
}

/** Меню «Тренировки»: два входа. Выделено, чтобы состояния журнала проверялись без сети. */
export function TrainingMenu({ summary, onBots, onMistakes }: {
  summary: MistakeSummary;
  onBots: () => void;
  onMistakes: () => void;
}) {
  const t = useMessages(m);
  return (
    <section className="training-screen root-tab">
      <ScreenHeader title={t.title} />
      <p className="training-note">{t.unranked}</p>
      <button type="button" className="training-entry" onClick={onBots}>
        <span className="training-entry-title">{t.botsTitle}</span>
        <span className="training-entry-meta">{t.botsMeta}</span>
      </button>
      <button type="button" className="training-entry" onClick={onMistakes} disabled={summary.status === 'loading'}>
        <span className="training-entry-title">{t.mistakesTitle}</span>
        <span className="training-entry-meta">{mistakeMeta(summary)}</span>
      </button>
    </section>
  );
}

export function TrainingHub({ onStartBot, onPlayingChange, openMistakes = false }: TrainingHubProps) {
  const t = useMessages(m);
  const [view, setView] = useState<View>('menu');
  const [summary, setSummary] = useState<MistakeSummary>({ status: 'loading' });
  // С экрана итога - сразу в отработку, как только список ошибок пришёл; дальше обычное меню.
  const openedRef = useRef(!openMistakes);
  useEffect(() => {
    if (openedRef.current || summary.status === 'loading') return;
    openedRef.current = true;
    if (summary.status === 'ready' && summary.count > 0) setView('mistakes');
  }, [summary]);

  // Список ошибок берётся с сервера при каждом возврате в меню: после отработки он изменился.
  useEffect(() => {
    if (view !== 'menu') return undefined;
    const controller = new AbortController();
    setSummary({ status: 'loading' });
    fetchTrainingMistakes(controller.signal).then((response) => {
      if (!controller.signal.aborted) setSummary({ status: 'ready', count: response.count, ids: response.ids });
    }).catch(() => {
      if (!controller.signal.aborted) setSummary({ status: 'error' });
    });
    return () => controller.abort();
  }, [view]);

  useEffect(() => {
    onPlayingChange?.(view === 'mistakes');
    return () => onPlayingChange?.(false);
  }, [view, onPlayingChange]);

  if (view === 'mistakes') {
    return (
      <MistakePractice
        ids={summary.status === 'ready' ? summary.ids : []}
        onBack={() => setView('menu')}
        exitLabel={t.toTraining}
      />
    );
  }

  if (view === 'bots') {
    return (
      <section className="training-screen">
        <ScreenHeader onBack={() => setView('menu')} title={t.vsBot} />
        <PracticeLevelList onStartBot={onStartBot} />
      </section>
    );
  }

  return (
    <TrainingMenu
      summary={summary}
      onBots={() => setView('bots')}
      onMistakes={() => setView('mistakes')}
    />
  );
}
